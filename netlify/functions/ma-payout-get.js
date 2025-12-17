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
  return decoded?.sub || null; // Netlify Identity user id
}

export async function handler(event) {
  try {
    const userId = getUserId(event);
    if (!userId) return json(401, { ok: false, error: "Unauthorized" });

    const sql = neon();

    const rows = await sql`
      SELECT user_id, full_name, whatsapp, bank_name, bank_account_name, bank_account_number, updated_at
      FROM ma_payout
      WHERE user_id = ${userId}
      LIMIT 1;
    `;

    return json(200, { ok: true, data: rows[0] || null });
  } catch (err) {
    return json(500, { ok: false, error: err?.message || "Server error" });
  }
}
