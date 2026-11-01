// Vercel serverless function, called once a day by the cron in vercel.json.
// It makes one tiny read to Supabase so the free-tier project never looks idle and
// gets auto-paused. Reads a single row from the public "usernames" table, which the
// anon key is already allowed to read (that's how username availability works).

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    return res.status(500).json({ ok: false, error: "SUPABASE_URL / SUPABASE_ANON_KEY not set" });
  }
  try {
    const r = await fetch(url.replace(/\/$/, "") + "/rest/v1/usernames?select=username_lower&limit=1", {
      headers: { apikey: key, Authorization: "Bearer " + key },
    });
    console.log("[keep-alive] Supabase responded with status " + r.status);
    return res.status(r.ok ? 200 : 502).json({ ok: r.ok, status: r.status });
  } catch (e) {
    console.error("[keep-alive] failed:", e && e.message);
    return res.status(502).json({ ok: false, error: "fetch failed" });
  }
};
