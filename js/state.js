(function (STB) {
  "use strict";

  // ---- state ----
  STB.state = null; // { date, notes, documents, streak, history }
  STB.openDayPickerId = null;
  STB.openReminderPickerId = null;
  STB.openItemReminderId = null;
  STB.activeDragId = null;
  STB.copiedId = null;
  STB.copiedTimeout = null;
  STB.poppedOutWindows = {}; // cardId -> { win, container }
  STB.showSummary = false;
  STB.draftItems = {}; // noteId -> in-progress "add task" text, kept in memory only

  STB.loadOrInitState = function () {
    var raw = null;
    try { raw = localStorage.getItem(STB.STORAGE_KEY); } catch (e) {}
    var data = raw ? JSON.parse(raw) : null;
    if (!data) {
      data = { date: STB.todayKey(), notes: STB.starterNotes(), documents: [], streak: 0, history: [], nextZIndex: 2 };
    } else {
      data = STB.normalizeAndRollover(data);
      if (!data.nextZIndex) data.nextZIndex = 2;
    }
    return data;
  };

  STB.saveState = function () {
    try { localStorage.setItem(STB.STORAGE_KEY, JSON.stringify(STB.state)); } catch (e) { console.error("Could not save board", e); }
    if (STB.syncPush) STB.syncPush();
  };

  STB.getTodayWeekday = function () {
    return new Date().getDay();
  };

  STB.getVisibleNotes = function () {
    var tw = STB.getTodayWeekday();
    return STB.state.notes.filter(function (n) {
      return n.days.length === 0 || n.days.indexOf(tw) !== -1 || n.id === STB.openDayPickerId;
    });
  };

  STB.findCard = function (id) {
    var note = STB.state.notes.filter(function (n) { return n.id === id; })[0];
    if (note) return { kind: "note", item: note };
    var doc = STB.state.documents.filter(function (d) { return d.id === id; })[0];
    if (doc) return { kind: "doc", item: doc };
    return null;
  };

  // Whichever card was most recently touched should stay visually on top --
  // not just while actively dragging it, but afterward too. Without this,
  // two overlapping cards fall back to DOM/array order once a drag ends,
  // which can make a card you just moved to the front suddenly slip behind
  // another one the moment you let go.
  STB.bringToFront = function (id) {
    var found = STB.findCard(id);
    if (!found) return;
    STB.state.nextZIndex = (STB.state.nextZIndex || 2) + 1;
    found.item.zIndex = STB.state.nextZIndex;
  };

  // ---- note actions ----
  STB.commitNotes = function (newNotes) {
    STB.state.notes = newNotes;
    STB.saveState();
    STB.render();
  };

  STB.addNote = function () {
    var board = document.getElementById("stb-board");
    var rect = board.getBoundingClientRect();
    var canvasW = Math.max(rect.width, STB.MIN_CANVAS_W);
    var pos = STB.nextGridPosition(STB.state.notes.length, STB.NOTE_W, STB.NOTE_H_ESTIMATE, canvasW);
    var color = (STB.state.notes.length + STB.state.documents.length) % STB.PALETTE.length;
    var newNote = {
      id: STB.uid(), title: "", color: color,
      rotation: (Math.random() * 6 - 3).toFixed(1),
      x: pos.x,
      y: pos.y,
      days: [],
      items: [{ id: STB.uid(), text: "", done: false, carried: false }],
    };
    STB.commitNotes(STB.state.notes.concat([newNote]));
  };

  STB.deleteNote = function (id) {
    if (STB.openDayPickerId === id) STB.openDayPickerId = null;
    if (STB.copiedId === id) STB.copiedId = null;
    if (STB.poppedOutWindows[id]) { try { STB.poppedOutWindows[id].win.close(); } catch (e) {} delete STB.poppedOutWindows[id]; }
    delete STB.draftItems[id];
    STB.commitNotes(STB.state.notes.filter(function (n) { return n.id !== id; }));
  };

  STB.updateTitle = function (id, title, skipRender) {
    STB.state.notes = STB.state.notes.map(function (n) { return n.id === id ? Object.assign({}, n, { title: title }) : n; });
    STB.saveState();
    if (!skipRender) STB.render();
  };

  STB.setColor = function (id, color) {
    STB.commitNotes(STB.state.notes.map(function (n) { return n.id === id ? Object.assign({}, n, { color: color }) : n; }));
  };

  STB.toggleDay = function (id, dayIndex) {
    STB.commitNotes(STB.state.notes.map(function (n) {
      if (n.id !== id) return n;
      var has = n.days.indexOf(dayIndex) !== -1;
      var days = has ? n.days.filter(function (d) { return d !== dayIndex; }) : n.days.concat([dayIndex]).sort(function (a, b) { return a - b; });
      return Object.assign({}, n, { days: days });
    }));
  };

  STB.toggleItem = function (noteId, itemId) {
    STB.commitNotes(STB.state.notes.map(function (n) {
      if (n.id !== noteId) return n;
      return Object.assign({}, n, {
        items: n.items.map(function (it) { return it.id === itemId ? Object.assign({}, it, { done: !it.done }) : it; }),
      });
    }));
  };

  STB.updateItemText = function (noteId, itemId, text, skipRender) {
    STB.state.notes = STB.state.notes.map(function (n) {
      if (n.id !== noteId) return n;
      return Object.assign({}, n, {
        items: n.items.map(function (it) { return it.id === itemId ? Object.assign({}, it, { text: text }) : it; }),
      });
    });
    STB.saveState();
    if (!skipRender) STB.render();
  };

  STB.deleteItem = function (noteId, itemId) {
    if (STB.openItemReminderId === itemId) STB.openItemReminderId = null;
    STB.commitNotes(STB.state.notes.map(function (n) {
      if (n.id !== noteId) return n;
      return Object.assign({}, n, { items: n.items.filter(function (it) { return it.id !== itemId; }) });
    }));
  };

  STB.addItem = function (noteId, text) {
    STB.commitNotes(STB.state.notes.map(function (n) {
      if (n.id !== noteId) return n;
      return Object.assign({}, n, { items: n.items.concat([{ id: STB.uid(), text: text.trim(), done: false, carried: false }]) });
    }));
  };

  STB.togglePicker = function (id) {
    STB.openDayPickerId = STB.openDayPickerId === id ? null : id;
    STB.render();
  };

  STB.toggleReminderPicker = function (id) {
    STB.openReminderPickerId = STB.openReminderPickerId === id ? null : id;
    STB.render();
  };

  STB.setReminderTime = function (id, time) {
    STB.commitNotes(STB.state.notes.map(function (n) { return n.id === id ? Object.assign({}, n, { reminderTime: time || null }) : n; }));
  };

  STB.clearReminderTime = function (id) {
    STB.setReminderTime(id, null);
  };

  STB.toggleItemReminderPicker = function (itemId) {
    STB.openItemReminderId = STB.openItemReminderId === itemId ? null : itemId;
    STB.render();
  };

  STB.setItemReminderTime = function (noteId, itemId, time) {
    STB.commitNotes(STB.state.notes.map(function (n) {
      if (n.id !== noteId) return n;
      return Object.assign({}, n, {
        items: n.items.map(function (it) { return it.id === itemId ? Object.assign({}, it, { reminderTime: time || null }) : it; }),
      });
    }));
  };

  STB.clearItemReminderTime = function (noteId, itemId) {
    STB.setItemReminderTime(noteId, itemId, null);
  };

  // ---- document (running notes) actions ----
  STB.commitDocs = function (newDocs) {
    STB.state.documents = newDocs;
    STB.saveState();
    STB.render();
  };

  // Used by the custom touch/mouse resize handle: the element's size is updated
  // directly via style during the drag (no re-render needed, same pattern as
  // repositioning), this just persists the final size once the drag ends.
  STB.setDocSize = function (id, width, height) {
    var doc = STB.state.documents.filter(function (d) { return d.id === id; })[0];
    if (!doc) return;
    doc.width = width;
    doc.height = height;
    STB.saveState();
  };

  STB.addDocument = function () {
    var board = document.getElementById("stb-board");
    var rect = board.getBoundingClientRect();
    var canvasW = Math.max(rect.width, STB.MIN_CANVAS_W);
    var activeDocCount = STB.state.documents.filter(function (d) { return !d.archived; }).length;
    var pos = STB.nextGridPosition(activeDocCount, STB.DOC_W, STB.DOC_H_ESTIMATE, canvasW);
    var color = (STB.state.notes.length + STB.state.documents.length) % STB.PALETTE.length;
    var newDoc = {
      id: STB.uid(), title: "", text: "", color: color,
      rotation: (Math.random() * 4 - 2).toFixed(1),
      x: pos.x,
      y: pos.y,
      archived: false,
    };
    STB.commitDocs(STB.state.documents.concat([newDoc]));
  };

  STB.deleteDocument = function (id) {
    if (STB.copiedId === id) STB.copiedId = null;
    if (STB.poppedOutWindows[id]) { try { STB.poppedOutWindows[id].win.close(); } catch (e) {} delete STB.poppedOutWindows[id]; }
    STB.commitDocs(STB.state.documents.filter(function (d) { return d.id !== id; }));
  };

  STB.updateDocTitle = function (id, title, skipRender) {
    STB.state.documents = STB.state.documents.map(function (d) { return d.id === id ? Object.assign({}, d, { title: title }) : d; });
    STB.saveState();
    if (!skipRender) STB.render();
  };

  STB.updateDocText = function (id, text, skipRender) {
    STB.state.documents = STB.state.documents.map(function (d) { return d.id === id ? Object.assign({}, d, { text: text }) : d; });
    STB.saveState();
    if (!skipRender) STB.render();
  };

  STB.setDocColor = function (id, color) {
    STB.commitDocs(STB.state.documents.map(function (d) { return d.id === id ? Object.assign({}, d, { color: color }) : d; }));
  };

  // Saving a document keeps everything inside the app: no file leaves the browser.
  // It just archives the card off the board and into the sidebar's "Saved notes" list.
  STB.archiveDocument = function (id) {
    if (STB.poppedOutWindows[id]) { try { STB.poppedOutWindows[id].win.close(); } catch (e) {} delete STB.poppedOutWindows[id]; }
    STB.commitDocs(STB.state.documents.map(function (d) { return d.id === id ? Object.assign({}, d, { archived: true }) : d; }));
  };

  STB.restoreDocument = function (id) {
    var target = STB.state.documents.filter(function (d) { return d.id === id; })[0];
    if (!target) return;
    var board = document.getElementById("stb-board");
    var rect = board.getBoundingClientRect();
    var canvasW = Math.max(rect.width, STB.MIN_CANVAS_W);
    var activeDocCount = STB.state.documents.filter(function (d) { return !d.archived; }).length;
    var pos = STB.nextGridPosition(activeDocCount, STB.DOC_W, STB.DOC_H_ESTIMATE, canvasW);
    STB.commitDocs(STB.state.documents.map(function (d) {
      return d.id === id ? Object.assign({}, d, { archived: false, x: pos.x, y: pos.y }) : d;
    }));
  };

  // ---- copy to clipboard (works for either card kind) ----
  STB.noteToText = function (note) {
    var lines = [STB.autoTitleFor("note", note)];
    note.items.forEach(function (it) {
      if (it.text.trim() !== "") lines.push((it.done ? "[x] " : "[ ] ") + it.text);
    });
    return lines.join("\n");
  };

  STB.docToText = function (doc) {
    var title = STB.autoTitleFor("doc", doc);
    return title + "\n\n" + (doc.text || "");
  };

  STB.copyCardText = function (id) {
    var found = STB.findCard(id);
    if (!found) return;
    var text = found.kind === "doc" ? STB.docToText(found.item) : STB.noteToText(found.item);
    function done(ok) {
      if (ok) {
        STB.copiedId = id;
        STB.render();
        clearTimeout(STB.copiedTimeout);
        STB.copiedTimeout = setTimeout(function () {
          if (STB.copiedId === id) { STB.copiedId = null; STB.render(); }
        }, 1500);
      }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { STB.fallbackCopy(text, done); });
    } else {
      STB.fallbackCopy(text, done);
    }
  };

  STB.fallbackCopy = function (text, cb) {
    var ok = false;
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ok = document.execCommand("copy");
      document.body.removeChild(ta);
    } catch (e) { ok = false; }
    cb(ok);
  };
})(window.STB = window.STB || {});
