(function (STB) {
  "use strict";

  // Keyboard support. The old build was mouse/touch only, which meant adding five tasks
  // was five round trips between the keyboard and the "New note" button.
  //
  // Deliberately single-letter and unmodified, so they never fire while someone is typing
  // into a note (that's the main thing that has to be protected here).

  var helpEl = null;

  var SHORTCUTS = [
    { keys: ["N"], label: "New note" },
    { keys: ["D"], label: "New document" },
    { keys: ["/"], label: "Jump to the first 'add a task' field" },
    { keys: ["Esc"], label: "Close a picker, dialog, or the shortcuts list" },
    { keys: ["Ctrl", "Z"], label: "Undo the last delete" },
    { keys: ["?"], label: "Show this list" },
  ];

  function isTypingTarget(el) {
    if (!el) return false;
    var tag = (el.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    return !!el.isContentEditable;
  }

  function closeAnyOpenPicker() {
    var had = STB.openDayPickerId || STB.openReminderPickerId || STB.openItemReminderId;
    if (!had) return false;
    STB.openDayPickerId = null;
    STB.openReminderPickerId = null;
    STB.openItemReminderId = null;
    STB.render();
    return true;
  }

  function focusFirstTaskField() {
    var addItem = document.querySelector("#stb-board .stb-additem-input");
    if (addItem) { addItem.focus(); return true; }
    var title = document.querySelector("#stb-board .stb-note-title");
    if (title) { title.focus(); return true; }
    return false;
  }

  function openHelp() {
    if (helpEl) return;
    helpEl = document.createElement("div");
    helpEl.className = "stb-modal-overlay";
    helpEl.id = "stb-shortcuts-overlay";
    helpEl.innerHTML =
      '<div class="stb-modal" role="dialog" aria-modal="true" aria-labelledby="stb-shortcuts-title">' +
      '<h2 class="stb-modal-title" id="stb-shortcuts-title">Keyboard shortcuts</h2>' +
      '<ul class="stb-shortcut-list">' +
      SHORTCUTS.map(function (s) {
        return (
          '<li><span class="stb-shortcut-keys">' +
          s.keys.map(function (k) { return "<kbd>" + k + "</kbd>"; }).join("") +
          "</span><span>" + s.label + "</span></li>"
        );
      }).join("") +
      "</ul>" +
      '<button type="button" class="stb-modal-close" id="stb-shortcuts-close">Close</button>' +
      "</div>";
    document.body.appendChild(helpEl);
    document.getElementById("stb-shortcuts-close").addEventListener("click", closeHelp);
    helpEl.addEventListener("click", function (e) { if (e.target === helpEl) closeHelp(); });
    var closeBtn = document.getElementById("stb-shortcuts-close");
    if (closeBtn) closeBtn.focus();
  }

  function closeHelp() {
    if (!helpEl) return;
    if (helpEl.parentNode) helpEl.parentNode.removeChild(helpEl);
    helpEl = null;
  }

  function isLocked() {
    var board = document.getElementById("stb-board");
    return !!(board && board.classList.contains("stb-locked"));
  }

  document.addEventListener("keydown", function (e) {
    if (e.defaultPrevented) return;
    var mod = e.ctrlKey || e.metaKey;

    if (mod && (e.key === "z" || e.key === "Z")) {
      if (isTypingTarget(e.target)) return; // let the field's own undo win while typing
      e.preventDefault();
      if (STB.undo) STB.undo();
      return;
    }

    if (isTypingTarget(e.target) || mod || e.altKey) {
      // Escape should still get someone out of a field they're stuck in.
      if (e.key === "Escape" && isTypingTarget(e.target)) e.target.blur();
      return;
    }

    if (e.key === "Escape") {
      if (helpEl) { closeHelp(); return; }
      if (closeAnyOpenPicker()) return;
      return;
    }

    if (e.key === "?" || (e.shiftKey && e.key === "/")) { e.preventDefault(); openHelp(); return; }

    if (e.key === "/") {
      if (focusFirstTaskField()) e.preventDefault();
      return;
    }

    if (e.key === "n" || e.key === "N") {
      if (isLocked()) return;
      e.preventDefault();
      STB.addNote();
      return;
    }

    if (e.key === "d" || e.key === "D") {
      if (isLocked()) return;
      e.preventDefault();
      STB.addDocument();
    }
  });

  STB.openShortcutsHelp = openHelp;
  STB.closeShortcutsHelp = closeHelp;
})(window.STB = window.STB || {});
