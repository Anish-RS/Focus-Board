// Vercel serverless function. Mirrors create-checkout-session.js but for Razorpay, which
// works differently from Stripe: instead of handing back a hosted page URL to redirect to,
// Razorpay wants the browser to open an in-page checkout widget using a subscription_id
// this function creates ahead of time. See js/sync.js's STB.startCheckout for the client side.
//
// Required Environment Variables (Vercel -> Project -> Settings -> Environment Variables):
//   SUPABASE_URL           = same value already used by api/config.js
//   SUPABASE_ANON_KEY       = same value already used by api/config.js
//   RAZORPAY_KEY_ID        = Razorpay Dashboard -> Settings -> API Keys -> Key ID
//   RAZORPAY_KEY_SECRET    = same page -> Key Secret
//   RAZORPAY_PLAN_ID       = Razorpay Dashboard -> Subscriptions -> Plans -> your plan's ID (starts "plan_")

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET || !process.env.RAZORPAY_PLAN_ID) {
    res.status(500).json({ error: "Payments aren't configured on this deployment yet." });
    return;
  }

  var authHeader = req.headers["authorization"] || "";
  var token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) {
    res.status(401).json({ error: "Not signed in." });
    return;
  }

  // Verify the token directly against Supabase's auth API -- confirms it's real and
  // current, and tells us exactly which user it belongs to.
  var user;
  try {
    var userRes = await fetch(process.env.SUPABASE_URL + "/auth/v1/user", {
      headers: {
        apikey: process.env.SUPABASE_ANON_KEY,
        Authorization: "Bearer " + token,
      },
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

  var basicAuth = Buffer.from(process.env.RAZORPAY_KEY_ID + ":" + process.env.RAZORPAY_KEY_SECRET).toString("base64");

  try {
    var subRes = await fetch("https://api.razorpay.com/v1/subscriptions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Basic " + basicAuth,
      },
      body: JSON.stringify({
        plan_id: process.env.RAZORPAY_PLAN_ID,
        customer_notify: 1,
        // Razorpay subscriptions require a total_count of billing cycles rather than
        // "forever" -- 120 monthly cycles (10 years) is the common stand-in for
        // "until cancelled" since nobody actually needs to keep tapping this button.
        total_count: 120,
        notes: { supabase_user_id: user.id },
      }),
    });
    var sub = await subRes.json();
    if (!subRes.ok) {
      console.error("Razorpay subscription creation failed", sub);
      res.status(500).json({ error: (sub.error && sub.error.description) || "Could not start checkout." });
      return;
    }
    res.status(200).json({ subscription_id: sub.id, key_id: process.env.RAZORPAY_KEY_ID });
  } catch (e) {
    console.error("Razorpay subscription creation failed", e);
    res.status(500).json({ error: "Could not start checkout. Try again in a moment." });
  }
};
