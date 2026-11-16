// Vercel serverless function. Stripe calls this endpoint directly (not the browser) when
// something happens to a payment or subscription. This is the ONLY place `is_paid` gets set
// to true for a Stripe customer -- the client never sets it itself, which is what makes the
// trial lock trustworthy rather than something a user could fake from devtools.
//
// Setup, once this is deployed:
//   1. Stripe Dashboard -> Developers -> Webhooks -> Add endpoint
//      URL: https://<your-domain>/api/stripe-webhook
//      Events: checkout.session.completed
//              customer.subscription.created
//              customer.subscription.updated
//              customer.subscription.deleted
//   2. Copy the "Signing secret" Stripe shows you into Vercel's env vars as
//      STRIPE_WEBHOOK_SECRET, then redeploy.
//
// Required Environment Variables (in addition to the ones create-checkout-session.js needs):
//   STRIPE_WEBHOOK_SECRET      = the signing secret from step 2 above
//   SUPABASE_SERVICE_ROLE_KEY  = Supabase Dashboard -> Project Settings -> API -> service_role
//                                key (NOT the anon key -- this one bypasses RLS, so it must
//                                only ever be used here on the server, never in the browser)
//
// The profiles table needs two columns for any of this to stick:
//   alter table public.profiles add column if not exists stripe_customer_id text;
//   alter table public.profiles add column if not exists stripe_subscription_id text;
//   create index if not exists profiles_stripe_customer_idx
//     on public.profiles (stripe_customer_id);
// (see STRIPE-SETUP.md -- the webhook still records the payment without them, but it cannot
//  then match a later cancellation back to the account.)

const Stripe = require("stripe");

// Vercel needs the exact raw request bytes to verify Stripe's signature -- if the body were
// parsed to JSON first, the byte-for-byte signature check would fail.
module.exports.config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    req.on("data", function (chunk) { chunks.push(chunk); });
    req.on("end", function () { resolve(Buffer.concat(chunks)); });
    req.on("error", reject);
  });
}

// PATCH one row of profiles. Returns { ok, status, text } rather than throwing, so the caller
// can decide whether a retry without the Stripe columns is worth trying.
async function patchProfile(filter, body) {
  var res = await fetch(process.env.SUPABASE_URL + "/rest/v1/profiles?" + filter, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY,
      Prefer: "return=minimal",
    },
    body: JSON.stringify(body),
  });
  var text = "";
  try { text = await res.text(); } catch (e) {}
  return { ok: res.ok, status: res.status, text: text };
}

// Writes the payment state. If the profiles table hasn't had the Stripe columns added yet
// (see the note at the top), PostgREST rejects the whole PATCH and the customer who just paid
// would stay locked out -- so retry with only the columns that already exist, and make the
// missing-migration state loud in the logs.
async function writePaymentState(filter, full, minimal) {
  var attempt = await patchProfile(filter, full);
  if (attempt.ok) return attempt;
  console.error("Stripe webhook: PATCH failed", attempt.status, attempt.text,
    "-- retrying without the stripe_* columns. Run the SQL in STRIPE-SETUP.md.");
  return patchProfile(filter, minimal);
}

// Stripe timestamps are seconds; profiles.paid_until is a timestamptz.
function isoFromUnix(seconds) {
  if (!seconds) return null;
  return new Date(seconds * 1000).toISOString();
}

// past_due is included on purpose: Stripe is still retrying the card, and cutting somebody
// off mid-retry is a worse experience than a couple of extra days of access.
function statusMeansPaid(status) {
  return status === "active" || status === "trialing" || status === "past_due";
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
      // Read the subscription so paid_until is right on the first paint, rather than waiting
      // for the customer.subscription.created event that follows a moment later.
      var periodEnd = null;
      if (session.subscription) {
        try {
          var sub = await stripe.subscriptions.retrieve(session.subscription);
          periodEnd = isoFromUnix(sub.current_period_end);
        } catch (e) {
          console.error("Stripe webhook: could not read the new subscription", e.message);
        }
      }
      if (userId) {
        var full = { is_paid: true };
        var minimal = { is_paid: true };
        if (session.customer) { full.stripe_customer_id = session.customer; }
        if (session.subscription) { full.stripe_subscription_id = session.subscription; }
        if (periodEnd) { full.paid_until = periodEnd; minimal.paid_until = periodEnd; }
        await writePaymentState("user_id=eq." + encodeURIComponent(userId), full, minimal);
      }
    } else if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated"
    ) {
      var liveSub = event.data.object;
      var paid = statusMeansPaid(liveSub.status);
      var liveFull = { is_paid: paid };
      var liveMinimal = { is_paid: paid };
      var endsAt = isoFromUnix(liveSub.current_period_end);
      if (endsAt) { liveFull.paid_until = endsAt; liveMinimal.paid_until = endsAt; }
      if (liveSub.customer) { liveFull.stripe_customer_id = liveSub.customer; }
      if (liveSub.id) { liveFull.stripe_subscription_id = liveSub.id; }
      // Match on the metadata user id when it is there (it survives a customer column that
      // was never written), otherwise by customer.
      var metaUserId = liveSub.metadata && liveSub.metadata.supabase_user_id;
      var filter = metaUserId
        ? "user_id=eq." + encodeURIComponent(metaUserId)
        : "stripe_customer_id=eq." + encodeURIComponent(liveSub.customer);
      await writePaymentState(filter, liveFull, liveMinimal);
    } else if (event.type === "customer.subscription.deleted") {
      var goneSub = event.data.object;
      await writePaymentState(
        "stripe_customer_id=eq." + encodeURIComponent(goneSub.customer),
        { is_paid: false },
        { is_paid: false }
      );
    } else if (event.type === "invoice.payment_failed") {
      // No state change: Stripe keeps retrying and customer.subscription.updated tells us if
      // it ever truly lapses. Logged so a run of failures is visible in the Vercel logs.
      var failedInvoice = event.data.object;
      console.warn("Stripe invoice payment failed for customer", failedInvoice.customer,
        "attempt", failedInvoice.attempt_count);
    }
    res.status(200).json({ received: true });
  } catch (e) {
    console.error("Stripe webhook handling failed", e);
    // Still 200 -- Stripe retries on non-2xx, and a transient Supabase hiccup shouldn't cause
    // Stripe to hammer this endpoint. The event is visible in the Stripe dashboard either way.
    res.status(200).json({ received: true, note: "handled with errors, check server logs" });
  }
};
