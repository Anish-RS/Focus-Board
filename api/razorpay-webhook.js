// Vercel serverless function. Razorpay calls this endpoint directly (not the browser) for
// subscription events -- most importantly recurring renewals succeeding, and cancellations
// or failed-payment halts. verify-razorpay-payment.js handles the *first* payment instantly
// for a snappy unlock; this webhook is what keeps `is_paid` correct for everything after that.
//
// Setup, once this is deployed:
//   1. Razorpay Dashboard -> Settings -> Webhooks -> Add New Webhook
//      URL: https://<your-domain>/api/razorpay-webhook
//      Active events: subscription.charged, subscription.cancelled, subscription.halted,
//                      subscription.completed
//   2. Set a secret there and copy it into Vercel as RAZORPAY_WEBHOOK_SECRET.
//
// Required Environment Variables (in addition to create-subscription.js's):
//   RAZORPAY_WEBHOOK_SECRET     = the secret you set in step 2 above
//   SUPABASE_SERVICE_ROLE_KEY   = same value used by verify-razorpay-payment.js

const crypto = require("crypto");

// Vercel needs the exact raw request bytes to verify Razorpay's signature.
module.exports.config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    req.on("data", function (chunk) { chunks.push(chunk); });
    req.on("end", function () { resolve(Buffer.concat(chunks)); });
    req.on("error", reject);
  });
}

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Reads the profile row for a subscription so a charge event can extend the paid period
// from wherever it currently is, and a "cancelled at cycle end" event doesn't cut access
// off mid-period.
async function supabaseAdminGet(path) {
  const r = await fetch(process.env.SUPABASE_URL + "/rest/v1/" + path, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY,
    },
  });
  if (!r.ok) throw new Error("Supabase read failed: " + r.status);
  return r.json();
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
  if (!process.env.RAZORPAY_WEBHOOK_SECRET || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).send("Payments aren't fully configured on this deployment yet.");
    return;
  }

  var rawBody = await readRawBody(req);
  var signature = req.headers["x-razorpay-signature"];
  var expected = crypto.createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest("hex");
  if (!safeEqual(signature, expected)) {
    console.error("Razorpay webhook signature check failed");
    res.status(400).send("Signature verification failed.");
    return;
  }

  var event;
  try {
    event = JSON.parse(rawBody.toString("utf8"));
  } catch (e) {
    res.status(400).send("Invalid payload.");
    return;
  }

  try {
    var sub = event.payload && event.payload.subscription && event.payload.subscription.entity;
    if (sub) {
      if (event.event === "subscription.charged") {
        // current_end is the end of the cycle this charge just paid for. That is the honest
        // answer to "full access until when?", and it's what the header badge counts down.
        var paidUntil = sub.current_end
          ? new Date(sub.current_end * 1000).toISOString()
          : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        await supabaseAdminPatch("profiles?razorpay_subscription_id=eq." + encodeURIComponent(sub.id), {
          is_paid: true,
          paid_until: paidUntil,
        });
      } else if (
        event.event === "subscription.cancelled" ||
        event.event === "subscription.halted" ||
        event.event === "subscription.completed"
      ) {
        // Don't yank access the instant a cancellation is registered: a subscription
        // cancelled with cancel_at_cycle_end still has time the user already paid for. Only
        // lock the board once that paid period is genuinely over.
        var rows = await supabaseAdminGet(
          "profiles?razorpay_subscription_id=eq." + encodeURIComponent(sub.id) + "&select=paid_until"
        );
        var stillPaid = rows && rows[0] && rows[0].paid_until && new Date(rows[0].paid_until).getTime() > Date.now();
        await supabaseAdminPatch("profiles?razorpay_subscription_id=eq." + encodeURIComponent(sub.id), {
          is_paid: !!stillPaid,
        });
      }
    }
    res.status(200).json({ received: true });
  } catch (e) {
    console.error("Razorpay webhook handling failed", e);
    // Still 200 -- Razorpay retries on non-2xx, and a transient Supabase hiccup shouldn't
    // cause it to hammer this endpoint. Visible in the Razorpay dashboard if something
    // needs a manual fix.
    res.status(200).json({ received: true, note: "handled with errors, check server logs" });
  }
};
