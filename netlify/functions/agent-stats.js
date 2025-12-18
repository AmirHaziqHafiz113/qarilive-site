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

function getRole(u) {
  const meta = u.user_metadata || {};
  const r1 = String(meta.role || "").trim().toLowerCase();
  if (r1) return r1;

  const roles = u.app_metadata?.roles;
  if (Array.isArray(roles) && roles.length) return String(roles[0] || "").trim().toLowerCase();

  return "";
}

// master agent “code” can be stored under different keys in your current data
function getMasterAgentCode(u) {
  const meta = u.user_metadata || {};
  const code =
    meta.ma_code ||
    meta.parent_ma_code || // (you currently show MA codes in “Parent MA”, so many of yours are here)
    meta.ma_ref ||
    meta.ref ||
    meta.parent_ma ||
    "";
  return String(code || "").trim().toUpperCase();
}

// agent -> which master agent it belongs to
function getAgentParentCode(u) {
  const meta = u.user_metadata || {};
  const code =
    meta.parent_ma_code || // preferred
    meta.ma_code ||        // many implementations store parent here
    meta.parent_ma ||
    "";
  return String(code || "").trim().toUpperCase();
}

export async function handler(event, context) {
  try {
    if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
    if (event.httpMethod !== "GET") return json(405, { ok: false, error: "Method not allowed" });

    const token = getBearerToken(event);
    if (!token) return json(401, { ok: false, error: "Unauthorized" });
    if (!isAdmin(token)) return json(403, { ok: false, error: "Forbidden (admin only)" });

    const identity = context?.clientContext?.identity;
    if (!identity?.url || !identity?.token) {
      return json(500, {
        ok: false,
        error: "Identity admin token not available in function context. Ensure Identity is enabled on THIS site + redeploy.",
      });
    }

    const base = String(identity.url).replace(/\/$/, "");
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
      const usersArr = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.users)
          ? parsed.users
          : [];

      allUsers.push(...usersArr);

      const link = res.headers.get("link") || res.headers.get("Link") || "";
      url = parseNextLink(link);
    }

    // 1) collect master agents (so we can show them even if counts are 0)
    const masterAgents = [];
    for (const u of allUsers) {
      const role = getRole(u);
      if (role !== "master_agent") continue;
      const code = getMasterAgentCode(u);
      if (!code) continue;
      masterAgents.push(code);
    }

    // unique codes
    const masterSet = new Set(masterAgents);

    // 2) count agents by parent master agent code
    const counts = {};
    let totalAgents = 0;

    for (const u of allUsers) {
      const role = getRole(u);
      if (role !== "agent") continue;

      totalAgents++;
      const parent = getAgentParentCode(u);
      if (!parent) continue;

      counts[parent] = (counts[parent] || 0) + 1;
      masterSet.add(parent); // include even if master not found in list
    }

    // 3) build chart list INCLUDING master agents with 0
    const byMasterAgent = Array.from(masterSet)
      .map((ma_code) => ({ ma_code, agent_count: counts[ma_code] || 0 }))
      .sort((a, b) => b.agent_count - a.agent_count || a.ma_code.localeCompare(b.ma_code));

    return json(200, {
      ok: true,
      totalUsers: allUsers.length,
      totalAgents,
      totalMasterAgents: masterAgents.length,
      byMasterAgent,
    });
  } catch (err) {
    console.error("agent-stats error:", err);
    return json(500, { ok: false, error: err?.message || "Server error" });
  }
}
