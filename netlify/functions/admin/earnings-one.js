// netlify/functions/admin/earnings-one.js
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
    if (event.httpMethod !== "GET") return json(405, { ok: false, error: "Method not allowed" });

    const token = getBearerToken(event);
    if (!token) return json(401, { ok: false, error: "Unauthorized" });
    if (!isAdmin(token)) return json(403, { ok: false, error: "Forbidden (admin only)" });

    const type = String(event.queryStringParameters?.type || "").trim();
    const id = String(event.queryStringParameters?.id || "").trim();

    if (!type || !id) return json(400, { ok: false, error: "Missing type or id" });
    if (!["master_agent", "agent"].includes(type)) return json(400, { ok: false, error: "Invalid type" });

    const sql = neon();

    let rows;
    if (type === "master_agent") {
      const ma_code = id.toUpperCase();
      rows = await sql`
        SELECT
          COUNT(*)::int AS approved_count,
          COALESCE(SUM(purchase_amount_rm::numeric), 0)::numeric AS total_rm
        FROM public.agent_submissions
        WHERE ma_code = ${ma_code}
          AND COALESCE(status,'pending') = 'approved'
      `;
    } else {
      // agent
      const agent_user_id = id;
      rows = await sql`
        SELECT
          COUNT(*)::int AS approved_count,
          COALESCE(SUM(purchase_amount_rm::numeric), 0)::numeric AS total_rm
        FROM public.agent_submissions
        WHERE agent_user_id = ${agent_user_id}
          AND COALESCE(status,'pending') = 'approved'
      `;
    }

    const r = rows?.[0] || { approved_count: 0, total_rm: 0 };
    return json(200, {
      ok: true,
      approved_count: Number(r.approved_count || 0),
      total_rm: Number(r.total_rm || 0),
      commission_pct: null
    });
  } catch (err) {
    console.error("admin-earnings-one error:", err);
    return json(500, { ok: false, error: err?.message || "Server error" });
  }
}
