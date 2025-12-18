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

export async function handler(event, context) {
  try {
    // CORS preflight
    if (event.httpMethod === "OPTIONS") return json(200, { ok: true });

    if (event.httpMethod !== "GET") return json(405, { ok: false, error: "Method not allowed" });

    // Must be logged in + admin (based on the caller's JWT)
    const token = getBearerToken(event);
    if (!token) return json(401, { ok: false, error: "Unauthorized" });
    if (!isAdmin(token)) return json(403, { ok: false, error: "Forbidden (admin only)" });

    // Netlify injects Identity admin info here (GoTrue admin token + url)
    const identity = context?.clientContext?.identity;
    if (!identity?.url || !identity?.token) {
      return json(500, {
        ok: false,
        error:
          "Identity admin token not available in function context. Check: Identity enabled on THIS site + redeploy.",
        hasIdentityUrl: !!identity?.url,
        hasIdentityToken: !!identity?.token,
      });
    }

    const base = String(identity.url).replace(/\/$/, ""); // e.g. https://<site>/.netlify/identity
    let url = `${base}/admin/users?per_page=100`;
    const headers = { Authorization: `Bearer ${identity.token}` };

    const allUsers = [];
    while (url) {
      const res = await fetch(url, { headers });
      const txt = await res.text().catch(() => "");

      if (!res.ok) {
        return json(res.status, {
          ok: false,
          error: "Failed to fetch users (GoTrue admin)",
          attempted: url,
          detail: txt,
        });
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

    // your existing aggregation logic (kept)
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
    console.error("agent-stats error:", err);
    return json(500, { ok: false, error: err?.message || "Server error" });
  }
}
