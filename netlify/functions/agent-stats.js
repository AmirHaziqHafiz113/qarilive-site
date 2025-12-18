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
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        return json(res.status, { ok: false, error: "Failed to fetch users", detail: t });
      }

      const users = await res.json();
      allUsers.push(...users);

      const link = res.headers.get("link") || res.headers.get("Link") || "";
      url = parseNextLink(link);
    }

    const counts = {};
    let totalAgents = 0;

    for (const u of allUsers) {
      const meta = u.user_metadata || {};
      const role = String(meta.role || "").toLowerCase();
      if (role !== "agent") continue;

      totalAgents++;
      const parent = String(meta.parent_ma_code || "").trim().toUpperCase();
      if (!parent) continue;

      counts[parent] = (counts[parent] || 0) + 1;
    }

    const byMasterAgent = Object.entries(counts)
      .map(([ma_code, agent_count]) => ({ ma_code, agent_count }))
      .sort((a, b) => b.agent_count - a.agent_count);

    return json(200, {
      ok: true,
      totalUsers: allUsers.length,
      totalAgents,
      byMasterAgent,
    });
  } catch (err) {
    console.error("admin-agent-stats error:", err);
    return json(500, { ok: false, error: err?.message || "Server error" });
  }
}
