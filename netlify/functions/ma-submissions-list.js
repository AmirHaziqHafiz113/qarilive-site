// netlify/functions/agent-submission-create.js
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

function getUserId(event) {
  const auth = event.headers.authorization || event.headers.Authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : auth.trim();
  if (!token) return null;
  const decoded = jwt.decode(token);
  return decoded?.sub || null;
}

function safeStr(v) {
  return String(v ?? "").trim();
}

function parseDataUrl(dataUrl) {
  // data:image/png;base64,AAAA
  const s = String(dataUrl || "");
  const m = s.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  const mime = m[1];
  const b64 = m[2];
  return { mime, buffer: Buffer.from(b64, "base64") };
}

function guessExtFromMime(mime) {
  const map = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
  };
  return map[mime] || "jpg";
}

function sanitizeFilename(name) {
  const s = String(name || "proof").replace(/[^\w.\-]+/g, "_");
  return s.slice(0, 120) || "proof";
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

// ---------- Google Drive ----------
async function getDriveClient() {
  const raw = requireEnv("GOOGLE_SERVICE_ACCOUNT_JSON");
  let creds;
  try {
    creds = JSON.parse(raw);
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.");
  }

  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });

  return google.drive({ version: "v3", auth });
}

async function uploadToDrive({ buffer, mimeType, filename, folderId }) {
  const drive = await getDriveClient();

  const createRes = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer),
    },
    fields: "id, name",
  });

  const fileId = createRes?.data?.id;
  if (!fileId) throw new Error("Failed to upload file to Google Drive.");

  // Make it "anyone with link can view"
  await drive.permissions.create({
    fileId,
    requestBody: {
      role: "reader",
      type: "anyone",
    },
  });

  // Public link
  const viewUrl = `https://drive.google.com/file/d/${fileId}/view`;

  return { fileId, viewUrl };
}

// ---------- Neon ----------
let _pool;
function getPool() {
  if (_pool) return _pool;
  const connectionString =
    process.env.DATABASE_URL ||
    process.env.NEON_DATABASE_URL ||
    process.env.NETLIFY_DATABASE_URL ||
    "";

  if (!connectionString) {
    throw new Error("Missing DATABASE_URL (Neon) env var.");
  }
  _pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  return _pool;
}

export async function handler(event) {
  try {
    const userId = getUserId(event);
    if (!userId) return json(401, { ok: false, error: "Unauthorized" });

    if (event.httpMethod !== "POST") {
      return json(405, { ok: false, error: "Method not allowed" });
    }

    const body = JSON.parse(event.body || "{}");

    // Inputs from Agent Dashboard
    const ma_code = safeStr(body.ma_code).toUpperCase();
    const agent_email = safeStr(body.agent_email);
    const agent_name = safeStr(body.agent_name);

    const customer_name = safeStr(body.customer_name);
    const customer_phone = safeStr(body.customer_phone);
    const customer_address = safeStr(body.customer_address);
    const purchase_amount_rm = safeStr(body.purchase_amount_rm);
    const purchase_date = safeStr(body.purchase_date);
    const notes = safeStr(body.notes);

    const proof_data_url = safeStr(body.proof_data_url);
    const proof_filename = safeStr(body.proof_filename) || "proof.jpg";

    if (!ma_code) return json(400, { ok: false, error: "Missing ma_code." });
    if (!customer_name) return json(400, { ok: false, error: "Missing customer_name." });
    if (!customer_phone) return json(400, { ok: false, error: "Missing customer_phone." });
    if (!proof_data_url) return json(400, { ok: false, error: "Missing proof_data_url." });

    // Guard: payload size (base64)
    if (proof_data_url.length > 10 * 1024 * 1024) {
      return json(400, { ok: false, error: "Image too large. Please upload a smaller image." });
    }

    // Parse image
    const parsed = parseDataUrl(proof_data_url);
    if (!parsed) return json(400, { ok: false, error: "Invalid proof_data_url format." });

    const { mime, buffer } = parsed;
    const folderId = requireEnv("DRIVE_FOLDER_ID");

    const ext = guessExtFromMime(mime);
    const safeName = sanitizeFilename(proof_filename.replace(/\.(png|jpg|jpeg|webp|gif)$/i, ""));
    const fileName = `QariLive_${ma_code}_${Date.now()}_${safeName}.${ext}`;

    // Upload to Drive
    const { fileId, viewUrl } = await uploadToDrive({
      buffer,
      mimeType: mime,
      filename: fileName,
      folderId,
    });

    // Insert into Neon
    const pool = getPool();
    const status = "pending";

    // Make sure your table has these columns:
    // ma_code, agent_user_id, agent_email, agent_name,
    // customer_name, customer_phone, customer_address,
    // purchase_amount_rm, purchase_date, notes,
    // proof_url, proof_file_id, status
    const q = `
      INSERT INTO public.agent_submissions
      (ma_code, agent_user_id, agent_email, agent_name,
       customer_name, customer_phone, customer_address,
       purchase_amount_rm, purchase_date, notes,
       proof_url, proof_file_id, status)
      VALUES
      ($1,$2,$3,$4,
       $5,$6,$7,
       $8,$9,$10,
       $11,$12,$13)
      RETURNING id, created_at
    `;

    const vals = [
      ma_code,
      userId,
      agent_email,
      agent_name,
      customer_name,
      customer_phone,
      customer_address,
      purchase_amount_rm || null,
      purchase_date || null,
      notes || null,
      viewUrl,
      fileId,
      status,
    ];

    const ins = await pool.query(q, vals);
    const row = ins.rows?.[0];

    return json(200, {
      ok: true,
      id: row?.id,
      created_at: row?.created_at,
      proof_url: viewUrl,
    });
  } catch (e) {
    console.error("agent-submission-create error:", e);
    return json(500, { ok: false, error: e?.message || "Server error" });
  }
}
