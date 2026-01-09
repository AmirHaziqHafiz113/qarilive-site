import { neon } from "@netlify/neon";

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

function bad(code, msg) {
  return json(code, { ok: false, error: msg });
}

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return bad(405, "Method not allowed");
    }

    const payload = JSON.parse(event.body || "{}");
    const { external_id, customer_name, phone, address, notes } = payload;

    if (!external_id || !customer_name || !phone || !address) {
      return bad(400, "Missing required fields");
    }

    const sql = neon();

    // Ensure purchase exists and is PAID
    const purchase = await sql`
      SELECT status
      FROM public.ma_purchases
      WHERE external_id = ${external_id}
      LIMIT 1;
    `;

    if (!purchase.length) {
      return bad(404, "Purchase not found");
    }

    if (purchase[0].status !== "PAID") {
      return bad(400, "Payment not confirmed");
    }

    // Insert or update delivery details
    await sql`
      INSERT INTO public.ma_delivery_details (
        external_id, customer_name, phone, address, notes
      )
      VALUES (
        ${external_id}, ${customer_name}, ${phone}, ${address}, ${notes || null}
      )
      ON CONFLICT (external_id)
      DO UPDATE SET
        customer_name = EXCLUDED.customer_name,
        phone = EXCLUDED.phone,
        address = EXCLUDED.address,
        notes = EXCLUDED.notes;
    `;

    return json(200, { ok: true });
  } catch (e) {
    console.error("delivery-set error:", e);
    return bad(500, "Server error");
  }
}
