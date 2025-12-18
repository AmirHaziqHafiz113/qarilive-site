import jwt from "jsonwebtoken";

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "POST,OPTIONS",
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
  const base = String(identity.url).replace(/\/$/, "");
  return { base, token: identity.token };
}

async function findUserIdByEmail({ base, token, email }) {
  let url = `${base}/admin/users?per_page=100`;
  const headers = { Authorization: `Bearer ${token}` };

  while (url) {
    const res = await fetch(url, { headers });
    const txt = await res.text().catch(() => "");
    if (!res.ok) throw new Error(`List users failed: ${res.status} ${txt}`);

    const parsed = JSON.parse(txt || "[]");

    // GoTrue may return either an array OR an object like { users: [...] }
    const usersArr = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.users)
        ? parsed.users
        : [];

    allUsers.push(...usersArr);

    const hit = users.find((u) => String(u.email || "").toLowerCase() === String(email).toLowerCase());
    if (hit?.id) return hit.id;

    const link = res.headers.get("link") || res.headers.get("Link") || "";
    url = parseNextLink(link);
  }
  return null;
}

export async function handler(event, context) {
  try {
    if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
    if (event.httpMethod !== "POST") return json(405, { ok: false, error: "Method not allowed" });

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

    const body = JSON.parse(event.body || "{}");
    const role = String(body.role || "").trim().toLowerCase();
    const email = String(body.email || "").trim().toLowerCase();
    const name = String(body.name || "").trim();
    const parent_ma = String(body.parent_ma || "").trim().toUpperCase();

    if (!email || !name) return json(400, { ok: false, error: "Email and name are required" });
    if (!["master_agent", "agent"].includes(role)) return json(400, { ok: false, error: "Invalid role" });
    if (role === "agent" && !parent_ma) return json(400, { ok: false, error: "Agent requires parent_ma" });

    const headers = {
      Authorization: `Bearer ${gt.token}`,
      "Content-Type": "application/json",
    };

    // 1) Invite user (they set password via email)
    const inviteUrl = `${gt.base}/admin/users/invite`;
    const inviteRes = await fetch(inviteUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ email }),
    });

    const inviteTxt = await inviteRes.text().catch(() => "");
    if (!inviteRes.ok) {
      return json(inviteRes.status, { ok: false, error: "Invite failed", attempted: inviteUrl, detail: inviteTxt });
    }

    // Some deployments return the user object; some return a message.
    let userId = null;
    try {
      const invited = JSON.parse(inviteTxt || "{}");
      userId = invited?.id || null;
    } catch (_) { }

    // If invite response didn't include ID, find by email.
    if (!userId) {
      userId = await findUserIdByEmail({ base: gt.base, token: gt.token, email });
    }
    if (!userId) return json(500, { ok: false, error: "Invite succeeded but could not locate created user id" });

    // 2) GET user so we can merge metadata safely
    const getUrl = `${gt.base}/admin/users/${userId}`;
    const getRes = await fetch(getUrl, { headers: { Authorization: `Bearer ${gt.token}` } });
    const getTxt = await getRes.text().catch(() => "");
    if (!getRes.ok) return json(getRes.status, { ok: false, error: "Get user failed", attempted: getUrl, detail: getTxt });

    const user = JSON.parse(getTxt || "{}");

    // 3) Update metadata + roles
    const user_metadata = {
      ...(user.user_metadata || {}),
      full_name: name,
      role,
      ...(role === "agent" ? { parent_ma_code: parent_ma } : {}),
    };

    const app_metadata = {
      ...(user.app_metadata || {}),
      roles: [role],
    };

    const putUrl = `${gt.base}/admin/users/${userId}`;
    const putRes = await fetch(putUrl, {
      method: "PUT",
      headers,
      body: JSON.stringify({ user_metadata, app_metadata }),
    });

    const putTxt = await putRes.text().catch(() => "");
    if (!putRes.ok) return json(putRes.status, { ok: false, error: "Update user failed", attempted: putUrl, detail: putTxt });

    return json(200, { ok: true, id: userId, email, role });
  } catch (err) {
    console.error("user-create error:", err);
    return json(500, { ok: false, error: err?.message || "Server error" });
  }
}
