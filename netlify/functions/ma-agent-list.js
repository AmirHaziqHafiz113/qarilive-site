// netlify/functions/ma-agent-list.js
// Lists Netlify Identity users by reading GoTrue admin API from function context.
// Requires caller to be logged in (Authorization: Bearer <user_jwt>).

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event, context) => {
  try {
    // 1) Must be authenticated (user JWT is validated by Netlify)
    const user = context?.clientContext?.user;
    if (!user) return json(401, { ok: false, error: "Unauthorized. Please login." });

    // 2) Identity admin info provided by Netlify runtime (GoTrue)
    const identity = context?.clientContext?.identity;
    if (!identity?.url || !identity?.token) {
      return json(500, {
        ok: false,
        error:
          "Identity admin token not available in function context. Ensure Netlify Identity is enabled for this site.",
      });
    }

    // 3) Query param
    const maCode = (event.queryStringParameters?.ma_code || "").trim().toUpperCase();
    if (!maCode) return json(400, { ok: false, error: "Missing ma_code." });

    // 4) Fetch users from GoTrue admin API (paginate)
    const perPage = 100; // GoTrue commonly supports up to 100; safe value
    let page = 1;
    let all = [];

    while (true) {
      const url = `${identity.url}/admin/users?page=${page}&per_page=${perPage}`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${identity.token}`, // <-- admin token
          Accept: "application/json",
        },
      });

      const text = await res.text();
      if (!res.ok) {
        return json(500, {
          ok: false,
          error: "Failed to fetch users from GoTrue admin API.",
          details: text,
          status: res.status,
        });
      }

      const users = JSON.parse(text);
      if (!Array.isArray(users) || users.length === 0) break;

      all.push(...users);
      if (users.length < perPage) break; // last page
      page += 1;

      // safety limit (avoid infinite loop)
      if (page > 50) break;
    }

    // 5) Filter to only your Agents
    const agents = all
      .map((u) => {
        const meta = u.user_metadata || {};
        const role = String(meta.role || "").toLowerCase().trim();
        const maRef = String(meta.ma_ref || meta.parent_ma_code || "").toUpperCase().trim();

        if (role !== "agent") return null;
        if (maRef !== maCode) return null;

        return {
          id: u.id,
          email: u.email || "",
          full_name: meta.full_name || "",
          whatsapp: meta.whatsapp || "",
          created_at: u.created_at || null,
          last_login: u.last_login || null,
        };
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    return json(200, { ok: true, count: agents.length, agents });
  } catch (e) {
    return json(500, { ok: false, error: "Server error", message: e?.message || String(e) });
  }
};

return json(500, {
  ok: false,
  marker: "MA_AGENT_LIST_GOTRUE_V1",
  error: "Identity admin token not available in function context. Ensure Netlify Identity is enabled for this site.",
  debug: { hasUser: !!user, identityUrl: identity?.url || null, hasToken: !!identity?.token }
});

