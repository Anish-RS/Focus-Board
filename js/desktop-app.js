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

    var body;
    if (!signedIn) {
      body =
        '<p class="stb-desktop-text">The Windows app gives every popped-out note its own ' +
        "floating window: no browser tabs, no address bar, always on top. It's included with " +
        "the paid plan.</p>" +
        '<div class="stb-desktop-actions">' +
        '<a class="stb-desktop-btn" href="./login.html?next=app.html%3Fdesktop%3D1">Sign in to download</a>' +
        '<button class="stb-desktop-btn stb-desktop-btn--ghost" type="button" data-desktop="dismiss">Not now</button>' +
        "</div>";
    } else if (!paid) {
      body =
        '<p class="stb-desktop-text">The Windows app is included with the paid plan. Your ' +
        "trial still covers the browser version — upgrade whenever you want the desktop one.</p>" +
        '<div class="stb-desktop-actions">' +
        '<button class="stb-desktop-btn" type="button" data-desktop="upgrade">Upgrade to unlock it</button>' +
        '<button class="stb-desktop-btn stb-desktop-btn--ghost" type="button" data-desktop="dismiss">Not now</button>' +
        "</div>";
    } else {
      body =
        '<p class="stb-desktop-text">Every popped-out note becomes its own floating window — ' +
        "no browser chrome, always on top while you work or watch something.</p>" +
        '<div class="stb-desktop-actions">' +
        '<button class="stb-desktop-btn" type="button" data-desktop="download">Download for Windows</button>' +
        '<button class="stb-desktop-btn stb-desktop-btn--ghost" type="button" data-desktop="dismiss">Not now</button>' +
        "</div>" +
        '<p class="stb-desktop-fine">In development — you will get it here first. Windows 10/11 · ' +
        '64-bit · a few MB · the file is unsigned, so ' +
        "Windows will ask you to confirm the first time (More info → Run anyway).</p>";
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
