// Vercel serverless function. Lets a signed-in, paying user cancel their own Razorpay
// subscription from the app (the "Cancel plan" button in the header).
//
// - An active subscription is cancelled at the END of the current billing period, so the
//   user keeps the access they've already paid for. Razorpay then fires
//   subscription.cancelled, which api/razorpay-webhook.js turns into is_paid = false.
// - A subscription that hasn't been charged yet (still "created"/"authenticated") is
//   cancelled immediately, since there's no paid period to keep.
//
// Required Environment Variables (all already set for the other payment functions):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
//   RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (
    !process.env.RAZORPAY_KEY_ID ||
    !process.env.RAZORPAY_KEY_SECRET ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY ||
    !process.env.SUPABASE_URL ||
    !process.env.SUPABASE_ANON_KEY
  ) {
    res.status(500).json({ error: "Payments aren't fully configured on this deployment yet." });
    return;
  }

  var token = (req.headers["authorization"] || "").replace(/^Bearer\s+/i, "");
  if (!token) {
    res.status(401).json({ error: "Not signed in." });
    return;
  }

  // 1. Work out which user this token really belongs to.
  var user;
  try {
    var userRes = await fetch(process.env.SUPABASE_URL + "/auth/v1/user", {
      headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: "Bearer " + token },
    });
    if (!userRes.ok) {
      res.status(401).json({ error: "Your session has expired -- sign in again." });
      return;
    }
    user = await userRes.json();
  } catch (e) {
    res.status(500).json({ error: "Could not verify your session." });
    return;
  }

  // 2. Find that user's own subscription id (service role bypasses RLS; the filter is the
  //    verified user id, so a caller can only ever cancel their own subscription).
  var subscriptionId;
  try {
    var profRes = await fetch(
      process.env.SUPABASE_URL + "/rest/v1/profiles?user_id=eq." + encodeURIComponent(user.id) + "&select=razorpay_subscription_id",
      {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY,
        },
      }
    );
    var rows = await profRes.json();
    subscriptionId = rows && rows[0] && rows[0].razorpay_subscription_id;
  } catch (e) {
    console.error("cancel-subscription: profile lookup failed", e);
    res.status(500).json({ error: "Could not look up your subscription." });
    return;
  }
  if (!subscriptionId) {
    res.status(404).json({ error: "No active subscription found on this account." });
    return;
  }

  var basic = Buffer.from(process.env.RAZORPAY_KEY_ID + ":" + process.env.RAZORPAY_KEY_SECRET).toString("base64");
  var rzpHeaders = { "Content-Type": "application/json", Authorization: "Basic " + basic };

  try {
    // 3. Check its current state so we pick the right kind of cancellation.
    var curRes = await fetch("https://api.razorpay.com/v1/subscriptions/" + subscriptionId, { headers: rzpHeaders });
    var cur = await curRes.json();
    if (!curRes.ok) {
      console.error("cancel-subscription: Razorpay lookup failed", cur);
      res.status(502).json({ error: "Could not reach the payment provider. Try again in a moment." });
      return;
    }
    if (cur.status === "cancelled" || cur.status === "completed" || cur.status === "expired") {
      res.status(200).json({ ok: true, status: cur.status, message: "Your subscription is already cancelled." });
      return;
    }

    var atCycleEnd = cur.status === "active" ? 1 : 0;
    var cancelRes = await fetch("https://api.razorpay.com/v1/subscriptions/" + subscriptionId + "/cancel", {
      method: "POST",
      headers: rzpHeaders,
      body: JSON.stringify({ cancel_at_cycle_end: atCycleEnd }),
    });
    var cancelled = await cancelRes.json();
    if (!cancelRes.ok) {
      console.error("cancel-subscription: Razorpay cancel failed", cancelled);
      res.status(502).json({ error: (cancelled.error && cancelled.error.description) || "Could not cancel right now." });
      return;
    }
    res.status(200).json({
      ok: true,
      status: cancelled.status,
      at_cycle_end: !!atCycleEnd,
      message: atCycleEnd
        ? "Your subscription is cancelled. You keep full access until the end of your current billing period."
        : "Your subscription is cancelled.",
    });
  } catch (e) {
    console.error("cancel-subscription: unexpected failure", e);
    res.status(500).json({ error: "Could not cancel right now. Try again in a moment." });
  }
};
