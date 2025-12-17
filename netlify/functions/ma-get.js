import { neon } from "@netlify/neon";

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

function normalizeWa(input) {
  const raw = (input || "").trim();
  if (!raw) return "";
  if (raw.startsWith("https://wa.me/") || raw.startsWith("http://wa.me/")) return raw;
  const digits = raw.replace(/[^\d]/g, "");
  return digits ? `https://wa.me/${digits}` : "";
}

export async function handler(event) {
  try {
    const ref = (event.queryStringParameters?.ref || "").trim();
    if (!ref) return json(400, { ok: false, error: "Missing ref" });

    const sql = neon(); // uses NETLIFY_DATABASE_URL

    // IMPORTANT: allow lookup by ma_code (preferred) OR user_id (fallback)
    const rows = await sql`
      SELECT user_id, ma_code, full_name, whatsapp
      FROM public.ma_payout
      WHERE ma_code = ${ref} OR user_id = ${ref}
      LIMIT 1;
    `;

    if (!rows.length) return json(404, { ok: false, error: "REF not found" });

    const row = rows[0];

    return json(200, {
      ok: true,
      data: {
        full_name: row.full_name || "Master Agent",
        ma_code: row.ma_code || row.user_id,
        whatsapp: normalizeWa(row.whatsapp),
        checkout_url: "https://checkout.xendit.co/od/qarilivelite",
      },
    });
  } catch (err) {
    console.error("ma-get error:", err);
    return json(500, { ok: false, error: "Server error" });
  }
}
