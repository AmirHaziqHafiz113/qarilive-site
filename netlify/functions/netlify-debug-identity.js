// netlify/functions/netlify-debug-identity.js
// Purpose: prove whether your NETLIFY_SITE_ID + NETLIFY_IDENTITY_TOKEN can access
// (1) the site, and (2) the Identity Admin users endpoint.
// Open: https://YOURDOMAIN/.netlify/functions/netlify-debug-identity

exports.handler = async () => {
  try {
    const SITE_ID = process.env.NETLIFY_SITE_ID;
    const TOKEN = process.env.NETLIFY_IDENTITY_TOKEN;

    // Basic env check
    if (!SITE_ID || !TOKEN) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ok: false,
          error: "Missing NETLIFY_SITE_ID or NETLIFY_IDENTITY_TOKEN",
          SITE_ID_present: !!SITE_ID,
          TOKEN_present: !!TOKEN,
        }),
      };
    }

    const headers = {
      Authorization: `Bearer ${TOKEN}`,
      "User-Agent": "qarilive-debug",
      Accept: "application/json",
    };

    // 1) Check if the token can access the site at all
    const siteUrl = `https://api.netlify.com/api/v1/sites/${SITE_ID}`;
    const siteRes = await fetch(siteUrl, { headers });
    const siteText = await siteRes.text();

    // 2) Check if Identity Admin endpoint exists
    const identityUrl = `https://api.netlify.com/api/v1/sites/${SITE_ID}/identity/users?per_page=1`;
    const idRes = await fetch(identityUrl, { headers });
    const idText = await idRes.text();

    // Return a trimmed preview (don’t leak full data)
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: true,
        env: { SITE_ID: SITE_ID, TOKEN_present: true },
        checks: {
          site: {
            url: siteUrl,
            status: siteRes.status,
            ok: siteRes.ok,
            body_preview: siteText.slice(0, 300),
          },
          identity_users: {
            url: identityUrl,
            status: idRes.status,
            ok: idRes.ok,
            body_preview: idText.slice(0, 300),
          },
        },
        next_steps_hint:
          "If site.status is 404 -> wrong SITE_ID. If site.status is 401/403 -> bad token. If site.status is 200 but identity_users.status is 404 -> Identity Admin endpoint not enabled/available for that site.",
      }),
    };
  } catch (err) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: false,
        error: "Unexpected error in debug function",
        message: err?.message || String(err),
      }),
    };
  }
};
