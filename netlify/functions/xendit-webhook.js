import { neon } from "@netlify/neon";

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  };
}

/**
 * Optional security:
 * Add a secret token in Xendit webhook settings, then verify header here.
 * If you haven't set it yet, you can temporarily disable verification.
 */
function verifyCallbackToken(event) {
  const expected = process.env.XENDIT_WEBHOOK_TOKEN;
  if (!expected) return true; // if you didn't set token, skip verification

  // Common header name used by many systems:
  const got =
    event.headers["x-callback-token"] ||
    event.headers["X-CALLBACK-TOKEN"] ||
    event.headers["X-Callback-Token"];

  return (got || "").trim() === expected.trim();
}

function mapStatus(xenditStatus) {
  const s = (xenditStatus || "").toUpperCase();

  // Common statuses for invoice flow
  if (s === "PAID" || s === "SETTLED") return "PAID";
  if (s === "EXPIRED") return "EXPIRED";
  if (s === "PENDING") return "PENDING";
  if (s === "FAILED") return "FAILED";

  // keep raw if unknown
  return s || "UNKNOWN";
}

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { ok: false, error: "Method not allowed" });
    }

    // ✅ (Recommended) security check
    if (!verifyCallbackToken(event)) {
      return json(401, { ok: false, error: "Invalid webhook token" });
    }

    const payload = JSON.parse(event.body || "{}");

    // Xendit invoice callbacks usually include these fields:
    const external_id = payload.external_id || payload.data?.external_id;
    const rawStatus = payload.status || payload.data?.status;
    const status = mapStatus(rawStatus);

    const amount = payload.amount ?? payload.data?.amount;
    const invoice_id = payload.id || payload.data?.id || payload.invoice_id;

    // payer fields might vary; store if present
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

    if (!external_id) {
      return json(400, { ok: false, error: "Missing external_id" });
    }

    const sql = neon();

    // Update record - idempotent (safe if webhook repeats)
    // Only set paid_at when status is PAID
    await sql`
      UPDATE public.ma_purchases
      SET
        status = ${status},
        xendit_invoice_id = COALESCE(${invoice_id}, xendit_invoice_id),
        amount = COALESCE(${amount}, amount),
        payer_email = COALESCE(${payer_email}, payer_email),
        payer_name = COALESCE(${payer_name}, payer_name),
        paid_at = CASE
          WHEN ${status} = 'PAID' THEN COALESCE(paid_at, NOW())
          ELSE paid_at
        END
      WHERE external_id = ${external_id};
    `;

    return json(200, { ok: true });
  } catch (e) {
    console.error(e);
    return json(500, { ok: false, error: "Server error" });
  }
}
