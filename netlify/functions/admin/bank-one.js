// netlify/functions/admin/bank-one.js
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

function looksLikeUuid(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(s || ""));
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

    let bank = null;

    if (type === "master_agent") {
      if (looksLikeUuid(id)) {
        const rows = await sql`
          SELECT bank_name, bank_account_name, bank_account_number, updated_at, user_id, ma_code
          FROM public.ma_payout
          WHERE user_id = ${id}
          LIMIT 1
        `;
        bank = rows?.[0] || null;
      } else {
        const ma_code = id.toUpperCase();
        const rows = await sql`
          SELECT bank_name, bank_account_name, bank_account_number, updated_at, user_id, ma_code
          FROM public.ma_payout
          WHERE ma_code = ${ma_code}
          LIMIT 1
        `;
        bank = rows?.[0] || null;
      }
    } else {
      // agent
      const rows = await sql`
        SELECT bank_name, bank_account_name, bank_account_number, updated_at, agent_user_id
        FROM public.agent_payout_details
        WHERE agent_user_id = ${id}
        LIMIT 1
      `;
      bank = rows?.[0] || null;
    }

    return json(200, { ok: true, bank });
  } catch (err) {
    console.error("admin-bank-one error:", err);
    return json(500, { ok: false, error: err?.message || "Server error" });
  }
}
