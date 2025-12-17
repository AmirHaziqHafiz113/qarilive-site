// netlify/functions/ma-submissions-list.js
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
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : auth.trim();
  if (!token) return null;
  const decoded = jwt.decode(token);
  return decoded?.sub || null;
}

export async function handler(event) {
  try {
    if (event.httpMethod !== "GET") return json(405, { ok: false, error: "Method not allowed" });

    const userId = getUserId(event);
    if (!userId) return json(401, { ok: false, error: "Unauthorized" });

    const maCode = String(event.queryStringParameters?.ma_code || "")
      .trim()
      .toUpperCase();
    if (!maCode) return json(400, { ok: false, error: "Missing ma_code." });

    const sql = neon();

    // ✅ Security: only allow master agent to view submissions for THEIR ma_code
    // We verify ownership using ma_payout table (user_id PK, ma_code UNIQUE)
    const owner = await sql`
      SELECT ma_code
      FROM public.ma_payout
      WHERE user_id = ${userId}
      LIMIT 1;
    `;

    const myMa = String(owner?.[0]?.ma_code || "").trim().toUpperCase();
    if (!myMa) return json(403, { ok: false, error: "No Master Agent profile found (ma_payout missing)." });
    if (myMa !== maCode) return json(403, { ok: false, error: "Forbidden (ma_code not owned by this user)." });

    // ✅ Pull submissions from Neon
    const rows = await sql`
      SELECT
        id,
        ma_code,
        agent_user_id,
        agent_name,
        agent_email,
        customer_name,
        customer_phone,
        proof_url,
        status,
        created_at
      FROM public.agent_submissions
      WHERE ma_code = ${maCode}
      ORDER BY created_at DESC
      LIMIT 200;
    `;

    return json(200, { ok: true, count: rows.length, submissions: rows });
  } catch (e) {
    console.error("ma-submissions-list error:", e);
    return json(500, { ok: false, error: e?.message || "Failed to load submissions list." });
  }
}
