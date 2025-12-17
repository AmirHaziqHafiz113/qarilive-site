import { neon } from "@netlify/neon";
import jwt from "jsonwebtoken";

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
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;

  // Netlify Identity JWT is signed with "JWT_SECRET" in functions env
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  return decoded?.sub || null;
}

export async function handler(event) {
  try {
    const userId = getUserId(event);
    if (!userId) return json(401, { ok: false, error: "Unauthorized" });

    const maCode = (event.queryStringParameters?.ma_code || "").trim().toUpperCase();
    if (!maCode) return json(400, { ok: false, error: "Missing ma_code." });

    const sql = neon(); // uses NETLIFY_DATABASE_URL / DATABASE_URL automatically on Netlify
    const rows = await sql`
      SELECT agent_user_id, email, full_name, whatsapp, ma_code, created_at, last_login
      FROM agents
      WHERE ma_code = ${maCode}
      ORDER BY created_at DESC;
    `;

    return json(200, {
      ok: true,
      count: rows.length,
      agents: rows,
    });
  } catch (e) {
    console.error("ma-agent-list error:", e);
    return json(500, { ok: false, error: "Failed to load agents list." });
  }
}
