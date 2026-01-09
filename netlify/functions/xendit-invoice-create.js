import { neon } from "@netlify/neon";

/* ---------- helpers ---------- */
function ok302(location) {
  return {
    statusCode: 302,
    headers: { Location: location },
  };
}

function bad(code, msg) {
  return {
    statusCode: code,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
    body: msg,
  };
}

function normalizeRef(ref) {
  const x = (ref || "").trim().toUpperCase();
  if (!/^MA[A-Z0-9]{1,20}$/.test(x)) return null;
  return x;
}

/* ---------- handler ---------- */
export async function handler(event) {
  try {
    if (event.httpMethod !== "GET") {
      return bad(405, "Method not allowed");
    }

    // 1) Read & validate MA ref
    const ref = normalizeRef(event.queryStringParameters?.ref);
    if (!ref) return bad(400, "Invalid ref");

    // 2) Amount
    const amount = Number(process.env.QARILIVE_LITE_AMOUNT_RM || "0");
    if (!amount || amount <= 0) {
      return bad(500, "Missing product amount");
    }

    // 3) Base URL (your main site)
    const baseUrl = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
    if (!baseUrl) {
      return bad(500, "Missing PUBLIC_BASE_URL");
    }

    // 4) Xendit secret
    const secretKey = process.env.XENDIT_SECRET_KEY;
    if (!secretKey) {
      return bad(500, "Missing XENDIT_SECRET_KEY");
    }

    const sql = neon();

    // 5) Verify Master Agent exists
    const ma = await sql`
      SELECT ma_code
      FROM public.ma_payout
      WHERE ma_code = ${ref}
      LIMIT 1;
    `;
    if (!ma.length) {
      return bad(404, "Master Agent not found");
    }

    // 6) Generate unique external_id
    const external_id = `QL-${ref}-${Date.now()}`;

    // 7) Redirect URLs (IMPORTANT PART)
    const success_redirect_url =
      `${baseUrl}/payment-success.html?external_id=${encodeURIComponent(external_id)}`;

    const failure_redirect_url =
      `${baseUrl}/payment-failed.html?external_id=${encodeURIComponent(external_id)}`;

    // 8) Create invoice
    const auth = Buffer.from(`${secretKey}:`).toString("base64");

    const payload = {
      external_id,
      amount,
      currency: "MYR",
      description: `QariLive Lite - ${ref}`,
      success_redirect_url,
      failure_redirect_url,
      metadata: {
        ma_code: ref,
        product: "QARILIVE_LITE",
      },
    };

    const resp = await fetch("https://api.xendit.co/v2/invoices", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await resp.json();

    if (!resp.ok) {
      console.error("Xendit create invoice error:", data);
      return bad(502, "Xendit invoice creation failed");
    }

    const invoiceUrl = data.invoice_url;
    const invoiceId = data.id;

    if (!invoiceUrl || !invoiceId) {
      return bad(502, "Invalid Xendit response");
    }

    // 9) Store purchase as PENDING
    await sql`
      INSERT INTO public.ma_purchases (
        ma_code,
        external_id,
        xendit_invoice_id,
        invoice_url,
        amount,
        status
      )
      VALUES (
        ${ref},
        ${external_id},
        ${invoiceId},
        ${invoiceUrl},
        ${amount},
        'PENDING'
      );
    `;

    // 10) Redirect buyer to Xendit checkout
    return ok302(invoiceUrl);
  } catch (e) {
    console.error(e);
    return bad(500, "Server error");
  }
}
