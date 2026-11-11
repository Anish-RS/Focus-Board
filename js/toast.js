(function (STB) {
  "use strict";

  // A tiny toast system. Why it exists:
  //   * The app used window.alert() for checkout/cancel/errors, which is modal, unstyled,
  //     blocks the event loop, and looks nothing like the rest of the product.
  //   * Destructive actions (deleting a note, deleting a task) happened instantly with no
  //     confirmation and no way back -- one mis-tap on a phone and the note was gone.
  // Everything here is additive: if it fails to load, the board still works.
  //
  // API:
  //   STB.toast("Note deleted", { actionLabel: "Undo", onAction: fn, tone: "info" })
  //   STB.toast("Saved", { tone: "success", duration: 2000 })

  var DEFAULT_DURATION = 5000;
  var MAX_VISIBLE = 3;
  var container = null;

  function getContainer() {
    if (container && document.body.contains(container)) return container;
    container = document.getElementById("stb-toasts");
    if (!container) {
      container = document.createElement("div");
      container.id = "stb-toasts";
      container.className = "stb-toasts";
      document.body.appendChild(container);
    }
    container.setAttribute("role", "status");
    container.setAttribute("aria-live", "polite");
    container.setAttribute("aria-atomic", "false");
    return container;
  }

  function dismiss(el) {
    if (!el || el.classList.contains("is-leaving")) return;
    el.classList.add("is-leaving");
    var removed = false;
    function remove() {
      if (removed) return;
      removed = true;
      if (el.parentNode) el.parentNode.removeChild(el);
    }
    el.addEventListener("transitionend", remove, { once: true });
    // Belt and braces: if the transition never fires (reduced motion, background tab),
    // make sure the node still goes away.
    setTimeout(remove, 500);
  }

  STB.toast = function (message, opts) {
    opts = opts || {};
    var el = document.createElement("div");
    el.className = "stb-toast" + (opts.tone ? " stb-toast--" + opts.tone : "");

    var text = document.createElement("span");
    text.className = "stb-toast-text";
    text.textContent = String(message == null ? "" : message);
    el.appendChild(text);

    var actionEl = null;
    if (opts.actionLabel && typeof opts.onAction === "function") {
      actionEl = document.createElement("button");
      actionEl.type = "button";
      actionEl.className = "stb-toast-action";
      actionEl.textContent = opts.actionLabel;
      actionEl.addEventListener("click", function () {
        dismiss(el);
        try { opts.onAction(); } catch (e) { console.error("Toast action failed", e); }
      });
      el.appendChild(actionEl);
    }

    var closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "stb-toast-close";
    closeBtn.setAttribute("aria-label", "Dismiss notification");
    closeBtn.innerHTML = STB.ICON && STB.ICON.x ? STB.ICON.x(12) : "&times;";
    closeBtn.addEventListener("click", function () { dismiss(el); });
    el.appendChild(closeBtn);

    var host = getContainer();
    host.appendChild(el);

    // Keep the stack short -- older toasts slide out rather than piling up.
    var live = host.querySelectorAll(".stb-toast:not(.is-leaving)");
    for (var i = 0; i < live.length - MAX_VISIBLE; i++) dismiss(live[i]);

    // Ask the browser to run the enter transition (needs a frame after insertion).
    requestAnimationFrame(function () { el.classList.add("is-visible"); });

    var duration = typeof opts.duration === "number" ? opts.duration : DEFAULT_DURATION;
    var timer = null;
    function startTimer() {
      if (duration <= 0) return;
      timer = setTimeout(function () { dismiss(el); }, duration);
    }
    function stopTimer() {
      if (timer) { clearTimeout(timer); timer = null; }
    }
    // Don't yank an "Undo" out from under someone who is reaching for it.
    el.addEventListener("pointerenter", stopTimer);
    el.addEventListener("pointerleave", function () { stopTimer(); startTimer(); });
    el.addEventListener("focusin", stopTimer);
    startTimer();

    return { dismiss: function () { dismiss(el); } };
  };

  // Replaces window.alert for the handful of "something went wrong, here's the message"
  // moments. Keeps the message, loses the browser chrome.
  STB.alertToast = function (message) {
    STB.toast(message, { tone: "warn", duration: 7000 });
  };
})(window.STB = window.STB || {});
