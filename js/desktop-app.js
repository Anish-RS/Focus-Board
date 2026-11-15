(function (STB) {
  "use strict";

  // The "Nudgeboard for Windows" card inside the app, shown when someone arrives from the
  // landing page with ?desktop=1. The landing page advertises the desktop app; THIS is where
  // the download is actually offered, because only here do we know whether the visitor is
  // signed in and whether their account is paid.
  //
  // The download itself never touches this file's logic beyond asking the server: the server
  // (api/desktop-download.js) checks the paid status and hands back a five-minute signed URL
  // to a private Supabase Storage object. Anything the browser could do on its own here could
  // be faked, so it doesn't.

  var cardEl = null;

  function wantsDesktop() {
    return /(\?|&)desktop=1\b/.test(window.location.search);
  }

  function trial() {
    if (typeof STB.getTrialStatus === "function") return STB.getTrialStatus();
    return { known: false, isPaid: false };
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function removeCard(clearParam) {
    if (cardEl && cardEl.parentNode) cardEl.parentNode.removeChild(cardEl);
    cardEl = null;
    if (clearParam !== false && wantsDesktop() && window.history && history.replaceState) {
      var url = window.location.pathname + window.location.hash;
      try { history.replaceState({}, "", url); } catch (e) {}
    }
  }

  function render() {
    var root = document.getElementById("stb-root");
    if (!root) return;
    // Re-render in place once the profile arrives, so the card switches from "sign in" to
    // "download" without needing a reload.
    if (cardEl && cardEl.parentNode) cardEl.parentNode.removeChild(cardEl);
    cardEl = null;

    var signedIn = !!(STB.getCurrentUser && STB.getCurrentUser());
    var st = trial();
    var paid = !!(st && st.isPaid);

    // Nothing here offers a download while the build is unreleased: the button used to lead
    // to "the installer hasn't been uploaded yet", which reads as a broken product. The card
    // now explains what the app will be, what it will cost, and when it will arrive.
    var body;
    if (!signedIn) {
      body =
        '<p class="stb-desktop-text">The Windows app gives every popped-out note its own ' +
        "floating window: no browser tabs, no address bar, always on top. It isn't released " +
        "yet — when it is, it comes with a paid subscription at no extra cost.</p>" +
        '<div class="stb-desktop-actions">' +
        '<button class="stb-desktop-btn stb-desktop-btn--ghost" type="button" data-desktop="dismiss">Got it</button>' +
        "</div>" +
        '<p class="stb-desktop-fine">Subscribe and we will email you the day it is ready. ' +
        "Windows 10/11, 64-bit.</p>";
    } else if (!paid) {
      body =
        '<p class="stb-desktop-text">The Windows app is part of the paid plan and is still ' +
        "being built. Your trial covers the browser version — upgrade whenever you want it, " +
        "and the desktop app arrives with your subscription when it ships.</p>" +
        '<div class="stb-desktop-actions">' +
        '<button class="stb-desktop-btn stb-desktop-btn--ghost" type="button" data-desktop="dismiss">Got it</button>' +
        "</div>" +
        '<p class="stb-desktop-fine">Nothing extra to pay for it later. We will email you ' +
        "when it is ready.</p>";
    } else {
      body =
        '<p class="stb-desktop-text">Your subscription covers the Windows app — every ' +
        "popped-out note in its own floating window, always on top, no browser chrome. " +
        "It is still in development.</p>" +
        '<div class="stb-desktop-actions">' +
        '<button class="stb-desktop-btn stb-desktop-btn--ghost" type="button" data-desktop="dismiss">Got it</button>' +
        "</div>" +
        '<p class="stb-desktop-fine">No download yet — we will email you the day it ships, ' +
        "and it costs you nothing extra. Windows 10/11, 64-bit.</p>";
    }

    cardEl = document.createElement("div");
    cardEl.className = "stb-desktop-card";
    cardEl.setAttribute("role", "region");
    cardEl.setAttribute("aria-label", "Nudgeboard for Windows");
    cardEl.innerHTML =
      '<div class="stb-desktop-head">' +
      '<span class="stb-desktop-eyebrow">Desktop app</span>' +
      '<button class="stb-desktop-close" type="button" aria-label="Dismiss" data-desktop="dismiss">&#215;</button>' +
      "</div>" +
      "<h2 class=\"stb-desktop-title\">Nudgeboard for Windows</h2>" +
      body;

    var main = root.querySelector(".stb-main");
    if (main && main.parentNode) main.parentNode.insertBefore(cardEl, main);
    else root.appendChild(cardEl);

    cardEl.addEventListener("click", onClick);
  }

  function onClick(e) {
    var el = e.target.closest("[data-desktop]");
    if (!el) return;
    var action = el.getAttribute("data-desktop");

    if (action === "dismiss") {
      removeCard();
      return;
    }
    if (action === "upgrade") {
      if (typeof STB.startCheckout === "function") {
        STB.startCheckout().catch(function () {});
      }
      return;
    }
    if (action === "download") {
      startDownload(el);
    }
  }

  function startDownload(btn) {
    var original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Preparing…";

    var restore = function (msg) {
      btn.disabled = false;
      btn.textContent = original;
      if (msg && typeof STB.toast === "function") STB.toast(msg, { tone: "error" });
    };

    if (typeof STB.getAccessToken !== "function") {
      restore("Downloads aren't available on this deployment.");
      return;
    }

    STB.getAccessToken()
      .then(function (token) {
        if (!token) {
          restore("Please sign in again.");
          return;
        }
        return fetch("/api/desktop-download", {
          method: "GET",
          headers: { Authorization: "Bearer " + token },
        }).then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (data) {
            if (res.ok && data.url) {
              handOff(data.url);
              btn.disabled = false;
              btn.textContent = "Download started";
              setTimeout(function () {
                if (btn) btn.textContent = original;
              }, 4000);
              return;
            }
            if (res.status === 402) {
              removeCard(false);
              render(); // re-render: it will now offer the upgrade
              return;
            }
            restore(data.error || "Couldn't start the download. Try again.");
          });
        });
      })
      .catch(function () {
        restore("Couldn't reach the server. Check your connection and try again.");
      });
  }

  // A signed URL is cross-origin and short-lived; clicking an anchor hands it to the browser's
  // download manager without navigating the app away from the board.
  function handOff(url) {
    var a = document.createElement("a");
    a.id = "stb-desktop-download";
    a.href = url;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      if (a.parentNode) a.parentNode.removeChild(a);
    }, 2000);
  }

  STB.renderDesktopCard = function () {
    if (!wantsDesktop()) {
      if (cardEl) removeCard(false);
      return;
    }
    render();
  };

  STB.handOffDownload = handOff; // exposed for the test harness

  if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", function () {
      if (wantsDesktop()) render();
    });
  }
})(window.STB = window.STB || {});
