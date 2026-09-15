// Runs during `vercel build` (see vercel.json's "buildCommand"). Vercel injects
// Environment Variables into the build step too, so this can catch a half-configured
// deployment BEFORE it goes live -- rather than after a customer has already paid into it,
// which is what happened once (Razorpay was configured but SUPABASE_SERVICE_ROLE_KEY
// wasn't, so checkout worked but the unlock step silently failed).
//
// The rule: if you've turned Razorpay on at all (RAZORPAY_KEY_ID is set), every variable
// the payment flow needs must be set. Partial configuration fails the build with a clear
// list of what's missing, instead of shipping a broken "pay but don't unlock" flow.
//
// If you're not using Razorpay yet (RAZORPAY_KEY_ID unset), this script does nothing --
// it only enforces completeness once you've started turning it on.

const RAZORPAY_REQUIRED = [
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_PLAN_ID",
  "RAZORPAY_WEBHOOK_SECRET",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];

function main() {
  if (!process.env.RAZORPAY_KEY_ID) {
    // Razorpay isn't being enabled in this deployment -- nothing to check.
    console.log("[check-required-env] Razorpay not configured; skipping payment env check.");
    return;
  }

  var missing = RAZORPAY_REQUIRED.filter(function (name) {
    return !process.env[name];
  });

  if (missing.length > 0) {
    console.error("");
    console.error("========================================================================");
    console.error(" BUILD FAILED: Razorpay is partially configured.");
    console.error("");
    console.error(" RAZORPAY_KEY_ID is set, so this deployment will try to accept payments,");
    console.error(" but the following required Environment Variables are missing:");
    console.error("");
    missing.forEach(function (name) { console.error("   - " + name); });
    console.error("");
    console.error(" Add these in Vercel -> Project -> Settings -> Environment Variables,");
    console.error(" then redeploy. This check exists so a customer can never pay into a");
    console.error(" deployment that can't actually unlock their account.");
    console.error("========================================================================");
    console.error("");
    process.exit(1);
  }

  console.log("[check-required-env] All required Razorpay + Supabase env vars are present.");
}

main();
