// netlify/functions/admin/user-delete.js
import jwt from "jsonwebtoken";

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
    if (event.httpMethod !== "POST") return json(405, { ok: false, error: "Method not allowed" });

    const token = getBearerToken(event);
    if (!token) return json(401, { ok: false, error: "Unauthorized" });
    if (!isAdmin(token)) return json(403, { ok: false, error: "Forbidden (admin only)" });

    const SITE_ID = process.env.NETLIFY_SITE_ID;
    const IDENTITY_TOKEN = process.env.NETLIFY_IDENTITY_TOKEN;
    if (!SITE_ID || !IDENTITY_TOKEN) {
      return json(500, { ok: false, error: "Missing NETLIFY_SITE_ID or NETLIFY_IDENTITY_TOKEN" });
    }

    const body = JSON.parse(event.body || "{}");
    const id = String(body.id || "").trim();
    if (!id) return json(400, { ok: false, error: "Missing id" });

    const res = await fetch(
      `https://api.netlify.com/api/v1/sites/${SITE_ID}/identity/users/${id}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${IDENTITY_TOKEN}` } }
    );

    const t = await res.text().catch(() => "");
    if (!res.ok) return json(res.status, { ok: false, error: "Delete failed", detail: t });

    return json(200, { ok: true });
  } catch (err) {
    console.error("admin-user-delete error:", err);
    return json(500, { ok: false, error: err?.message || "Server error" });
  }
}
