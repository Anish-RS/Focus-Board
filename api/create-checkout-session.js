// Vercel serverless function. The client (see STB.startCheckout in js/sync.js) calls this
// with the signed-in user's Supabase access token in the Authorization header. This
// function verifies that token against Supabase itself (so nobody can start a Checkout
// session as a user they aren't), then asks Stripe for a hosted Checkout page and hands
// back its URL for the browser to redirect to.
//
// Required Environment Variables (Vercel -> Project -> Settings -> Environment Variables):
//   SUPABASE_URL        = same value already used by api/config.js
//   SUPABASE_ANON_KEY    = same value already used by api/config.js
//   STRIPE_SECRET_KEY   = Stripe Dashboard -> Developers -> API keys -> Secret key
//   STRIPE_PRICE_ID     = Stripe Dashboard -> Product catalog -> your subscription price's ID (starts "price_")

const Stripe = require("stripe");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PRICE_ID) {
    res.status(500).json({ error: "Payments aren't configured on this deployment yet." });
    return;
  }

  var authHeader = req.headers["authorization"] || "";
  var token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) {
    res.status(401).json({ error: "Not signed in." });
    return;
  }

  // Verify the token directly against Supabase's auth API -- this confirms the token is
  // real and current, and tells us exactly which user it belongs to, without needing the
  // full supabase-js SDK on the server.
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

  var origin = "https://" + req.headers.host;
  var stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    var session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      client_reference_id: user.id,
      customer_email: user.email,
      metadata: { supabase_user_id: user.id },
      success_url: origin + "/app.html?checkout=success",
      cancel_url: origin + "/app.html?checkout=cancel",
    });
    res.status(200).json({ url: session.url });
  } catch (e) {
    console.error("Stripe checkout session failed", e);
    res.status(500).json({ error: "Could not start checkout. Try again in a moment." });
  }
};
