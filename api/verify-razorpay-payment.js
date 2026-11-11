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

// Constant-time comparison. A plain `!==` on an HMAC leaks, byte by byte, how much of the
// guess was correct via response timing -- not a practical attack over the network for a
// 64-char hex digest, but there's no reason to leave it there when crypto gives us the
// safe version for free.
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
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
  if (!safeEqual(expected, signature)) {
    res.status(400).json({ error: "Payment verification failed." });
    return;
  }

  // The signature above proves "a real payment happened for this subscription". It does
  // NOT prove the subscription belongs to the account calling this endpoint -- the
  // signature is a property of the payment, not of the caller, so a valid
  // (payment_id, subscription_id, signature) triple could be replayed by a different
  // signed-in account and would otherwise unlock that account for free. So we now ask
  // Razorpay who the subscription was created for (we stamp notes.supabase_user_id at
  // creation time in create-subscription.js) and refuse to unlock anyone else.
  var subscription;
  try {
    var basic = Buffer.from(process.env.RAZORPAY_KEY_ID + ":" + process.env.RAZORPAY_KEY_SECRET).toString("base64");
    var subRes = await fetch("https://api.razorpay.com/v1/subscriptions/" + encodeURIComponent(subscriptionId), {
      headers: { Authorization: "Basic " + basic },
    });
    if (!subRes.ok) {
      console.error("Razorpay subscription lookup failed", subRes.status);
      res.status(502).json({ error: "Could not confirm the payment with the payment provider. If you were charged, email focusboard.support@gmail.com." });
      return;
    }
    subscription = await subRes.json();
  } catch (e) {
    console.error("Razorpay subscription lookup threw", e);
    res.status(502).json({ error: "Could not confirm the payment with the payment provider. If you were charged, email focusboard.support@gmail.com." });
    return;
  }

  var ownerId = subscription && subscription.notes && subscription.notes.supabase_user_id;
  if (!ownerId || ownerId !== user.id) {
    console.error("Payment verification rejected: subscription " + subscriptionId + " does not belong to user " + user.id);
    res.status(403).json({ error: "That payment doesn't belong to this account." });
    return;
  }

  // paid_until is what the client counts down ("Full access - N days left"). Razorpay
  // gives us the end of the paid cycle on the subscription itself; fall back to a month
  // out if it's missing so the field is never left empty.
  var paidUntil = subscription.current_end
    ? new Date(subscription.current_end * 1000).toISOString()
    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  try {
    var patchRes = await supabaseAdminPatch("profiles?user_id=eq." + encodeURIComponent(user.id), {
      is_paid: true,
      paid_until: paidUntil,
      razorpay_subscription_id: subscriptionId,
      razorpay_customer_id: subscription.customer_id || null,
    });
    if (!patchRes.ok) throw new Error("Supabase patch failed: " + patchRes.status);
    res.status(200).json({ ok: true, paid_until: paidUntil });
  } catch (e) {
    console.error("Could not update profile after Razorpay payment", e);
    res.status(500).json({ error: "Payment succeeded, but updating your account failed -- please email focusboard.support@gmail.com." });
  }
};
