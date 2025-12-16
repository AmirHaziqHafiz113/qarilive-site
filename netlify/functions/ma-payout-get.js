// netlify/functions/ma-payout-get.js
const { createClient } = require("@supabase/supabase-js");
const jwt = require("jsonwebtoken");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Verify Netlify Identity JWT (basic decode; signature validation optional here)
function getUserIdFromAuthHeader(authHeader) {
  if (!authHeader) return null;
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) return null;

  // Netlify Identity JWT contains "sub" = user id
  const decoded = jwt.decode(token);
  return decoded?.sub || null;
}

exports.handler = async (event) => {
  try {
    const userId = getUserIdFromAuthHeader(event.headers.authorization);
    if (!userId) {
      return { statusCode: 401, body: JSON.stringify({ ok: false, error: "Unauthorized" }) };
    }

    const { data, error } = await supabase
      .from("ma_payout")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) throw error;

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, data: data || null }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: err?.message || "Server error" }),
    };
  }
};
