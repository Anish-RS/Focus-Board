// Vercel Cron job (see vercel.json -- runs daily at 03:17 UTC). This is the safety net:
// even if a future deploy has some other config problem, or a webhook delivery fails, or
// Supabase is briefly down at the exact moment someone pays, this job compares Razorpay's
// own record of who's actively subscribed against Supabase's `profiles.is_paid` and fixes
// any mismatch it finds -- so a stuck "paid but shown as trial" account never lasts more
// than a day, without anyone needing to notice and fix it by hand.
//
// How the match works: create-subscription.js stores the Supabase user's id in the
// Razorpay subscription's `notes.supabase_user_id` field at creation time, specifically so
// this job can always find the right profile row even if the unlock step never ran.
//
// Required Environment Variables (all already used elsewhere in this project):
//   RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Plus one new one just for this endpoint:
//   CRON_SECRET  = any random string you generate yourself. Set it in Vercel's Environment
//                  Variables and Vercel automatically sends it as a Bearer token on every
//                  scheduled cron request, which is how this endpoint tells "the real daily
//                  cron" apart from a random person hitting the URL. You can also call this
//                  endpoint manually (e.g. from curl) with the same token to run it on demand.

function supabaseAdminFetch(path, options) {
  return fetch(process.env.SUPABASE_URL + "/rest/v1/" + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY,
      ...(options && options.headers),
    },
  });
}

// Razorpay subscription statuses that mean "this person should be marked paid" vs
// "should be marked not-paid". Statuses like "created"/"authenticated"/"pending" mean the
// subscription exists but hasn't actually been charged yet, so those are left alone.
var PAID_STATUSES = ["active"];
var UNPAID_STATUSES = ["completed", "cancelled", "expired", "halted"];

async function fetchAllRazorpaySubscriptions(basicAuth) {
  var all = [];
  var skip = 0;
  var pageSize = 100;
  var maxPages = 20; // 2000 subscriptions -- generous ceiling so this can't run away/timeout
  for (var page = 0; page < maxPages; page++) {
    var res = await fetch(
      "https://api.razorpay.com/v1/subscriptions?count=" + pageSize + "&skip=" + skip,
      { headers: { Authorization: "Basic " + basicAuth } }
    );
    if (!res.ok) {
      throw new Error("Razorpay subscriptions list failed: " + res.status);
    }
    var page_data = await res.json();
    var items = page_data.items || [];
    all = all.concat(items);
    if (items.length < pageSize) break;
    skip += pageSize;
  }
  return all;
}

module.exports = async (req, res) => {
  if (!process.env.CRON_SECRET) {
    res.status(500).json({ error: "CRON_SECRET isn't set on this deployment yet." });
    return;
  }
  var authHeader = req.headers["authorization"] || "";
  if (authHeader !== "Bearer " + process.env.CRON_SECRET) {
    res.status(401).json({ error: "Not authorized." });
    return;
  }
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).json({ error: "Payments aren't fully configured on this deployment yet." });
    return;
  }

  var basicAuth = Buffer.from(process.env.RAZORPAY_KEY_ID + ":" + process.env.RAZORPAY_KEY_SECRET).toString("base64");

  var fixed = [];
  var errors = [];
  try {
    var subscriptions = await fetchAllRazorpaySubscriptions(basicAuth);

    for (var i = 0; i < subscriptions.length; i++) {
      var sub = subscriptions[i];
      var userId = sub.notes && sub.notes.supabase_user_id;
      if (!userId) continue; // can't correlate this one to a Supabase user; skip it

      var desiredPaid;
      if (PAID_STATUSES.indexOf(sub.status) !== -1) desiredPaid = true;
      else if (UNPAID_STATUSES.indexOf(sub.status) !== -1) desiredPaid = false;
      else continue; // "created" / "authenticated" / "pending" -- not decided yet

      try {
        var profileRes = await supabaseAdminFetch("profiles?user_id=eq." + userId + "&select=is_paid,razorpay_subscription_id");
        var profiles = await profileRes.json();
        var profile = profiles && profiles[0];
        if (!profile) continue; // no matching profile row (shouldn't normally happen)

        var needsUpdate = profile.is_paid !== desiredPaid || profile.razorpay_subscription_id !== sub.id;
        if (!needsUpdate) continue;

        var patchRes = await supabaseAdminFetch("profiles?user_id=eq." + userId, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ is_paid: desiredPaid, razorpay_subscription_id: sub.id }),
        });
        if (!patchRes.ok) {
          errors.push({ user_id: userId, subscription_id: sub.id, error: "Supabase patch failed: " + patchRes.status });
          continue;
        }
        fixed.push({ user_id: userId, subscription_id: sub.id, set_is_paid: desiredPaid, was: profile.is_paid });
      } catch (innerErr) {
        errors.push({ user_id: userId, subscription_id: sub.id, error: String(innerErr) });
      }
    }
  } catch (e) {
    console.error("Payment reconciliation run failed", e);
    res.status(500).json({ error: "Reconciliation run failed", detail: String(e) });
    return;
  }

  if (fixed.length > 0) {
    console.log("Payment reconciliation fixed " + fixed.length + " profile(s):", JSON.stringify(fixed));
  }
  if (errors.length > 0) {
    console.error("Payment reconciliation hit " + errors.length + " error(s):", JSON.stringify(errors));
  }
  res.status(200).json({ checked: true, fixed: fixed.length, errors: errors.length, details: fixed });
};
