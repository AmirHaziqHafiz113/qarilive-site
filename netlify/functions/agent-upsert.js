import { neon } from "@netlify/neon";
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

function getIdentity(event) {
  const auth = event.headers.authorization || event.headers.Authorization || "";
  const token = auth.replace("Bearer ", "").trim();
  if (!token) return null;
  const decoded = jwt.decode(token);
  if (!decoded?.sub) return null;
  return { user_id: decoded.sub };
}

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { ok: false, error: "Method not allowed" });
    }

    const ident = getIdentity(event);
    if (!ident) return json(401, { ok: false, error: "Unauthorized" });

    const body = JSON.parse(event.body || "{}");

    const ma_code = String(body.ma_code || "").trim().toUpperCase();
    const full_name = String(body.full_name || "").trim();
    const whatsapp = String(body.whatsapp || "").trim();
    const email = String(body.email || "").trim().toLowerCase();

    if (!ma_code) return json(400, { ok: false, error: "Missing ma_code" });

    const sql = neon();

    // Ensure table exists (optional, remove if you already created it)
    await sql`
      CREATE TABLE IF NOT EXISTS public.agents (
        user_id TEXT PRIMARY KEY,
        ma_code TEXT NOT NULL,
        full_name TEXT,
        whatsapp TEXT,
        email TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        last_login TIMESTAMPTZ
      );
    `;

    await sql`
      INSERT INTO public.agents (user_id, ma_code, full_name, whatsapp, email, last_login)
      VALUES (${ident.user_id}, ${ma_code}, ${full_name}, ${whatsapp}, ${email}, NOW())
      ON CONFLICT (user_id)
      DO UPDATE SET
        ma_code = EXCLUDED.ma_code,
        full_name = EXCLUDED.full_name,
        whatsapp = EXCLUDED.whatsapp,
        email = EXCLUDED.email,
        last_login = NOW();
    `;

    return json(200, { ok: true });
  } catch (err) {
    console.error("agent-upsert error:", err);
    return json(500, { ok: false, error: err?.message || "Server error" });
  }
}
