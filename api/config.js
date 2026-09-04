// Vercel serverless function (runs server-side on Vercel's infrastructure, not in the
// browser). Reads the actual secret values from Environment Variables set in your Vercel
// project dashboard, and hands back only what the client needs to connect.
//
// Set these in Vercel: Project -> Settings -> Environment Variables
//   SUPABASE_URL       = your project's URL (Project Settings -> API in Supabase)
//   SUPABASE_ANON_KEY  = your project's anon public key (same page)
//
// Nothing here is a build-time secret baked into shipped files -- it's read fresh on
// every request, straight from Vercel's environment variable store.

module.exports = (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    url: process.env.SUPABASE_URL || null,
    anonKey: process.env.SUPABASE_ANON_KEY || null,
  });
};
