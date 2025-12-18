// netlify/functions/admin/users-list.js
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
  try {
    const decoded = jwt.decode(token);
    const roles = decoded?.app_metadata?.roles || [];
    return Array.isArray(roles) && roles.includes("admin");
  } catch {
    return false;
  }
}

function parseNextLink(linkHeader) {
  if (!linkHeader) return null;
  const parts = linkHeader.split(",");
  for (const p of parts) {
    const m = p.match(/<([^>]+)>;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

function inferRole(u) {
  // Prefer user_metadata.role if you’re using that convention
  const metaRole = (u?.user_metadata?.role || "").toLowerCase().trim();
  if (metaRole) return metaRole;

  // Fallback: app_metadata.roles
  const roles = u?.app_metadata?.roles || [];
  if (Array.isArray(roles)) {
    if (roles.includes("master_agent")) return "master_agent";
    if (roles.includes("agent")) return "agent";
    if (roles.includes("admin")) return "admin";
  }
  return "unknown";
}

export async function handler(event) {
  try {
    if (event.httpMethod !== "GET") return json(405, { ok: false, error: "Method not allowed" });

    const token = getBearerToken(event);
    if (!token) return json(401, { ok: false, error: "Unauthorized" });
    if (!isAdmin(token)) return json(403, { ok: false, error: "Forbidden (admin only)" });

    const SITE_ID = process.env.NETLIFY_SITE_ID;
    const IDENTITY_TOKEN = process.env.NETLIFY_IDENTITY_TOKEN;
    if (!SITE_ID || !IDENTITY_TOKEN) {
      return json(500, { ok: false, error: "Missing NETLIFY_SITE_ID or NETLIFY_IDENTITY_TOKEN" });
    }

    let url = `https://api.netlify.com/api/v1/sites/${SITE_ID}/identity/users?per_page=100`;
    const headers = { Authorization: `Bearer ${IDENTITY_TOKEN}` };

    const allUsers = [];
    while (url) {
      const res = await fetch(url, { headers });
      const txt = await res.text().catch(() => "");
      if (!res.ok) return json(res.status, { ok: false, error: "Failed to fetch users", detail: txt });

      const page = JSON.parse(txt || "[]");
      allUsers.push(...page);

      const link = res.headers.get("link") || res.headers.get("Link") || "";
      url = parseNextLink(link);
    }

    const users = allUsers.map((u) => {
      const meta = u.user_metadata || {};
      const role = inferRole(u);

      const parent =
        String(
          meta.parent_ma_code ||
          meta.ma_code ||
          meta.ma_ref ||
          meta.parent_ma_ref ||
          ""
        )
          .trim()
          .toUpperCase() || "";

      return {
        id: u.id,
        email: u.email || "",
        name: meta.full_name || meta.name || "",
        role,
        parent_ma: parent || "",
      };
    });

    return json(200, { ok: true, users });
  } catch (err) {
    console.error("admin-users-list error:", err);
    return json(500, { ok: false, error: err?.message || "Server error" });
  }
}
