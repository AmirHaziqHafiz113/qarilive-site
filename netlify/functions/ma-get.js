import { neon } from "@netlify/neon";

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    },
    body: JSON.stringify(body),
  };
}

function normalizeWhatsapp(input) {
  const raw = (input || "").trim();
  if (!raw) return "";
  if (raw.startsWith("https://wa.me/") || raw.startsWith("http://wa.me/")) return raw;

  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return "";
  return `https://wa.me/${digits}`;
}

export async function handler(event) {
  try {
    const ref = (event.queryStringParameters?.ref || "").trim();
    if (!ref) return json(400, { ok: false, error: "Missing ref" });

    const sql = neon(); // uses NETLIFY_DATABASE_URL automatically

    const rows = await sql`
      SELECT user_id, full_name, whatsapp
      FROM ma_payout
      WHERE user_id = ${ref}
      LIMIT 1;
    `;

    if (!rows || rows.length === 0) {
      return json(404, { ok: false, error: "REF not found" });
    }

    const row = rows[0];

    return json(200, {
      ok: true,
      data: {
        user_id: row.user_id,
        full_name: row.full_name,
        ma_code: row.user_id,
        whatsapp: normalizeWhatsapp(row.whatsapp),
        checkout_url: "https://checkout.xendit.co/od/qarilivelite",
      },
    });
  } catch (err) {
    return json(500, { ok: false, error: err?.message || "Server error" });
  }
}
