// netlify/functions/ma-agent-count.js

exports.handler = async (event) => {
  try {
    const maCode = (event.queryStringParameters?.ma_code || "").trim().toUpperCase();
    if (!maCode) {
      return json(400, { ok: false, error: "Missing ma_code in query. Example: ?ma_code=MA897" });
    }

    const SITE_ID = process.env.NETLIFY_SITE_ID;
    const TOKEN = process.env.NETLIFY_IDENTITY_TOKEN;

    if (!SITE_ID || !TOKEN) {
      return json(500, {
        ok: false,
        error: "Missing NETLIFY_SITE_ID or NETLIFY_IDENTITY_TOKEN in environment variables."
      });
    }

    // Netlify Identity Admin API (list users)
    // We may need pagination if you have many users.
    let page = 1;
    const perPage = 1000;
    let count = 0;

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
        const meta = u?.user_metadata || {};
        const role = (meta.role || "").toLowerCase();

        // ✅ IMPORTANT: pick ONE standard key and keep consistent across your agent registration page
        // Recommended: meta.ma_ref = "MA897"
        const maRef = String(meta.ma_ref || meta.parent_ma_code || "").trim().toUpperCase();

        if (role === "agent" && maRef === maCode) count++;
      }

      // if less than perPage, no more pages
      if (users.length < perPage) break;
      page++;
    }

    return json(200, { ok: true, ma_code: maCode, count });

  } catch (err) {
    return json(500, { ok: false, error: err?.message || "Server error" });
  }
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(body)
  };
}
