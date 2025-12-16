import { neon } from "@netlify/neon";
import jwt from "jsonwebtoken";

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
    if (!userId) {
      return { statusCode: 401, body: JSON.stringify({ ok: false, error: "Unauthorized" }) };
    }

    const sql = neon();

    const rows = await sql`
      SELECT user_id, full_name, whatsapp, bank_name, bank_account_name, bank_account_number, updated_at
      FROM ma_payout
      WHERE user_id = ${userId}
      LIMIT 1;
    `;

    return { statusCode: 200, body: JSON.stringify({ ok: true, data: rows[0] || null }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
}
