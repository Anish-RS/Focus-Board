// Vercel serverless function. Lets a signed-in, paying user cancel their own subscription
// from the app (the "Cancel plan" button in the header) -- Razorpay for Indian customers,
// Stripe for everyone else. The provider is decided here, on the server, from what is
// actually recorded on the profile, so the browser never has to know which one it is.
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
    (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) &&
    !process.env.STRIPE_SECRET_KEY
  ) {
    res.status(500).json({ error: "Payments aren't fully configured on this deployment yet." });
    return;
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
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
  var billingSubscriptionId;
  var billingCustomerId;
  var billingProvider;
  var adminHeaders = {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  try {
    // Ask for the Stripe columns too, but survive their absence: a deployment that hasn't run
    // the migration yet must still be able to cancel Razorpay subscriptions.
    var profRes = await fetch(
      process.env.SUPABASE_URL + "/rest/v1/profiles?user_id=eq." + encodeURIComponent(user.id) +
        "&select=razorpay_subscription_id,billing_subscription_id,billing_customer_id,billing_provider",
      { headers: adminHeaders }
    );
    var rows = await profRes.json();
    if (!profRes.ok) {
      profRes = await fetch(
        process.env.SUPABASE_URL + "/rest/v1/profiles?user_id=eq." + encodeURIComponent(user.id) +
          "&select=razorpay_subscription_id",
        { headers: adminHeaders }
      );
      rows = await profRes.json();
    }
    var row = rows && rows[0];
    subscriptionId = row && row.razorpay_subscription_id;
    billingSubscriptionId = row && row.billing_subscription_id;
    billingCustomerId = row && row.billing_customer_id;
    billingProvider = row && row.billing_provider;
  } catch (e) {
    console.error("cancel-subscription: profile lookup failed", e);
    res.status(500).json({ error: "Could not look up your subscription." });
    return;
  }

  // ---- international customers (Stripe today, Paddle when it's live) ----
  // Cancel at the end of the period, same promise as the Razorpay path: you keep what you
  // have paid for, and the provider's own webhook flips is_paid when it actually ends.
  if (!subscriptionId && billingSubscriptionId && billingProvider === "paddle") {
    // Written ahead of the switch so the button can never mis-cancel a Stripe customer as
    // though they were a Paddle one. Paddle's cancel endpoint is PATCH /subscriptions/{id}
    // with scheduled_change; wired up when the account is approved.
    res.status(501).json({
      error: "Cancelling a Paddle subscription from inside the app isn't wired up yet. Email us and we'll cancel it for you today.",
    });
    return;
  }

  if (!subscriptionId && billingSubscriptionId) {
    if (!process.env.STRIPE_SECRET_KEY) {
      res.status(500).json({ error: "Payments aren't fully configured on this deployment yet." });
      return;
    }
    try {
      var Stripe = require("stripe");
      var stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      var updated = await stripe.subscriptions.update(billingSubscriptionId, { cancel_at_period_end: true });
      res.status(200).json({
        ok: true,
        status: updated.status,
        at_cycle_end: true,
        message: "Your subscription is cancelled. You keep full access until the end of your current billing period.",
      });
      return;
    } catch (e) {
      console.error("cancel-subscription: Stripe cancel failed", e);
      res.status(502).json({ error: "Could not cancel right now. Try again in a moment." });
      return;
    }
  }

  if (!subscriptionId) {
    // A Stripe customer whose subscription id never got written (migration just run, or a
    // webhook that landed before the columns existed) can still be sent to the real thing.
    res.status(404).json({
      error: billingCustomerId
        ? "We couldn't find the subscription on this account automatically. Reply to any Nudgeboard email and we'll cancel it for you."
        : "No active subscription found on this account.",
    });
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
