(function (STB) {
  "use strict";

  // Solo mode: app.html?solo=<cardId> renders exactly one card, filling the window.
  //
  // Why this exists. A browser can turn window.open() into a real popup window; Electron can
  // turn that popup into a frameless OS window. Tauri cannot -- its webview creates no native
  // windows from window.open at all. So the desktop build opens a SECOND WINDOW OF THE APP,
  // scoped to a single card, and this file is what makes that window show one card instead of
  // the whole board. Same board, same realtime sync, one card on screen.
  //
  // It is also the reason the note windows stay in sync: they are not a copy of the data, they
  // are another client of the same board.

  var match = /[?&]solo=([^&]+)/.exec(window.location.search);
  if (!match) return;

  var cardId = decodeURIComponent(match[1]);
  var closed = false;

  function cssEscape(value) {
    return String(value).replace(/["\\]/g, "\\$&");
  }

  function closeWindow() {
    if (closed) return;
    closed = true;
    try {
      if (window.__TAURI__ && window.__TAURI__.window) {
        window.__TAURI__.window.getCurrentWindow().close();
        return;
      }
    } catch (e) {}
    try { window.close(); } catch (e) {}
  }

  function ensureStyles() {
    var style = document.getElementById("stb-solo-style");
    if (!style) {
      style = document.createElement("style");
      style.id = "stb-solo-style";
      document.head.appendChild(style);
    }
    // The card id goes into the selector rather than onto the element, so it survives every
    // re-render (renderBoard() replaces the whole board's innerHTML each time).
    var sel = '.stb-board > [data-card-id="' + cssEscape(cardId) + '"]';
    style.textContent =
      ".stb-solo-mode .stb-board > .stb-note," +
      ".stb-solo-mode .stb-board > .stb-doc," +
      ".stb-solo-mode .stb-board > .stb-empty{display:none !important;}" +
      ".stb-solo-mode " + sel + "{" +
      "display:flex !important;flex-direction:column !important;" +
      "position:fixed !important;left:0 !important;top:0 !important;" +
      "width:100% !important;height:100% !important;max-width:none !important;" +
      "margin:0 !important;border-radius:0 !important;box-shadow:none !important;" +
      "transform:none !important;z-index:5;}" +
      ".stb-solo-mode " + sel + " .stb-items{flex:1 1 auto;overflow:auto;}" +
      ".stb-solo-mode " + sel + ' [data-action="pop-out"]{display:none !important;}';
  }

  function afterRender() {
    document.documentElement.classList.add("stb-solo-mode");
    ensureStyles();

    var found = typeof STB.findCard === "function" ? STB.findCard(cardId) : null;
    var gone = !found || (found.kind === "doc" && found.item && found.item.archived);
    if (gone) {
      // Deleted or archived in another window: do not leave an empty shell on the desktop.
      closeWindow();
      return;
    }
    var title = String((found.item && found.item.title) || "").trim();
    if (!title) title = found.kind === "doc" ? "Running notes" : "Note";
    if (document.title !== title) document.title = title;
  }

  // Wrap STB.render rather than patching render.js: every mutation on the board funnels
  // through it, so this keeps the window correct without changing how the board draws.
  function hook() {
    if (typeof STB.render !== "function" || STB.render.__soloWrapped) return false;
    var original = STB.render;
    var wrapped = function () {
      var out = original.apply(this, arguments);
      try { afterRender(); } catch (e) {}
      return out;
    };
    wrapped.__soloWrapped = true;
    STB.render = wrapped;
    return true;
  }

  if (hook()) {
    try { afterRender(); } catch (e) {}
  } else {
    document.addEventListener("DOMContentLoaded", function () {
      hook();
      try { afterRender(); } catch (e) {}
    });
  }

  STB.isSoloMode = true;
  STB.soloCardId = cardId;
  STB.closeSoloWindow = closeWindow;
})(window.STB = window.STB || {});
