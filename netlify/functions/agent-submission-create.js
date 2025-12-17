import jwt from "jsonwebtoken";
import { google } from "googleapis";
import { Pool } from "pg";

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(body),
  };
}

function getBearerToken(event) {
  const auth = event.headers.authorization || event.headers.Authorization || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : auth.trim();
}

function getUserIdFromJwt(token) {
  if (!token) return null;
  const decoded = jwt.decode(token);
  return decoded?.sub || null;
}

function parseDataUrl(dataUrl) {
  // data:image/png;base64,AAAA...
  const m = String(dataUrl || "").match(/^data:(.+);base64,(.+)$/);
  if (!m) throw new Error("Invalid proof_data_url");
  const mimeType = m[1];
  const b64 = m[2];
  const buffer = Buffer.from(b64, "base64");
  return { mimeType, buffer };
}

function safeUpper(s) {
  return String(s || "").trim().toUpperCase();
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function uploadToDrive({ filename, mimeType, buffer }) {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "{}");
  const folderId = process.env.DRIVE_FOLDER_ID;

  if (!creds?.client_email || !creds?.private_key) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON env var");
  }
  if (!folderId) throw new Error("Missing DRIVE_FOLDER_ID env var");

  const auth = new google.auth.JWT(
    creds.client_email,
    null,
    creds.private_key,
    ["https://www.googleapis.com/auth/drive"]
  );

  const drive = google.drive({ version: "v3", auth });

  // Upload file into folder
  const createRes = await drive.files.create({
    requestBody: {
      name: filename || "proof.jpg",
      parents: [folderId],
    },
    media: {
      mimeType,
      body: BufferToStream(buffer),
    },
    fields: "id, webViewLink",
  });

  const fileId = createRes.data.id;
  if (!fileId) throw new Error("Drive upload failed");

  // Make it public: anyone with the link can view
  await drive.permissions.create({
    fileId,
    requestBody: {
      role: "reader",
      type: "anyone",
    },
  });

  // Public link
  const publicUrl = `https://drive.google.com/file/d/${fileId}/view?usp=sharing`;
  return { fileId, publicUrl };
}

// helper: buffer -> stream (googleapis likes streams)
async function BufferToStream(buffer) {
  const { Readable } = await import("stream");
  const s = new Readable();
  s.push(buffer);
  s.push(null);
  return s;
}

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { ok: false, error: "Method not allowed" });
    }

    const token = getBearerToken(event);
    const agentUserId = getUserIdFromJwt(token);
    if (!agentUserId) return json(401, { ok: false, error: "Unauthorized" });

    const body = JSON.parse(event.body || "{}");

    const ma_code = safeUpper(body.ma_code);
    const agent_email = String(body.agent_email || "").trim();
    const agent_name = String(body.agent_name || "").trim();

    const customer_name = String(body.customer_name || "").trim();
    const customer_phone = String(body.customer_phone || "").trim();
    const customer_address = String(body.customer_address || "").trim();

    const purchase_amount_rm = String(body.purchase_amount_rm || "").trim();
    const purchase_date = String(body.purchase_date || "").trim();
    const notes = String(body.notes || "").trim();

    const proof_data_url = body.proof_data_url;
    const proof_filename = String(body.proof_filename || "proof.jpg").trim();

    if (!ma_code) return json(400, { ok: false, error: "Missing ma_code" });
    if (!customer_name) return json(400, { ok: false, error: "Missing customer_name" });
    if (!customer_phone) return json(400, { ok: false, error: "Missing customer_phone" });
    if (!proof_data_url) return json(400, { ok: false, error: "Missing proof_data_url" });

    // Decode image
    const { mimeType, buffer } = parseDataUrl(proof_data_url);

    // Upload to Google Drive
    const { publicUrl } = await uploadToDrive({
      filename: proof_filename,
      mimeType,
      buffer,
    });

    // Insert into Neon DB
    const client = await pool.connect();
    try {
      const q = `
        INSERT INTO public.agent_submissions
          (ma_code, agent_user_id, agent_name, agent_email, customer_name, customer_phone, proof_url, status)
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, 'pending')
        RETURNING id, created_at
      `;
      const r = await client.query(q, [
        ma_code,
        agentUserId,
        agent_name,
        agent_email,
        customer_name,
        customer_phone,
        publicUrl,
      ]);

      return json(200, {
        ok: true,
        id: r.rows?.[0]?.id,
        created_at: r.rows?.[0]?.created_at,
        proof_url: publicUrl,
      });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error("agent-submission-create error:", e);
    return json(500, { ok: false, error: e?.message || "Submit failed" });
  }
}
