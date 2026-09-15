// Vercel serverless function. Called right after the Razorpay checkout widget closes
// successfully (see js/sync.js's STB.startCheckout). This gives an immediate unlock
// instead of the user waiting on the webhook to arrive -- the webhook (razorpay-webhook.js)
// still runs independently and is what handles renewals, failures, and cancellations, so
// this endpoint is a fast path, not the only path.
//
// Required Environment Variables: same as create-subscription.js, plus:
//   SUPABASE_SERVICE_ROLE_KEY  = Supabase Dashboard -> Project Settings -> API -> service_role key
//                                (server-only -- never ships to the browser)

const crypto = require("crypto");

function supabaseAdminPatch(path, body) {
  return fetch(process.env.SUPABASE_URL + "/rest/v1/" + path, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY,
      Prefer: "return=minimal",
    },
    body: JSON.stringify(body),
  });
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!process.env.RAZORPAY_KEY_SECRET || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).json({ error: "Payments aren't fully configured on this deployment yet." });
    return;
  }

  var authHeader = req.headers["authorization"] || "";
  var token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) {
    res.status(401).json({ error: "Not signed in." });
    return;
  }

  var user;
  try {
    var userRes = await fetch(process.env.SUPABASE_URL + "/auth/v1/user", {
      headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: "Bearer " + token },
    });
    if (!userRes.ok) { res.status(401).json({ error: "Your session has expired -- sign in again." }); return; }
    user = await userRes.json();
  } catch (e) {
    res.status(500).json({ error: "Could not verify your session." });
    return;
  }

  var paymentId = req.body && req.body.razorpay_payment_id;
  var subscriptionId = req.body && req.body.razorpay_subscription_id;
  var signature = req.body && req.body.razorpay_signature;
  if (!paymentId || !subscriptionId || !signature) {
    res.status(400).json({ error: "Missing payment details." });
    return;
  }

  // Razorpay's documented formula for verifying a subscription checkout's signature.
  var expected = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(paymentId + "|" + subscriptionId)
    .digest("hex");
  if (expected !== signature) {
    res.status(400).json({ error: "Payment verification failed." });
    return;
  }

  try {
    await supabaseAdminPatch("profiles?user_id=eq." + user.id, {
      is_paid: true,
      razorpay_subscription_id: subscriptionId,
    });
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error("Could not update profile after Razorpay payment", e);
    res.status(500).json({ error: "Payment succeeded, but updating your account failed -- contact support." });
  }
};
