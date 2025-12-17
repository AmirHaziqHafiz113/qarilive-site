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
  const token = auth.replace("Bearer ", "").trim();
  if (!token) return null;
  const decoded = jwt.decode(token);
  return decoded?.sub || null;
}

export async function handler(event) {
  try {
    const userId = getUserId(event);
    if (!userId) return json(401, { ok: false, error: "Unauthorized" });

    const maCode = (event.queryStringParameters?.ma_code || "").trim().toUpperCase();
    if (!maCode) return json(400, { ok: false, error: "Missing ma_code" });

    const sql = neon();

    const rows = await sql`
      SELECT
        customer_name,
        customer_phone,
        agent_name,
        agent_email,
        status,
        proof_url,
        created_at
      FROM public.agent_submissions
      WHERE ma_code = ${maCode}
      ORDER BY created_at DESC
      LIMIT 200;
    `;

    return json(200, { ok: true, count: rows.length, submissions: rows });
  } catch (err) {
    console.error("ma-submissions-list error:", err);
    return json(500, { ok: false, error: err?.message || "Server error" });
  }
}
