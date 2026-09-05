(function (STB) {
  "use strict";

  function isPipSupported() {
    return "documentPictureInPicture" in window;
  }

  function copyStylesInto(doc) {
    Array.prototype.forEach.call(document.querySelectorAll('style, link[rel="stylesheet"]'), function (node) {
      doc.head.appendChild(node.cloneNode(true));
    });
    var override = doc.createElement("style");
    override.textContent =
      "html,body{margin:0;padding:0;background:#B98A54;box-sizing:border-box;min-height:100%;height:100%;overflow:hidden;}" +
      ".stb-pip-root{min-height:100%;height:100%;display:flex;align-items:flex-start;justify-content:center;}" +
      ".stb-pip-root .stb-note,.stb-pip-root .stb-doc{position:static !important;left:auto !important;top:auto !important;transform:none !important;width:100% !important;box-sizing:border-box;margin:0 !important;}" +
      ".stb-pip-root .stb-doc{height:100% !important;}" +
      "*{scrollbar-width:thin;scrollbar-color:rgba(0,0,0,0.3) transparent;}" +
      "*::-webkit-scrollbar{width:4px;height:4px;}" +
      "*::-webkit-scrollbar-button{display:none;height:0;width:0;}" +
      "*::-webkit-scrollbar-track{background:transparent;}" +
      "*::-webkit-scrollbar-thumb{background:rgba(0,0,0,0.3);border-radius:2px;}";
    doc.head.appendChild(override);
  }

  function unregisterPopout(id) {
    if (STB.poppedOutWindows[id]) {
      delete STB.poppedOutWindows[id];
      STB.render();
    }
  }

  function closePopout(id) {
    var entry = STB.poppedOutWindows[id];
    if (!entry) return;
    try { entry.win.close(); } catch (e) {}
    unregisterPopout(id);
  }

  function focusPopout(id) {
    var entry = STB.poppedOutWindows[id];
    if (!entry) return;
    try { entry.win.focus(); } catch (e) {}
  }

  function estimatePopupSize(found) {
    if (found.kind === "doc") {
      return { w: found.item.width || 320, h: found.item.height || 420 };
    }
    var itemCount = found.item.items.length;
    var h = 150 + itemCount * 34 + 70;
    h = Math.max(220, Math.min(480, h));
    return { w: found.item.width || 300, h: h };
  }

  // window.open's width/height describe the OUTER window, chrome included --
  // the title bar you see at the top of the pop-out eats into that, leaving
  // less actual content space than requested. This buffer compensates so the
  // content area itself ends up matching the note's real size.
  var POPUP_CHROME_HEIGHT = 56;

  function openPopupWindow(id, found) {
    var size = estimatePopupSize(found);
    var openCount = Object.keys(STB.poppedOutWindows).length;
    var left = Math.max(0, (window.screen.availWidth || 1200) - size.w - 24 - openCount * 28);
    var top = 70 + openCount * 28;
    var popup = window.open(
      "",
      "stb-popout-" + id,
      "width=" + size.w + ",height=" + (size.h + POPUP_CHROME_HEIGHT) + ",left=" + left + ",top=" + top + ",popup=1"
    );
    if (!popup) {
      alert("Your browser blocked the pop-out window. Please allow pop-ups for this site and try again.");
      return;
    }
    popup.document.title = STB.autoTitleFor(found.kind, found.item);
    copyStylesInto(popup.document);
    var container = popup.document.createElement("div");
    container.className = "stb-root stb-pip-root";
    popup.document.body.appendChild(container);
    STB.poppedOutWindows[id] = { win: popup, container: container };
    STB.attachCardEvents(container, { enableReposition: false });
    popup.addEventListener("pagehide", function () { unregisterPopout(id); });
    STB.renderPopout(id);
    STB.render();
  }

  async function popOutCard(id) {
    if (STB.poppedOutWindows[id]) { focusPopout(id); return; }
    var found = STB.findCard(id);
    if (!found) return;

    // Only running-notes documents get true always-on-top Picture-in-Picture, since that's
    // the case that actually needs to float above other apps while you watch/read something.
    // Browsers only permit one such always-on-top window system-wide at a time.
    // Regular checklist notes always use plain popup windows instead, which have no such
    // limit -- you can pop out as many sticky notes at once as you like.
    if (found.kind === "doc" && isPipSupported()) {
      try {
        var pipSize = estimatePopupSize(found);
        var pipWin = await window.documentPictureInPicture.requestWindow({ width: pipSize.w, height: pipSize.h });
        copyStylesInto(pipWin.document);
        var container = pipWin.document.createElement("div");
        container.className = "stb-root stb-pip-root";
        pipWin.document.body.appendChild(container);
        STB.poppedOutWindows[id] = { win: pipWin, container: container };
        STB.attachCardEvents(container, { enableReposition: false });
        pipWin.addEventListener("pagehide", function () { unregisterPopout(id); });
        STB.renderPopout(id);
        STB.render();
        return;
      } catch (e) {
        console.error("Picture-in-Picture pop-out failed, falling back to a popup window", e);
      }
    }

    openPopupWindow(id, found);
  }

  // Safety net: catch windows closed in ways that don't reliably fire pagehide.
  setInterval(function () {
    Object.keys(STB.poppedOutWindows).forEach(function (id) {
      var entry = STB.poppedOutWindows[id];
      if (entry && entry.win && entry.win.closed) unregisterPopout(id);
    });
  }, 1000);

  STB.isPipSupported = isPipSupported;
  STB.popOutCard = popOutCard;
  STB.unregisterPopout = unregisterPopout;
  STB.closePopout = closePopout;
  STB.focusPopout = focusPopout;
})(window.STB = window.STB || {});
