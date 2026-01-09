// netlify/functions/xendit-webhook.js
const { neon } = require("@netlify/neon");

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  };
}

/**
 * Xendit sends: X-CALLBACK-TOKEN
 * We verify it using env var: XENDIT_WEBHOOK_TOKEN
 * (If env var not set, we skip verification)
 */
function verifyCallbackToken(headers) {
  const expected = process.env.XENDIT_WEBHOOK_TOKEN;
  if (!expected) return true;

  const got =
    headers["x-callback-token"] ||
    headers["X-CALLBACK-TOKEN"] ||
    headers["x-callback-token".toLowerCase()] ||
    headers["x-callback-token".toUpperCase()];

  return (got || "").trim() === expected.trim();
}

function mapStatus(raw) {
  const s = (raw || "").toUpperCase();
  if (s === "PAID" || s === "SETTLED") return "PAID";
  if (s === "EXPIRED") return "EXPIRED";
  if (s === "PENDING") return "PENDING";
  if (s === "FAILED") return "FAILED";
  return s || "UNKNOWN";
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { ok: false, error: "Method not allowed" });
    }

    // ✅ verify webhook token (recommended)
    if (!verifyCallbackToken(event.headers || {})) {
      return json(401, { ok: false, error: "Invalid webhook token" });
    }

    const payload = JSON.parse(event.body || "{}");

    // Xendit invoice callback fields
    const external_id = payload.external_id || payload.data?.external_id;
    const status = mapStatus(payload.status || payload.data?.status);

    const amount = payload.amount ?? payload.data?.amount ?? null;
    const invoice_id = payload.id || payload.data?.id || payload.invoice_id || null;

    const payer_email =
      payload.payer_email ||
      payload.data?.payer_email ||
      payload.customer?.email ||
      null;

    const payer_name =
      payload.payer_name ||
      payload.data?.payer_name ||
      payload.customer?.name ||
      null;

    const paid_at = payload.paid_at || payload.data?.paid_at || null;

    if (!external_id) {
      return json(400, { ok: false, error: "Missing external_id" });
    }

    const sql = neon();

    // Update record (idempotent)
    // - Always update status
    // - If PAID, set paid_at if not already set
    await sql`
      UPDATE public.ma_purchases
      SET
        status = ${status},
        xendit_invoice_id = COALESCE(${invoice_id}, xendit_invoice_id),
        amount = COALESCE(${amount}, amount),
        payer_email = COALESCE(${payer_email}, payer_email),
        payer_name = COALESCE(${payer_name}, payer_name),
        paid_at = CASE
          WHEN ${status} = 'PAID' THEN COALESCE(paid_at, ${paid_at}::timestamptz, NOW())
          ELSE paid_at
        END
      WHERE external_id = ${external_id};
    `;

    return json(200, { ok: true });
  } catch (e) {
    console.error("xendit-webhook error:", e);
    return json(500, { ok: false, error: "Server error" });
  }
};
