(function (STB) {
  "use strict";

  function startDrag(e, cardEl) {
    var board = document.getElementById("stb-board");
    var cardId = cardEl.getAttribute("data-card-id");
    var found = STB.findCard(cardId);
    if (!found) return;
    var item = found.item;
    e.preventDefault();

    STB.bringToFront(cardId);

    var cardRect = cardEl.getBoundingClientRect();
    var offsetX = e.clientX - cardRect.left;
    var offsetY = e.clientY - cardRect.top;

    STB.activeDragId = cardId;
    cardEl.classList.add("is-dragging");
    cardEl.style.zIndex = STB.MAX_Z_INDEX;

    function handleMove(ev) {
      var rect = board.getBoundingClientRect();
      var x = ev.clientX - rect.left + board.scrollLeft - offsetX;
      var y = ev.clientY - rect.top + board.scrollTop - offsetY;
      x = Math.max(0, x);
      y = Math.max(0, y);
      item.x = x;
      item.y = y;
      cardEl.style.left = x + "px";
      cardEl.style.top = y + "px";
    }
    function handleUp() {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      STB.activeDragId = null;
      cardEl.classList.remove("is-dragging");
      cardEl.style.zIndex = item.zIndex || 1;
      STB.saveState();
    }
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  var DOC_MIN_WIDTH = 200;
  var DOC_MIN_HEIGHT = 180;

  // Works on both mouse and touch, unlike the browser's native CSS `resize`
  // handle, which most mobile browsers simply don't support dragging at all.
  function startResize(e, handleEl) {
    var docId = handleEl.getAttribute("data-resize-id");
    var docEl = handleEl.closest(".stb-doc");
    if (!docEl) return;
    var found = STB.findCard(docId);
    if (!found || found.kind !== "doc") return;
    var doc = found.item;
    e.preventDefault();
    e.stopPropagation();

    var startRect = docEl.getBoundingClientRect();
    var startX = e.clientX;
    var startY = e.clientY;
    var startWidth = startRect.width;
    var startHeight = startRect.height;

    docEl.classList.add("is-resizing");

    function handleMove(ev) {
      var newWidth = Math.max(DOC_MIN_WIDTH, startWidth + (ev.clientX - startX));
      var newHeight = Math.max(DOC_MIN_HEIGHT, startHeight + (ev.clientY - startY));
      docEl.style.width = newWidth + "px";
      docEl.style.height = newHeight + "px";
      doc.width = newWidth;
      doc.height = newHeight;
    }
    function handleUp() {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      docEl.classList.remove("is-resizing");
      STB.setDocSize(docId, doc.width, doc.height);
    }
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  function clampCardsToBoard() {
    var changed = false;
    STB.state.notes.forEach(function (n) {
      if (n.x < 0) { n.x = 0; changed = true; }
      if (n.y < 0) { n.y = 0; changed = true; }
    });
    STB.state.documents.forEach(function (d) {
      if (d.x < 0) { d.x = 0; changed = true; }
      if (d.y < 0) { d.y = 0; changed = true; }
    });
    if (changed) { STB.saveState(); STB.renderBoard(); }
  }

  function attachCardEvents(container, opts) {
    opts = opts || {};
    var enableReposition = opts.enableReposition !== false;

    container.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-action]");
      if (!btn) return;
      var action = btn.getAttribute("data-action");
      var cardId = btn.getAttribute("data-card-id");
      if (action === "add-note") { STB.addNote(); return; }
      if (action === "add-doc") { STB.addDocument(); return; }
      if (action === "pop-out") { STB.popOutCard(cardId); return; }
      if (action === "focus-popout") { STB.focusPopout(cardId); return; }
      if (action === "close-popout") { STB.closePopout(cardId); return; }
      if (action === "restore-doc") { STB.restoreDocument(cardId); return; }
      if (action === "archive-doc") { STB.archiveDocument(cardId); return; }
      if (action === "clear-reminder") { STB.clearReminderTime(cardId); return; }
      if (action === "delete-card") {
        var foundDel = STB.findCard(cardId);
        if (foundDel && foundDel.kind === "doc") STB.deleteDocument(cardId); else STB.deleteNote(cardId);
        return;
      }
      if (action === "copy-card") { STB.copyCardText(cardId); return; }
      if (action === "toggle-item") { STB.toggleItem(cardId, btn.getAttribute("data-item-id")); return; }
      if (action === "delete-item") { STB.deleteItem(cardId, btn.getAttribute("data-item-id")); return; }
      if (action === "toggle-item-reminder") { STB.toggleItemReminderPicker(btn.getAttribute("data-item-id")); return; }
      if (action === "clear-item-reminder") { STB.clearItemReminderTime(cardId, btn.getAttribute("data-item-id")); return; }
      if (action === "toggle-picker") { STB.togglePicker(cardId); return; }
      if (action === "toggle-reminder-picker") { STB.toggleReminderPicker(cardId); return; }
      if (action === "set-color") {
        var idx = parseInt(btn.getAttribute("data-color-index"), 10);
        var foundColor = STB.findCard(cardId);
        if (foundColor && foundColor.kind === "doc") STB.setDocColor(cardId, idx); else STB.setColor(cardId, idx);
        return;
      }
      if (action === "toggle-day") { STB.toggleDay(cardId, parseInt(btn.getAttribute("data-day-index"), 10)); return; }
    });

    container.addEventListener("input", function (e) {
      var el = e.target;
      var role = el.getAttribute("data-role");
      var cardId = el.getAttribute("data-card-id");
      if (role === "title") {
        var found = STB.findCard(cardId);
        if (found && found.kind === "doc") STB.updateDocTitle(cardId, el.value, true);
        else STB.updateTitle(cardId, el.value, true);
      } else if (role === "item-text") {
        STB.updateItemText(cardId, el.getAttribute("data-item-id"), el.value, true);
        var noteEl = el.closest(".stb-note");
        var found2 = STB.findCard(cardId);
        if (noteEl && found2 && found2.kind === "note") STB.fitNoteToContent(noteEl, found2.item);
      } else if (role === "add-item") {
        STB.draftItems[cardId] = el.value;
      } else if (role === "doc-text") {
        STB.updateDocText(cardId, el.value, true);
      }
    });

    container.addEventListener("change", function (e) {
      var el = e.target;
      var role = el.getAttribute("data-role");
      if (role === "reminder-time") {
        STB.setReminderTime(el.getAttribute("data-card-id"), el.value);
      } else if (role === "item-reminder-time") {
        STB.setItemReminderTime(el.getAttribute("data-card-id"), el.getAttribute("data-item-id"), el.value);
      }
    });

    container.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && e.target.getAttribute("data-role") === "item-text") {
        e.preventDefault();
        e.target.blur();
        return;
      }
      if (e.key === "Enter" && e.target.getAttribute("data-role") === "add-item") {
        var noteId = e.target.getAttribute("data-card-id");
        var val = e.target.value.trim();
        if (val) {
          delete STB.draftItems[noteId];
          STB.addItem(noteId, val);
        }
      }
    });

    container.addEventListener("pointerdown", function (e) {
      var resizeHandle = e.target.closest("[data-resize-id]");
      if (resizeHandle) { startResize(e, resizeHandle); return; }
      if (!enableReposition) return;
      if (e.target.closest("input, button, textarea, select")) return;
      var cardEl = e.target.closest(".stb-note, .stb-doc");
      if (!cardEl) return;
      startDrag(e, cardEl);
    });
  }

  STB.startDrag = startDrag;
  STB.clampCardsToBoard = clampCardsToBoard;
  STB.attachCardEvents = attachCardEvents;
})(window.STB = window.STB || {});
