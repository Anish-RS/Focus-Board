// Vercel serverless function. Hands out a short-lived signed URL for the Windows installer --
// but only to a signed-in user whose account is actually paid.
//
// Why this exists at all: the installer CANNOT live in the repo. Everything in this repo is
// published by Vercel (outputDirectory "."), so a .exe sitting in the project root would have a
// public URL that anyone could guess or share, and "desktop is paid only" would be a promise
// rather than a fact. The file lives in a PRIVATE Supabase Storage bucket instead; nobody can
// read it without the service-role key, and the only thing that ever reaches a browser is a URL
// that expires five minutes later.
//
// Required Environment Variables (already set for the payment endpoints):
//   SUPABASE_URL               = https://<project-ref>.supabase.co
//   SUPABASE_ANON_KEY          = anon key (used to verify the caller's token)
//   SUPABASE_SERVICE_ROLE_KEY  = service_role key (server-only)
// Optional:
//   DESKTOP_APP_BUCKET = desktop-app             (default)
//   DESKTOP_APP_FILE   = Nudgeboard-Setup.exe    (default)

const SIGNED_URL_TTL = 300; // seconds -- long enough to click, short enough to not be shareable

function isPaid(profile) {
  if (!profile || !profile.is_paid) return false;
  if (!profile.paid_until) return true; // paid with no cycle end recorded
  return new Date(profile.paid_until).getTime() > Date.now();
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const base = process.env.SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !service) {
    res.status(500).json({ error: "Downloads aren't configured on this deployment yet." });
    return;
  }

  const token = (req.headers["authorization"] || "").replace(/^Bearer\s+/i, "");
  if (!token) {
    res.status(401).json({ error: "Sign in to download the desktop app." });
    return;
  }

  // ---- 1. who is asking? ----
  let user = null;
  try {
    const userRes = await fetch(base + "/auth/v1/user", {
      headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: "Bearer " + token },
    });
    if (!userRes.ok) {
      res.status(401).json({ error: "Your session has expired. Please sign in again." });
      return;
    }
    user = await userRes.json();
  } catch (e) {
    res.status(502).json({ error: "Couldn't reach the account service. Try again." });
    return;
  }
  if (!user || !user.id) {
    res.status(401).json({ error: "Your session has expired. Please sign in again." });
    return;
  }

  // ---- 2. are they paying? Same rule the app uses to unlock the board ----
  let profile = null;
  try {
    const profileRes = await fetch(
      base + "/rest/v1/profiles?user_id=eq." + encodeURIComponent(user.id) + "&select=is_paid,paid_until",
      { headers: { apikey: service, Authorization: "Bearer " + service } }
    );
    const rows = profileRes.ok ? await profileRes.json() : [];
    profile = rows && rows[0];
  } catch (e) {
    profile = null; // treated as unpaid -- fail closed, never open
  }
  if (!isPaid(profile)) {
    res.status(402).json({
      error: "The desktop app is included with the paid plan.",
      upgrade: true,
    });
    return;
  }

  // ---- 3. sign a URL to the private installer ----
  const bucket = process.env.DESKTOP_APP_BUCKET || "desktop-app";
  const file = process.env.DESKTOP_APP_FILE || "Nudgeboard-Setup.exe";
  try {
    const signRes = await fetch(
      base + "/storage/v1/object/sign/" + bucket + "/" + encodeURIComponent(file),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: service,
          Authorization: "Bearer " + service,
        },
        body: JSON.stringify({ expiresIn: SIGNED_URL_TTL }),
      }
    );
    const data = await signRes.json().catch(() => ({}));
    if (!signRes.ok || !data.signedURL) {
      const missing = signRes.status === 400 || signRes.status === 404;
      res.status(503).json({
        error: missing
          ? "The installer hasn't been uploaded yet. Try again soon."
          : "Couldn't prepare the download. Try again.",
      });
      return;
    }
    res.status(200).json({
      // Supabase returns a path relative to /storage/v1
      url: base + "/storage/v1" + data.signedURL,
      file: file,
      expiresIn: SIGNED_URL_TTL,
    });
  } catch (e) {
    res.status(502).json({ error: "Couldn't prepare the download. Try again." });
  }
};
