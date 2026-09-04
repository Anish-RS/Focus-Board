(function (STB) {
  "use strict";

  var deferredInstallPrompt = null;
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferredInstallPrompt = e;
    var btn = document.getElementById("stb-install-btn");
    btn.style.display = "flex";
  });
  window.addEventListener("appinstalled", function () {
    document.getElementById("stb-install-btn").style.display = "none";
  });

  function isIos() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }
  function isInStandaloneMode() {
    return ("standalone" in navigator && navigator.standalone) || window.matchMedia("(display-mode: standalone)").matches;
  }
  function maybeShowIosTip() {
    if (!isIos() || isInStandaloneMode()) return;
    if (localStorage.getItem(STB.IOS_TIP_KEY) === "1") return;
    var el = document.getElementById("stb-ios-tip");
    el.innerHTML =
      '<span>On iPhone/iPad: tap the Share icon, then "Add to Home Screen" to install this board.</span>' +
      '<button id="stb-ios-tip-dismiss">Got it</button>';
    el.className = "stb-ios-tip";
    document.getElementById("stb-ios-tip-dismiss").addEventListener("click", function () {
      try { localStorage.setItem(STB.IOS_TIP_KEY, "1"); } catch (e) {}
      el.innerHTML = "";
      el.className = "";
    });
  }

  function init() {
    try {
      STB.state = STB.loadOrInitState();
      STB.saveState();

      var addBtn = document.getElementById("stb-add-btn");
      addBtn.innerHTML = STB.ICON.plus(16) + " New note";
      addBtn.addEventListener("click", STB.addNote);

      var addDocBtn = document.getElementById("stb-add-doc-btn");
      if (addDocBtn) {
        addDocBtn.innerHTML = STB.ICON.plus(16) + " New document";
        addDocBtn.addEventListener("click", STB.addDocument);
      }

      var installBtn = document.getElementById("stb-install-btn");
      installBtn.textContent = "Install app";
      installBtn.addEventListener("click", function () {
        if (!deferredInstallPrompt) return;
        deferredInstallPrompt.prompt();
        deferredInstallPrompt.userChoice.then(function () {
          deferredInstallPrompt = null;
          installBtn.style.display = "none";
        });
      });

      STB.attachCardEvents(document.getElementById("stb-board"));
      STB.attachCardEvents(document.getElementById("stb-clipboard"), { enableReposition: false });
      maybeShowIosTip();
      STB.render();

      window.addEventListener("resize", STB.clampCardsToBoard);

      // Catch the day changing while the app stays open (e.g. left in a browser tab overnight).
      setInterval(function () {
        var rolled = STB.rollover(STB.state);
        if (rolled !== STB.state) {
          STB.state = rolled;
          STB.saveState();
          STB.render();
        }
      }, 60000);
    } catch (coreErr) {
      console.error("Sticky board failed to start", coreErr);
      var board = document.getElementById("stb-board");
      if (board) {
        board.innerHTML =
          '<div class="stb-empty"><p>Something went wrong loading the board. Try refreshing the page. ' +
          "If it keeps happening, open the browser console (F12) and check what error is shown there.</p></div>";
      }
      return; // Core failed -- don't attempt optional features on top of a broken board.
    }

    // Optional enhancements below: any failure here must never be able to affect the
    // core board above, which has already rendered successfully by this point.
    try { if (STB.renderReminderButton) STB.renderReminderButton(); } catch (e) { console.error("Reminders UI failed to init", e); }
    try { if (STB.startReminderChecks) STB.startReminderChecks(); } catch (e) { console.error("Reminder checks failed to start", e); }

    try {
      var startSync = function () {
        try { if (STB.initSync) STB.initSync(); } catch (e) { console.error("Sync failed to init", e); }
      };
      if (STB.configReady && typeof STB.configReady.then === "function") {
        STB.configReady.then(startSync, startSync);
      } else {
        startSync();
      }
    } catch (e) {
      console.error("Sync bootstrap failed", e);
    }
  }

  document.addEventListener("DOMContentLoaded", init);

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    });
  }
})(window.STB = window.STB || {});
