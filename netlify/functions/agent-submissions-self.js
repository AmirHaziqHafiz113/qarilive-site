// netlify/functions/agent-submissions-self.js
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

    const pool = getPool();

    const r = await pool.query(
      `
      SELECT
        id, created_at, ma_code,
        customer_name, customer_phone,
        purchase_amount_rm, purchase_date,
        notes,
        proof_url, status
      FROM public.agent_submissions
      WHERE agent_user_id = $1
      ORDER BY created_at DESC
      LIMIT 500
      `,
      [userId]
    );

    return json(200, { ok: true, count: r.rows.length, submissions: r.rows });
  } catch (err) {
    console.error("agent-submissions-self error:", err);
    return json(500, { ok: false, error: err?.message || "Server error" });
  }
}
