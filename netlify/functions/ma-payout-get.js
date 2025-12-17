import { neon } from "@netlify/neon";

export async function handler(event, context) {
  try {
    const user = context?.clientContext?.user;
    const userId = user?.sub;

    if (!userId) {
      return {
        statusCode: 401,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
        body: JSON.stringify({ ok: false, error: "Unauthorized" })
      };
    }

    const sql = neon();

    const rows = await sql`
      SELECT user_id, full_name, whatsapp, bank_name, bank_account_name, bank_account_number, updated_at
      FROM ma_payout
      WHERE user_id = ${userId}
      LIMIT 1;
    `;

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      body: JSON.stringify({ ok: true, data: rows[0] || null })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      body: JSON.stringify({ ok: false, error: err.message })
    };
  }
}
