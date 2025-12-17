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
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ ok: false, error: "Method not allowed" }) };
    }

    const userId = getUserId(event);
    if (!userId) {
      return { statusCode: 401, body: JSON.stringify({ ok: false, error: "Unauthorized" }) };
    }

    const body = JSON.parse(event.body || "{}");

    const ma_code = (body.ma_code || "").trim().toUpperCase() || null;
    const full_name = (body.full_name || "").trim();
    const whatsapp = (body.whatsapp || "").trim();
    const bank_name = (body.bank_name || "").trim();
    const bank_account_name = (body.bank_account_name || "").trim();
    const bank_account_number = (body.bank_account_number || "").trim();

    const sql = neon();

    await sql`
      INSERT INTO public.ma_payout (
        user_id, ma_code, full_name, whatsapp, bank_name, bank_account_name, bank_account_number, updated_at
      )
      VALUES (
        ${userId}, ${ma_code}, ${full_name}, ${whatsapp}, ${bank_name}, ${bank_account_name}, ${bank_account_number}, NOW()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        ma_code = COALESCE(EXCLUDED.ma_code, public.ma_payout.ma_code),
        full_name = EXCLUDED.full_name,
        whatsapp = EXCLUDED.whatsapp,
        bank_name = EXCLUDED.bank_name,
        bank_account_name = EXCLUDED.bank_account_name,
        bank_account_number = EXCLUDED.bank_account_number,
        updated_at = NOW();
    `;

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
}
