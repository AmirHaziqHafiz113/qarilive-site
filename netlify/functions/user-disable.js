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

function getGoTrueAdmin(context) {
  const identity = context?.clientContext?.identity;
  if (!identity?.url || !identity?.token) return null;
  const base = String(identity.url).replace(/\/$/, "");
  return { base, token: identity.token };
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
    const id = String(body.id || "").trim();
    if (!id) return json(400, { ok: false, error: "Missing id" });

    const authHeader = { Authorization: `Bearer ${gt.token}` };

    // 1) GET user
    const getUrl = `${gt.base}/admin/users/${id}`;
    const getRes = await fetch(getUrl, { headers: authHeader });
    const getTxt = await getRes.text().catch(() => "");
    if (!getRes.ok) return json(getRes.status, { ok: false, error: "Get user failed", attempted: getUrl, detail: getTxt });

    const user = JSON.parse(getTxt || "{}");

    // 2) PUT merged app_metadata with banned=true
    const user_metadata = user.user_metadata || {};
    const app_metadata = { ...(user.app_metadata || {}), banned: true };

    const putUrl = `${gt.base}/admin/users/${id}`;
    const putRes = await fetch(putUrl, {
      method: "PUT",
      headers: { ...authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ user_metadata, app_metadata }),
    });

    const putTxt = await putRes.text().catch(() => "");
    if (!putRes.ok) return json(putRes.status, { ok: false, error: "Disable failed", attempted: putUrl, detail: putTxt });

    return json(200, { ok: true });
  } catch (err) {
    console.error("user-disable error:", err);
    return json(500, { ok: false, error: err?.message || "Server error" });
  }
}
