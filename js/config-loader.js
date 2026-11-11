(function (STB) {
  "use strict";

  // Resolves once we know whether sync is configured. Never rejects -- if the endpoint
  // is missing (plain static hosting, local python server, offline) or returns nothing
  // configured yet, the app just continues in guest/local-only mode.
  //
  // Two guards, both learned the hard way: a missing fetch implementation, or a
  // synchronous throw, used to abort this whole script. Because app.html loads each
  // module as its own <script> that only took down the config probe -- but anywhere the
  // modules are bundled or inlined together, the same throw would stop everything after
  // it from loading at all.
  STB.configReady = (typeof fetch !== "function")
    ? Promise.resolve()
    : fetch("/api/config", { headers: { Accept: "application/json" } })
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
