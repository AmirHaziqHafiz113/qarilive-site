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

    const agent_user_id = getUserId(event);
    if (!agent_user_id) return json(401, { ok: false, error: "Unauthorized" });

    const sql = neon();

    const rows = await sql`
      SELECT bank_name, bank_account_name, bank_account_number, updated_at
      FROM public.agent_payout_details
      WHERE agent_user_id = ${agent_user_id}
      LIMIT 1
    `;

    const data = rows?.[0] || null;
    return json(200, { ok: true, data });
  } catch (err) {
    console.error("agent-payout-get error:", err);
    return json(500, { ok: false, error: err?.message || "Server error" });
  }
}
