(function (STB) {
  "use strict";

  // Resolves once we know whether sync is configured. Never rejects -- if the endpoint
  // is missing (plain static hosting, local python server, offline) or returns nothing
  // configured yet, the app just continues in guest/local-only mode.
  STB.configReady = fetch("/api/config")
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (cfg) {
      if (cfg && cfg.url && cfg.anonKey) {
        window.STB_SUPABASE_URL = cfg.url;
        window.STB_SUPABASE_ANON_KEY = cfg.anonKey;
      }
    })
    .catch(function () {
      // No /api/config available -- e.g. not hosted on Vercel, or env vars not set yet.
    });
})(window.STB = window.STB || {});
