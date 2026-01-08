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
  const token = auth.replace("Bearer ", "").trim();
  if (!token) return null;
  const decoded = jwt.decode(token);
  return decoded?.sub || null;
}

function isValidXenditCheckoutUrl(url) {
  if (!url) return true; // allow empty
  // Accept only Xendit hosted checkout links
  return /^https:\/\/checkout\.xendit\.co\//i.test(url.trim());
}

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { ok: false, error: "Method not allowed" });
    }

    const userId = getUserId(event);
    if (!userId) {
      return json(401, { ok: false, error: "Unauthorized" });
    }

    const body = JSON.parse(event.body || "{}");

    const ma_code = (body.ma_code || "").trim().toUpperCase() || null;
    const full_name = (body.full_name || "").trim();
    const whatsapp = (body.whatsapp || "").trim();
    const bank_name = (body.bank_name || "").trim();
    const bank_account_name = (body.bank_account_name || "").trim();
    const bank_account_number = (body.bank_account_number || "").trim();

    // ✅ New: unique per master agent
    const checkout_url = (body.checkout_url || "").trim();

    if (!isValidXenditCheckoutUrl(checkout_url)) {
      return json(400, {
        ok: false,
        error: "Invalid checkout_url (must start with https://checkout.xendit.co/)",
      });
    }

    const sql = neon();

    await sql`
      INSERT INTO public.ma_payout (
        user_id,
        ma_code,
        full_name,
        whatsapp,
        bank_name,
        bank_account_name,
        bank_account_number,
        checkout_url,
        updated_at
      )
      VALUES (
        ${userId},
        ${ma_code},
        ${full_name},
        ${whatsapp},
        ${bank_name},
        ${bank_account_name},
        ${bank_account_number},
        ${checkout_url},
        NOW()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        ma_code = COALESCE(EXCLUDED.ma_code, public.ma_payout.ma_code),
        full_name = EXCLUDED.full_name,
        whatsapp = EXCLUDED.whatsapp,
        bank_name = EXCLUDED.bank_name,
        bank_account_name = EXCLUDED.bank_account_name,
        bank_account_number = EXCLUDED.bank_account_number,
        checkout_url = EXCLUDED.checkout_url,
        updated_at = NOW();
    `;

    return json(200, { ok: true });
  } catch (err) {
    return json(500, { ok: false, error: err.message });
  }
}
