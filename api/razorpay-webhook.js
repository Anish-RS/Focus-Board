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
  if (signature !== expected) {
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
        await supabaseAdminPatch("profiles?razorpay_subscription_id=eq." + sub.id, { is_paid: true });
      } else if (
        event.event === "subscription.cancelled" ||
        event.event === "subscription.halted" ||
        event.event === "subscription.completed"
      ) {
        await supabaseAdminPatch("profiles?razorpay_subscription_id=eq." + sub.id, { is_paid: false });
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
