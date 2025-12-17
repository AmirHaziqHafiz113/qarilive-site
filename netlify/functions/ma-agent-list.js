// netlify/functions/ma-agent-list.js

exports.handler = async (event, context) => {
  try {
    // ✅ Must be logged-in via Netlify Identity (Authorization: Bearer <jwt>)
    const authedUser = context?.clientContext?.user;
    if (!authedUser) {
      return json(401, { ok: false, error: "Unauthorized. Please login." });
    }

    const meta = authedUser.user_metadata || {};
    const role = String(meta.role || "").toLowerCase();
    const myMaCode = String(meta.ma_code || "").trim().toUpperCase();

    if (role !== "master_agent") {
      return json(403, { ok: false, error: "Forbidden. Only master_agent can access this." });
    }

    const maCode = String(event.queryStringParameters?.ma_code || "")
      .trim()
      .toUpperCase();

    if (!maCode) {
      return json(400, { ok: false, error: "Missing ma_code. Example: ?ma_code=MA897" });
    }

    // ✅ Only allow MA to fetch their own agents
    if (!myMaCode || myMaCode !== maCode) {
      return json(403, { ok: false, error: "Forbidden. ma_code does not match your account." });
    }

    const SITE_ID = process.env.NETLIFY_SITE_ID;
    const TOKEN = process.env.NETLIFY_IDENTITY_TOKEN;

    if (!SITE_ID || !TOKEN) {
      return json(500, {
        ok: false,
        error: "Missing NETLIFY_SITE_ID or NETLIFY_IDENTITY_TOKEN in environment variables."
      });
    }

    // Pull users from Netlify Identity Admin API (pagination supported)
    let page = 1;
    const perPage = 1000;
    const agents = [];

    while (true) {
      const url = `https://api.netlify.com/api/v1/sites/${SITE_ID}/identity/users?page=${page}&per_page=${perPage}`;

      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json"
        }
      });

      if (!res.ok) {
        const t = await res.text().catch(() => "");
        return json(res.status, {
          ok: false,
          error: "Failed to fetch Identity users from Netlify API.",
          details: t.slice(0, 500)
        });
      }

      const users = await res.json();
      if (!Array.isArray(users) || users.length === 0) break;

      for (const u of users) {
        const um = u?.user_metadata || {};
        const uRole = String(um.role || "").toLowerCase();

        // ✅ IMPORTANT: We count Agents by:
        // role === "agent" AND ma_ref === MA_CODE
        const maRef = String(um.ma_ref || um.parent_ma_code || "")
          .trim()
          .toUpperCase();

        if (uRole === "agent" && maRef === maCode) {
          agents.push({
            id: u.id,
            email: u.email || "",
            full_name: um.full_name || "",
            whatsapp: um.whatsapp || "",
            ma_ref: maRef,
            created_at: u.created_at || "",
            last_login: u.last_login || ""
          });
        }
      }

      if (users.length < perPage) break;
      page++;
    }

    // sort by newest first
    agents.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));

    return json(200, { ok: true, ma_code: maCode, count: agents.length, agents });

  } catch (err) {
    return json(500, { ok: false, error: err?.message || "Server error" });
  }
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(body)
  };
}
