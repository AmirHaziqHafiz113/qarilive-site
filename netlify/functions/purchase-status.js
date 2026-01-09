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
    if (event.httpMethod !== "GET") {
      return bad(405, "Method not allowed");
    }

    const external_id = event.queryStringParameters?.external_id;
    if (!external_id) {
      return bad(400, "Missing external_id");
    }

    const sql = neon();

    const rows = await sql`
      SELECT
        external_id,
        status,
        amount,
        paid_at
      FROM public.ma_purchases
      WHERE external_id = ${external_id}
      LIMIT 1;
    `;

    if (!rows.length) {
      return bad(404, "Purchase not found");
    }

    const row = rows[0];

    return json(200, {
      ok: true,
      external_id: row.external_id,
      status: row.status,
      amount: row.amount,
      paid_at: row.paid_at,
    });
  } catch (e) {
    console.error("purchase-status error:", e);
    return bad(500, "Server error");
  }
}
