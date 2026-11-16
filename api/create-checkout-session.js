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
//   STRIPE_PRICE_ID          = monthly price ID from Stripe -> Product catalog (starts "price_")
//   STRIPE_PRICE_ID_YEARLY   = optional yearly price ID; if unset, yearly simply isn't sold
//   STRIPE_AUTOMATIC_TAX     = optional, set to "1" once Stripe Tax is switched on in the
//                              dashboard, so EU/UK VAT is added at checkout automatically

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

  // Which price. Monthly unless the caller asks for yearly and a yearly price exists.
  var body = req.body || {};
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  var wantsYearly = body && body.plan === "yearly";
  var priceId = wantsYearly && process.env.STRIPE_PRICE_ID_YEARLY
    ? process.env.STRIPE_PRICE_ID_YEARLY
    : process.env.STRIPE_PRICE_ID;

  try {
    var params = {
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: user.id,
      customer_email: user.email,
      // On the session AND on the subscription: the subscription events that arrive after
      // checkout (renewals, cancellations) carry their own metadata, and that is what lets
      // the webhook find the account without relying on a customer id column existing yet.
      metadata: { supabase_user_id: user.id },
      subscription_data: { metadata: { supabase_user_id: user.id } },
      success_url: origin + "/app.html?checkout=success",
      cancel_url: origin + "/app.html?checkout=cancel",
    };
    // Stripe Tax is opt-in: turning it on in code before it's configured in the dashboard
    // makes every checkout fail. USD 0.5% of the sale is the cost of not doing EU/UK VAT by
    // hand -- see STRIPE-SETUP.md.
    if (process.env.STRIPE_AUTOMATIC_TAX === "1") {
      params.automatic_tax = { enabled: true };
      params.customer_update = { address: "auto", name: "auto" };
    }
    var session = await stripe.checkout.sessions.create(params);
    res.status(200).json({ url: session.url });
  } catch (e) {
    console.error("Stripe checkout session failed", e);
    res.status(500).json({ error: "Could not start checkout. Try again in a moment." });
  }
};
