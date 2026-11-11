(function (STB) {
  "use strict";

  // A one-line answer to "did that actually save?".
  //
  // In the old build, cloud pushes were fire-and-forget: a failed upsert only ever reached
  // console.error, so a user whose trial had expired, whose session had lapsed, or who was
  // offline kept happily typing into a board that was no longer being saved anywhere but
  // this one browser. This surfaces the same information the console already had, in the
  // header, where someone will actually notice it.

  var el = null;
  var current = null;

  var LABELS = {
    saved: { text: "Saved", title: "Everything on this board is saved to your account." },
    saving: { text: "Saving\u2026", title: "Sending your changes to your account." },
    error: { text: "Not saved", title: "Your changes are still on this device but couldn't be saved to your account." },
    readonly: { text: "View only", title: "Your free trial has ended, so changes can't be saved." },
    offline: { text: "Offline", title: "You're offline. Changes are kept on this device and saved when you reconnect." },
    local: { text: "This device only", title: "Accounts aren't configured here, so this board lives in this browser only." },
  };

  function paint(state, detail) {
    current = state;
    if (!el) return;
    var conf = LABELS[state] || LABELS.saved;
    el.className = "stb-sync-status is-" + state;
    el.setAttribute("title", detail || conf.title);
    el.innerHTML = '<span class="stb-sync-dot" aria-hidden="true"></span><span>' + conf.text + "</span>";
    // Screen readers get the change announced, sighted users just see the dot change.
    el.setAttribute("aria-label", "Save status: " + conf.text + (detail ? ". " + detail : ""));
  }

  // Note: this used to carry a guard that ignored any "saved" arriving while the pill
  // showed "saving" -- the intent being to stop a slow older request from overwriting a
  // newer one's result. With no way to tell those apart, the effect was that the very
  // first save flipped the pill to "Saving..." and it never came back. Ordering is now
  // handled properly in js/sync.js (every push carries a sequence number and only the
  // newest one paints), so this is a plain setter again.
  STB.setSyncStatus = function (state, detail) {
    if (!el) el = document.getElementById("stb-sync-status");
    if (!el) return;
    paint(state, detail);
  };

  STB.initSyncStatus = function () {
    el = document.getElementById("stb-sync-status");
    if (!el) return;
    var syncConfigured = !!(STB.isSyncAvailable && STB.isSyncAvailable());
    if (!navigator.onLine) paint("offline");
    else paint(syncConfigured ? "saved" : "local");
    window.addEventListener("online", function () {
      paint(syncConfigured ? "saved" : "local");
      if (STB.syncPush) STB.syncPush();
    });
    window.addEventListener("offline", function () { paint("offline"); });
  };
})(window.STB = window.STB || {});
