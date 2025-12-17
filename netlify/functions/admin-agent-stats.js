// netlify/functions/admin-agent-stats.js
exports.handler = async () => {
  try {
    const SITE_ID = process.env.NETLIFY_SITE_ID;
    const IDENTITY_TOKEN = process.env.NETLIFY_IDENTITY_TOKEN;

    if (!SITE_ID || !IDENTITY_TOKEN) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          ok: false,
          error: "Missing NETLIFY_SITE_ID or NETLIFY_IDENTITY_TOKEN in environment variables."
        })
      };
    }

    // Netlify Identity Admin API: list users
    // Docs: https://docs.netlify.com/visitor-access/identity/#identity-admin-api
    let url = `https://api.netlify.com/api/v1/sites/${SITE_ID}/identity/users?per_page=100`;
    const headers = { Authorization: `Bearer ${IDENTITY_TOKEN}` };

    const allUsers = [];
    while (url) {
      const res = await fetch(url, { headers });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        return {
          statusCode: res.status,
          body: JSON.stringify({ ok: false, error: "Failed to fetch users", detail: t })
        };
      }

      const users = await res.json();
      allUsers.push(...users);

      // pagination: Netlify uses Link header
      const link = res.headers.get("link") || res.headers.get("Link") || "";
      const next = parseNextLink(link);
      url = next;
    }

    // Filter: agents only, and count by parent_ma_code
    const counts = {}; // { MA897: 4, MA123: 9 }
    let totalAgents = 0;

    for (const u of allUsers) {
      const meta = u.user_metadata || {};
      const role = (meta.role || "").toLowerCase();
      if (role !== "agent") continue;

      totalAgents++;
      const parent = String(meta.parent_ma_code || "").trim().toUpperCase();
      if (!parent) continue;

      counts[parent] = (counts[parent] || 0) + 1;
    }

    // Make it a sorted array for table display
    const byMasterAgent = Object.entries(counts)
      .map(([ma_code, agent_count]) => ({ ma_code, agent_count }))
      .sort((a, b) => b.agent_count - a.agent_count);

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        totalUsers: allUsers.length,
        totalAgents,
        byMasterAgent
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: err?.message || "Server error" })
    };
  }
};

// Parse: Link: <...>; rel="next", <...>; rel="last"
function parseNextLink(linkHeader) {
  if (!linkHeader) return null;
  const parts = linkHeader.split(",");
  for (const p of parts) {
    const m = p.match(/<([^>]+)>;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}
