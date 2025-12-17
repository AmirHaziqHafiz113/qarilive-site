// netlify/functions/ma-agent-list.js
import jwt from "jsonwebtoken";
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

let _pool;
function getPool() {
  if (_pool) return _pool;

  const connectionString =
    process.env.DATABASE_URL ||
    process.env.NEON_DATABASE_URL ||
    process.env.NETLIFY_DATABASE_URL ||
    "";

  if (!connectionString) throw new Error("Missing DATABASE_URL (Neon) env var.");

  _pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  return _pool;
}

export async function handler(event) {
  try {
    const userId = getUserId(event);
    if (!userId) return json(401, { ok: false, error: "Unauthorized" });

    if (event.httpMethod !== "GET") {
      return json(405, { ok: false, error: "Method not allowed" });
    }

    const maCode = (event.queryStringParameters?.ma_code || "").trim().toUpperCase();
    if (!maCode) return json(400, { ok: false, error: "Missing ma_code" });

    const pool = getPool();

    const r = await pool.query(
      `
      SELECT full_name, whatsapp, email, created_at, last_login
      FROM public.agents
      WHERE ma_code = $1
      ORDER BY created_at DESC
      LIMIT 200
      `,
      [maCode]
    );

    return json(200, { ok: true, count: r.rows.length, agents: r.rows });
  } catch (err) {
    console.error("ma-agent-list error:", err);
    return json(500, { ok: false, error: err?.message || "Server error" });
  }
}
