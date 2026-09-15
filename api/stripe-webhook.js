// Vercel serverless function. Stripe calls this endpoint directly (not the browser) when
// something happens to a payment or subscription. This is the ONLY place `is_paid` gets
// set to true -- the client never sets it itself, which is what makes the trial lock
// actually trustworthy rather than something a user could fake from devtools.
//
// Setup, once this is deployed:
//   1. Stripe Dashboard -> Developers -> Webhooks -> Add endpoint
//      URL: https://<your-domain>/api/stripe-webhook
//      Events to send: checkout.session.completed, customer.subscription.deleted,
//                       customer.subscription.updated
//   2. Copy the "Signing secret" Stripe shows you into Vercel's env vars as STRIPE_WEBHOOK_SECRET.
//
// Required Environment Variables (in addition to the ones create-checkout-session.js needs):
//   STRIPE_WEBHOOK_SECRET      = the signing secret from step 2 above
//   SUPABASE_SERVICE_ROLE_KEY  = Supabase Dashboard -> Project Settings -> API -> service_role key
//                                (NOT the anon key -- this one bypasses RLS, so it must
//                                 only ever be used here on the server, never shipped to the browser)

const Stripe = require("stripe");

// Vercel needs the exact raw request bytes to verify Stripe's signature -- if the body
// were parsed to JSON first, the byte-for-byte signature check would fail.
module.exports.config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    req.on("data", function (chunk) { chunks.push(chunk); });
    req.on("end", function () { resolve(Buffer.concat(chunks)); });
    req.on("error", reject);
  });
}

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
  if (req.method !== "POST") {
    res.status(405).end();
    return;
  }
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).send("Payments aren't fully configured on this deployment yet.");
    return;
  }

  var stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  var rawBody = await readRawBody(req);
  var event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Stripe webhook signature check failed", err.message);
    res.status(400).send("Signature verification failed.");
    return;
  }

  try {
    if (event.type === "checkout.session.completed") {
      var session = event.data.object;
      var userId = session.client_reference_id || (session.metadata && session.metadata.supabase_user_id);
      if (userId) {
        await supabaseAdminPatch("profiles?user_id=eq." + userId, {
          is_paid: true,
          stripe_customer_id: session.customer,
          stripe_subscription_id: session.subscription,
        });
      }
    } else if (event.type === "customer.subscription.deleted") {
      var sub = event.data.object;
      await supabaseAdminPatch("profiles?stripe_customer_id=eq." + sub.customer, { is_paid: false });
    } else if (event.type === "customer.subscription.updated") {
      var updatedSub = event.data.object;
      var stillActive = updatedSub.status === "active" || updatedSub.status === "trialing";
      await supabaseAdminPatch("profiles?stripe_customer_id=eq." + updatedSub.customer, { is_paid: stillActive });
    }
    res.status(200).json({ received: true });
  } catch (e) {
    console.error("Stripe webhook handling failed", e);
    // Still 200 -- Stripe retries on non-2xx, and a transient Supabase hiccup shouldn't
    // cause Stripe to hammer this endpoint. The event is visible in the Stripe dashboard
    // either way if something needs a manual fix.
    res.status(200).json({ received: true, note: "handled with errors, check server logs" });
  }
};
