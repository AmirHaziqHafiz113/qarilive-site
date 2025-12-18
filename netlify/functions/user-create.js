// netlify/functions/admin/user-create.js
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
  return Array.isArray(roles) && roles.includes("admin");
}

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") return json(405, { ok: false, error: "Method not allowed" });

    const token = getBearerToken(event);
    if (!token) return json(401, { ok: false, error: "Unauthorized" });
    if (!isAdmin(token)) return json(403, { ok: false, error: "Forbidden (admin only)" });

    const SITE_ID = process.env.NETLIFY_SITE_ID;
    const IDENTITY_TOKEN = process.env.NETLIFY_IDENTITY_TOKEN;
    if (!SITE_ID || !IDENTITY_TOKEN) {
      return json(500, { ok: false, error: "Missing NETLIFY_SITE_ID or NETLIFY_IDENTITY_TOKEN" });
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
      Authorization: `Bearer ${IDENTITY_TOKEN}`,
      "Content-Type": "application/json",
    };

    // 1) Invite user (they set password themselves)
    const inviteRes = await fetch(
      `https://api.netlify.com/api/v1/sites/${SITE_ID}/identity/users/invite`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ email }),
      }
    );
    const inviteTxt = await inviteRes.text().catch(() => "");
    if (!inviteRes.ok) {
      return json(inviteRes.status, { ok: false, error: "Invite failed", detail: inviteTxt });
    }
    const invitedUser = JSON.parse(inviteTxt || "{}");
    const userId = invitedUser?.id;
    if (!userId) return json(500, { ok: false, error: "Invite succeeded but missing user id" });

    // 2) Update metadata + roles
    const user_metadata = {
      ...(invitedUser.user_metadata || {}),
      full_name: name,
      role,
      ...(role === "agent" ? { parent_ma_code: parent_ma } : {}),
    };

    const app_metadata = {
      ...(invitedUser.app_metadata || {}),
      roles: [role],
    };

    const updRes = await fetch(
      `https://api.netlify.com/api/v1/sites/${SITE_ID}/identity/users/${userId}`,
      {
        method: "PUT",
        headers,
        body: JSON.stringify({ user_metadata, app_metadata }),
      }
    );

    const updTxt = await updRes.text().catch(() => "");
    if (!updRes.ok) return json(updRes.status, { ok: false, error: "Update user failed", detail: updTxt });

    return json(200, { ok: true, id: userId, email, role });
  } catch (err) {
    console.error("admin-user-create error:", err);
    return json(500, { ok: false, error: err?.message || "Server error" });
  }
}
