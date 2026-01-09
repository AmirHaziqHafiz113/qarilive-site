// netlify/functions/orders-list.js
import jwt from "jsonwebtoken";
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

function getBearerToken(event) {
  const auth = event.headers.authorization || event.headers.Authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : auth.trim();
  return token || null;
}

function isAdmin(token) {
  const decoded = jwt.decode(token);
  const roles = decoded?.app_metadata?.roles || [];
  return Array.isArray(roles) && roles.includes("admin");
}

export async function handler(event) {
  try {
    if (event.httpMethod !== "GET") {
      return json(405, { ok: false, error: "Method not allowed" });
    }

    // --- admin auth ---
    const token = getBearerToken(event);
    if (!token) return json(401, { ok: false, error: "Unauthorized" });
    if (!isAdmin(token)) return json(403, { ok: false, error: "Forbidden (admin only)" });

    // --- query params ---
    const q = String(event.queryStringParameters?.q || "").trim(); // search external_id/ma_code/name/phone
    const status = String(event.queryStringParameters?.status || "").trim().toUpperCase(); // PAID/PENDING/FAILED/EXPIRED
    const ma_code = String(event.queryStringParameters?.ma_code || "").trim().toUpperCase();

    let limit = Number(event.queryStringParameters?.limit || 50);
    let offset = Number(event.queryStringParameters?.offset || 0);

    if (!Number.isFinite(limit) || limit < 1) limit = 50;
    if (limit > 200) limit = 200;
    if (!Number.isFinite(offset) || offset < 0) offset = 0;

    const sql = neon();

    // --- main query (JOIN purchases + delivery) ---
    // Notes:
    // - delivery table: public.ma_delivery_details (external_id unique)
    // - purchases table: public.ma_purchases
    const rows = await sql`
      SELECT
        p.external_id,
        p.ma_code,
        p.amount,
        p.status,
        p.paid_at,
        p.created_at,
        p.xendit_invoice_id,
        p.invoice_url,

        d.customer_name,
        d.phone,
        d.address,
        d.notes,
        d.created_at AS delivery_created_at
      FROM public.ma_purchases p
      LEFT JOIN public.ma_delivery_details d
        ON d.external_id = p.external_id
      WHERE
        (${status} = '' OR p.status = ${status})
        AND (${ma_code} = '' OR p.ma_code = ${ma_code})
        AND (
          ${q} = '' OR
          p.external_id ILIKE ${"%" + q + "%"} OR
          p.ma_code ILIKE ${"%" + q + "%"} OR
          COALESCE(d.customer_name,'') ILIKE ${"%" + q + "%"} OR
          COALESCE(d.phone,'') ILIKE ${"%" + q + "%"} OR
          COALESCE(d.address,'') ILIKE ${"%" + q + "%"}
        )
      ORDER BY p.created_at DESC
      LIMIT ${limit} OFFSET ${offset};
    `;

    // Optional total count (useful later for pagination)
    const totalRows = await sql`
      SELECT COUNT(*)::int AS total
      FROM public.ma_purchases p
      LEFT JOIN public.ma_delivery_details d
        ON d.external_id = p.external_id
      WHERE
        (${status} = '' OR p.status = ${status})
        AND (${ma_code} = '' OR p.ma_code = ${ma_code})
        AND (
          ${q} = '' OR
          p.external_id ILIKE ${"%" + q + "%"} OR
          p.ma_code ILIKE ${"%" + q + "%"} OR
          COALESCE(d.customer_name,'') ILIKE ${"%" + q + "%"} OR
          COALESCE(d.phone,'') ILIKE ${"%" + q + "%"} OR
          COALESCE(d.address,'') ILIKE ${"%" + q + "%"}
        );
    `;

    return json(200, {
      ok: true,
      total: totalRows?.[0]?.total ?? 0,
      limit,
      offset,
      orders: rows || [],
    });
  } catch (err) {
    console.error("orders-list error:", err);
    return json(500, { ok: false, error: err?.message || "Server error" });
  }
}
