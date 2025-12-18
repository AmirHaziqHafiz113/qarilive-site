// netlify/functions/admin/payout-batch-create.js
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

function makeBatchId() {
  return "PB-" + Date.now() + "-" + Math.random().toString(16).slice(2, 8).toUpperCase();
}

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") return json(405, { ok: false, error: "Method not allowed" });

    const token = getBearerToken(event);
    if (!token) return json(401, { ok: false, error: "Unauthorized" });
    if (!isAdmin(token)) return json(403, { ok: false, error: "Forbidden (admin only)" });

    const body = JSON.parse(event.body || "{}");
    const type = String(body.type || "").trim();
    const id = String(body.id || "").trim();
    const commission_pct = Number(body.commission_pct);

    if (!type || !id) return json(400, { ok: false, error: "Missing type or id" });
    if (!["master_agent", "agent"].includes(type)) return json(400, { ok: false, error: "Invalid type" });
    if (Number.isNaN(commission_pct) || commission_pct < 0 || commission_pct > 100) {
      return json(400, { ok: false, error: "commission_pct must be between 0 and 100" });
    }

    const sql = neon();

    // total approved
    let totals;
    if (type === "master_agent") {
      const ma_code = id.toUpperCase();
      totals = await sql`
        SELECT
          COUNT(*)::int AS approved_count,
          COALESCE(SUM(purchase_amount_rm::numeric), 0)::numeric AS total_rm
        FROM public.agent_submissions
        WHERE ma_code = ${ma_code}
          AND COALESCE(status,'pending') = 'approved'
      `;
    } else {
      totals = await sql`
        SELECT
          COUNT(*)::int AS approved_count,
          COALESCE(SUM(purchase_amount_rm::numeric), 0)::numeric AS total_rm
        FROM public.agent_submissions
        WHERE agent_user_id = ${id}
          AND COALESCE(status,'pending') = 'approved'
      `;
    }

    const approved_count = Number(totals?.[0]?.approved_count || 0);
    const total_rm = Number(totals?.[0]?.total_rm || 0);
    const payout_amount_rm = +(total_rm * (commission_pct / 100)).toFixed(2);

    const batch_id = makeBatchId();

    // CSV (simple)
    const csvLines = [
      "batch_id,type,identifier,approved_count,total_sales_rm,commission_pct,payout_amount_rm,created_at",
      [
        batch_id,
        type,
        id.replaceAll(",", " "),
        approved_count,
        total_rm.toFixed(2),
        commission_pct.toFixed(2),
        payout_amount_rm.toFixed(2),
        new Date().toISOString(),
      ].join(","),
    ];
    const csv = csvLines.join("\n");

    return json(200, {
      ok: true,
      batch_id,
      type,
      id,
      approved_count,
      total_rm,
      commission_pct,
      payout_amount_rm,
      csv,
    });
  } catch (err) {
    console.error("admin-payout-batch-create error:", err);
    return json(500, { ok: false, error: err?.message || "Server error" });
  }
}
