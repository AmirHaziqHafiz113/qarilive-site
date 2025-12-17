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
    if (event.httpMethod !== "POST") {
      return json(405, { ok: false, error: "Method not allowed" });
    }

    const userId = getUserId(event);
    if (!userId) return json(401, { ok: false, error: "Unauthorized" });

    const payload = JSON.parse(event.body || "{}");

    const full_name = (payload.full_name || "").trim();
    const whatsapp = (payload.whatsapp || "").trim();
    const bank_name = (payload.bank_name || "").trim();
    const bank_account_name = (payload.bank_account_name || "").trim();
    const bank_account_number = (payload.bank_account_number || "").trim();

    const sql = neon();

    await sql`
      INSERT INTO ma_payout (user_id, full_name, whatsapp, bank_name, bank_account_name, bank_account_number, updated_at)
      VALUES (${userId}, ${full_name}, ${whatsapp}, ${bank_name}, ${bank_account_name}, ${bank_account_number}, NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        whatsapp = EXCLUDED.whatsapp,
        bank_name = EXCLUDED.bank_name,
        bank_account_name = EXCLUDED.bank_account_name,
        bank_account_number = EXCLUDED.bank_account_number,
        updated_at = NOW();
    `;

    return json(200, { ok: true });
  } catch (err) {
    return json(500, { ok: false, error: err?.message || "Server error" });
  }
}
