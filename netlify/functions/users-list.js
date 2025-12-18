import jwt from "jsonwebtoken";

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
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
  const metaRole = decoded?.user_metadata?.role;
  return (Array.isArray(roles) && roles.includes("admin")) || metaRole === "admin";
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

function getGoTrueAdmin(context) {
  const identity = context?.clientContext?.identity;
  if (!identity?.url || !identity?.token) return null;
  const base = String(identity.url).replace(/\/$/, ""); // .../.netlify/identity
  return { base, token: identity.token };
}

export async function handler(event, context) {
  try {
    if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
    if (event.httpMethod !== "GET") return json(405, { ok: false, error: "Method not allowed" });

    const token = getBearerToken(event);
    if (!token) return json(401, { ok: false, error: "Unauthorized" });
    if (!isAdmin(token)) return json(403, { ok: false, error: "Forbidden (admin only)" });

    const gt = getGoTrueAdmin(context);
    if (!gt) {
      return json(500, {
        ok: false,
        error:
          "Identity admin token not available in function context. Ensure Identity is enabled on THIS site and redeploy.",
      });
    }

    let url = `${gt.base}/admin/users?per_page=100`;
    const headers = { Authorization: `Bearer ${gt.token}` };

    const allUsers = [];
    while (url) {
      const res = await fetch(url, { headers });
      const txt = await res.text().catch(() => "");
      if (!res.ok) {
        return json(res.status, { ok: false, error: "Failed to fetch users (GoTrue admin)", attempted: url, detail: txt });
      }

      const parsed = JSON.parse(txt || "[]");

      // GoTrue may return either an array OR an object like { users: [...] }
      const usersArr = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.users)
          ? parsed.users
          : [];

      allUsers.push(...usersArr);

      const link = res.headers.get("link") || res.headers.get("Link") || "";
      url = parseNextLink(link);
    }

    const mapped = allUsers.map((u) => {
      const meta = u.user_metadata || {};
      const role = String(meta.role || (u.app_metadata?.roles?.[0] || "")).toLowerCase();
      return {
        id: u.id,
        email: u.email,
        role: role || "—",
        name: meta.full_name || meta.name || "—",
        parent_ma: meta.parent_ma_code || meta.ma_code || meta.ma_ref || "",
      };
    });

    return json(200, { ok: true, users: mapped });
  } catch (err) {
    console.error("users-list error:", err);
    return json(500, { ok: false, error: err?.message || "Server error" });
  }
}
