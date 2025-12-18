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

function getUserId(event) {
  const auth = event.headers.authorization || event.headers.Authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : auth.trim();
  if (!token) return null;
  const decoded = jwt.decode(token);
  return decoded?.sub || null;
}

function safeStr(v) {
  return String(v ?? "").trim();
}

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") return json(405, { ok: false, error: "Method not allowed" });

    const agent_user_id = getUserId(event);
    if (!agent_user_id) return json(401, { ok: false, error: "Unauthorized" });

    const body = JSON.parse(event.body || "{}");

    const bank_name = safeStr(body.bank_name);
    const bank_account_name = safeStr(body.bank_account_name);
    const bank_account_number = safeStr(body.bank_account_number);

    if (!bank_name || !bank_account_name || !bank_account_number) {
      return json(400, { ok: false, error: "Missing bank fields." });
    }

    const sql = neon();

    await sql`
      INSERT INTO public.agent_payout_details
        (agent_user_id, bank_name, bank_account_name, bank_account_number, updated_at)
      VALUES
        (${agent_user_id}, ${bank_name}, ${bank_account_name}, ${bank_account_number}, NOW())
      ON CONFLICT (agent_user_id)
      DO UPDATE SET
        bank_name = EXCLUDED.bank_name,
        bank_account_name = EXCLUDED.bank_account_name,
        bank_account_number = EXCLUDED.bank_account_number,
        updated_at = NOW()
    `;

    return json(200, { ok: true });
  } catch (err) {
    console.error("agent-payout-set error:", err);
    return json(500, { ok: false, error: err?.message || "Server error" });
  }
}
