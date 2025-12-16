// netlify/functions/ma-payout-set.js
const { createClient } = require("@supabase/supabase-js");
const jwt = require("jsonwebtoken");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function getUserIdFromAuthHeader(authHeader) {
  if (!authHeader) return null;
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) return null;
  const decoded = jwt.decode(token);
  return decoded?.sub || null;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ ok: false, error: "Method not allowed" }) };
    }

    const userId = getUserIdFromAuthHeader(event.headers.authorization);
    if (!userId) {
      return { statusCode: 401, body: JSON.stringify({ ok: false, error: "Unauthorized" }) };
    }

    const body = JSON.parse(event.body || "{}");

    // Whitelist fields (prevents someone sending weird extra fields)
    const payload = {
      user_id: userId,
      full_name: (body.full_name || "").trim(),
      whatsapp: (body.whatsapp || "").trim(),
      bank_name: (body.bank_name || "").trim(),
      bank_account_name: (body.bank_account_name || "").trim(),
      bank_account_number: (body.bank_account_number || "").trim(),
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("ma_payout")
      .upsert(payload, { onConflict: "user_id" });

    if (error) throw error;

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: err?.message || "Server error" }),
    };
  }
};
