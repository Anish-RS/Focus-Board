(function () {
  "use strict";

  var PALETTE = [
    { name: "butter", bg: "#F5E6A8", ink: "#6B4E12" },
    { name: "sage", bg: "#C9D6B8", ink: "#3A4B24" },
    { name: "sky", bg: "#B9D3DD", ink: "#20424C" },
    { name: "blush", bg: "#E8C5C0", ink: "#6B322A" },
    { name: "lavender", bg: "#D3C5DE", ink: "#4A2F59" },
  ];
  var DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
  var DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var STORAGE_KEY = "sticky-board";
  var IOS_TIP_KEY = "sticky-board-ios-tip-dismissed";
  var RING_R = 50;
  var RING_C = 2 * Math.PI * RING_R;
  var NOTE_W = 210;
  var NOTE_H_ESTIMATE = 190;
  var DOC_W = 260;
  var DOC_H_ESTIMATE = 260;

  var ICON = {
    x: function (size, color) {
      return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="' + (color || "currentColor") + '" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    },
    check: function (size, color) {
      return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="' + (color || "currentColor") + '" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    },
    plus: function (size) {
      return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
    },
    flame: function (size) {
      return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c1 4-4 5-4 9a4 4 0 0 0 8 0c0-1-1-2-1-3 1 1 3 3 3 6a6 6 0 0 1-12 0c0-5 3-6 6-12z"/></svg>';
    },
    chevronDown: function (size) {
      return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
    },
    repeat: function (size) {
      return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>';
    },
    copy: function (size) {
      return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    },
    download: function (size) {
      return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
    },
    popout: function (size) {
      return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
    },
  };

  function uid() {
    return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  function todayKey() {
    return new Date().toDateString();
  }
  function escapeAttr(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
  function formattedDate() {
    return new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  }
  function sanitizeFilename(name) {
    var cleaned = String(name || "").trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
    return cleaned || "sticky-note";
  }

  function computeStats(notes) {
    var total = 0,
      completed = 0;
    notes.forEach(function (n) {
      n.items.forEach(function (it) {
        if (it.text.trim() !== "") {
          total++;
          if (it.done) completed++;
        }
      });
    });
    var percent = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { total: total, completed: completed, percent: percent };
  }

  function normalizeNotes(notes) {
    return (notes || []).map(function (n) {
      return Object.assign({}, n, {
        days: Array.isArray(n.days) ? n.days : [],
        items: (n.items || []).map(function (it) {
          return Object.assign({}, it, { carried: !!it.carried });
        }),
      });
    });
  }

  function normalizeDocuments(docs) {
    return (docs || []).map(function (d) {
      return Object.assign({}, d, {
        title: d.title || "",
        text: d.text || "",
        color: typeof d.color === "number" ? d.color : 0,
      });
    });
  }

  function starterNotes() {
    return [
      {
        id: uid(), title: "Morning", color: 0, rotation: -2.5, x: 30, y: 30, days: [],
        items: [
          { id: uid(), text: "Check emails", done: false, carried: false },
          { id: uid(), text: "Team standup", done: false, carried: false },
        ],
      },
      {
        id: uid(), title: "Focus work", color: 2, rotation: 1.5, x: 300, y: 60, days: [],
        items: [
          { id: uid(), text: "Draft the proposal", done: false, carried: false },
          { id: uid(), text: "Review two PRs", done: false, carried: false },
        ],
      },
      {
        id: uid(), title: "Gym", color: 1, rotation: -1, x: 150, y: 280, days: [1, 3, 5],
        items: [
          { id: uid(), text: "Leg day", done: false, carried: false },
          { id: uid(), text: "20 min cardio", done: false, carried: false },
        ],
      },
      {
        id: uid(), title: "Weekly reset", color: 4, rotation: 2, x: 470, y: 40, days: [5],
        items: [
          { id: uid(), text: "Clear inbox to zero", done: false, carried: false },
          { id: uid(), text: "Plan next week", done: false, carried: false },
        ],
      },
    ];
  }

  function buildNarrative(stats, streak) {
    var total = stats.total, completed = stats.completed, percent = stats.percent;
    if (total === 0) return "The board's empty today. Pin a task above and it'll show up here.";
    if (completed === 0) return "Nothing's crossed off yet, and " + total + " task" + (total === 1 ? " is" : "s are") + " waiting. The day's still wide open.";
    if (percent === 100) {
      return streak > 1
        ? "Every task cleared today \u2014 that's " + streak + " days running. A real rhythm is forming."
        : "Every task cleared today. That's full follow-through.";
    }
    if (percent >= 70) return completed + " of " + total + " done. Strong pace \u2014 just " + (total - completed) + " left standing between you and a clean board.";
    if (percent >= 40) return completed + " of " + total + " handled so far. A steady middle stretch, and the rest is still well within reach today.";
    return completed + " of " + total + " done. Early days yet, but " + (total - completed) + " task" + (total - completed === 1 ? "" : "s") + " are still open if you want to make a push.";
  }

  // ---- state ----
  var state = null; // { date, notes, documents, streak, history }
  var openDayPickerId = null;
  var activeDragId = null;
  var copiedId = null;
  var copiedTimeout = null;
  var exportedId = null;
  var exportedTimeout = null;
  var poppedOutWindows = {}; // cardId -> { win, container }
  var showSummary = false;
  var draftItems = {}; // noteId -> in-progress "add task" text, kept in memory only

  function rollover(data) {
    var today = todayKey();
    if (data.date === today) return data;
    var yesterdayWeekday = new Date(data.date).getDay();
    var yesterdayVisible = data.notes.filter(function (n) {
      return n.days.length === 0 || n.days.indexOf(yesterdayWeekday) !== -1;
    });
    var stats = computeStats(yesterdayVisible);
    var newHistory = (data.history || []).concat([{ date: data.date, percent: stats.percent }]).slice(-7);
    var newStreak = stats.total > 0 && stats.percent === 100 ? (data.streak || 0) + 1 : 0;

    var rolledNotes = [];
    data.notes.forEach(function (n) {
      if (n.days.length > 0) {
        rolledNotes.push(Object.assign({}, n, {
          items: n.items.map(function (it) { return Object.assign({}, it, { done: false, carried: false }); }),
        }));
      } else {
        var meaningful = n.items.filter(function (it) { return it.text.trim() !== ""; });
        var incomplete = meaningful.filter(function (it) { return !it.done; });
        if (meaningful.length > 0 && incomplete.length > 0) {
          rolledNotes.push(Object.assign({}, n, {
            items: incomplete.map(function (it) { return Object.assign({}, it, { carried: true }); }),
          }));
        }
      }
    });
    // Documents are permanent reference pages, not daily tasks: they never roll over or disappear.
    return { date: today, notes: rolledNotes, documents: data.documents || [], streak: newStreak, history: newHistory };
  }

  function loadOrInitState() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    var data = raw ? JSON.parse(raw) : null;
    if (!data) {
      data = { date: todayKey(), notes: starterNotes(), documents: [], streak: 0, history: [] };
    } else {
      data.notes = normalizeNotes(data.notes);
      data.documents = normalizeDocuments(data.documents);
      data = rollover(data);
    }
    return data;
  }

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { console.error("Could not save board", e); }
  }

  function getTodayWeekday() {
    return new Date().getDay();
  }
  function getVisibleNotes() {
    var tw = getTodayWeekday();
    return state.notes.filter(function (n) {
      return n.days.length === 0 || n.days.indexOf(tw) !== -1 || n.id === openDayPickerId;
    });
  }

  function findCard(id) {
    var note = state.notes.filter(function (n) { return n.id === id; })[0];
    if (note) return { kind: "note", item: note };
    var doc = state.documents.filter(function (d) { return d.id === id; })[0];
    if (doc) return { kind: "doc", item: doc };
    return null;
  }

  // ---- note actions ----
  function commitNotes(newNotes) {
    state.notes = newNotes;
    saveState();
    render();
  }

  function addNote() {
    var board = document.getElementById("stb-board");
    var rect = board.getBoundingClientRect();
    var totalVisible = getVisibleNotes().length + state.documents.length;
    var maxX = Math.max(20, rect.width - NOTE_W - 20);
    var maxY = Math.max(20, rect.height - NOTE_H_ESTIMATE - 20);
    var cascade = totalVisible % 6;
    var color = (state.notes.length + state.documents.length) % PALETTE.length;
    var newNote = {
      id: uid(), title: "", color: color,
      rotation: (Math.random() * 6 - 3).toFixed(1),
      x: Math.min(maxX, 30 + cascade * 26),
      y: Math.min(maxY, 30 + cascade * 22),
      days: [],
      items: [{ id: uid(), text: "", done: false, carried: false }],
    };
    commitNotes(state.notes.concat([newNote]));
  }

  function deleteNote(id) {
    if (openDayPickerId === id) openDayPickerId = null;
    if (copiedId === id) copiedId = null;
    if (exportedId === id) exportedId = null;
    if (poppedOutWindows[id]) { try { poppedOutWindows[id].win.close(); } catch (e) {} delete poppedOutWindows[id]; }
    delete draftItems[id];
    commitNotes(state.notes.filter(function (n) { return n.id !== id; }));
  }

  function updateTitle(id, title, skipRender) {
    state.notes = state.notes.map(function (n) { return n.id === id ? Object.assign({}, n, { title: title }) : n; });
    saveState();
    if (!skipRender) render();
  }

  function setColor(id, color) {
    commitNotes(state.notes.map(function (n) { return n.id === id ? Object.assign({}, n, { color: color }) : n; }));
  }

  function toggleDay(id, dayIndex) {
    commitNotes(state.notes.map(function (n) {
      if (n.id !== id) return n;
      var has = n.days.indexOf(dayIndex) !== -1;
      var days = has ? n.days.filter(function (d) { return d !== dayIndex; }) : n.days.concat([dayIndex]).sort(function (a, b) { return a - b; });
      return Object.assign({}, n, { days: days });
    }));
  }

  function toggleItem(noteId, itemId) {
    commitNotes(state.notes.map(function (n) {
      if (n.id !== noteId) return n;
      return Object.assign({}, n, {
        items: n.items.map(function (it) { return it.id === itemId ? Object.assign({}, it, { done: !it.done }) : it; }),
      });
    }));
  }

  function updateItemText(noteId, itemId, text, skipRender) {
    state.notes = state.notes.map(function (n) {
      if (n.id !== noteId) return n;
      return Object.assign({}, n, {
        items: n.items.map(function (it) { return it.id === itemId ? Object.assign({}, it, { text: text }) : it; }),
      });
    });
    saveState();
    if (!skipRender) render();
  }

  function deleteItem(noteId, itemId) {
    commitNotes(state.notes.map(function (n) {
      if (n.id !== noteId) return n;
      return Object.assign({}, n, { items: n.items.filter(function (it) { return it.id !== itemId; }) });
    }));
  }

  function addItem(noteId, text) {
    commitNotes(state.notes.map(function (n) {
      if (n.id !== noteId) return n;
      return Object.assign({}, n, { items: n.items.concat([{ id: uid(), text: text.trim(), done: false, carried: false }]) });
    }));
  }

  function togglePicker(id) {
    openDayPickerId = openDayPickerId === id ? null : id;
    render();
  }

  // ---- document (running notes) actions ----
  function commitDocs(newDocs) {
    state.documents = newDocs;
    saveState();
    render();
  }

  function addDocument() {
    var board = document.getElementById("stb-board");
    var rect = board.getBoundingClientRect();
    var totalVisible = getVisibleNotes().length + state.documents.length;
    var maxX = Math.max(20, rect.width - DOC_W - 20);
    var maxY = Math.max(20, rect.height - DOC_H_ESTIMATE - 20);
    var cascade = totalVisible % 6;
    var color = (state.notes.length + state.documents.length) % PALETTE.length;
    var newDoc = {
      id: uid(), title: "", text: "", color: color,
      rotation: (Math.random() * 4 - 2).toFixed(1),
      x: Math.min(maxX, 60 + cascade * 26),
      y: Math.min(maxY, 60 + cascade * 22),
    };
    commitDocs(state.documents.concat([newDoc]));
  }

  function deleteDocument(id) {
    if (copiedId === id) copiedId = null;
    if (exportedId === id) exportedId = null;
    if (poppedOutWindows[id]) { try { poppedOutWindows[id].win.close(); } catch (e) {} delete poppedOutWindows[id]; }
    commitDocs(state.documents.filter(function (d) { return d.id !== id; }));
  }

  function updateDocTitle(id, title, skipRender) {
    state.documents = state.documents.map(function (d) { return d.id === id ? Object.assign({}, d, { title: title }) : d; });
    saveState();
    if (!skipRender) render();
  }

  function updateDocText(id, text, skipRender) {
    state.documents = state.documents.map(function (d) { return d.id === id ? Object.assign({}, d, { text: text }) : d; });
    saveState();
    if (!skipRender) render();
  }

  function setDocColor(id, color) {
    commitDocs(state.documents.map(function (d) { return d.id === id ? Object.assign({}, d, { color: color }) : d; }));
  }

  // ---- copy to clipboard (works for either card kind) ----
  function noteToText(note) {
    var lines = [note.title.trim() || "Untitled note"];
    note.items.forEach(function (it) {
      if (it.text.trim() !== "") lines.push((it.done ? "[x] " : "[ ] ") + it.text);
    });
    return lines.join("\n");
  }
  function docToText(doc) {
    var title = doc.title.trim() || "Untitled document";
    return title + "\n\n" + (doc.text || "");
  }

  function copyCardText(id) {
    var found = findCard(id);
    if (!found) return;
    var text = found.kind === "doc" ? docToText(found.item) : noteToText(found.item);
    function done(ok) {
      if (ok) {
        copiedId = id;
        render();
        clearTimeout(copiedTimeout);
        copiedTimeout = setTimeout(function () {
          if (copiedId === id) { copiedId = null; render(); }
        }, 1500);
      }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { fallbackCopy(text, done); });
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, cb) {
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
  }

  // ---- export a single note/document as a standalone file (drag to desktop, or click to download) ----
  function buildExportHTML(kind, item) {
    var pal = PALETTE[item.color];
    var exportId = item.id;
    var exportedOn = formattedDate();
    var title = item.title || "";

    if (kind === "doc") {
      return [
        "<!doctype html><html><head><meta charset=\"utf-8\">",
        "<title>" + escapeAttr(title || "Running notes") + "</title>",
        "<style>",
        "html,body{margin:0;padding:16px;background:#00000010;box-sizing:border-box;font-family:-apple-system,Segoe UI,Roboto,sans-serif;}",
        ".card{background:" + pal.bg + ";color:" + pal.ink + ";width:100%;max-width:420px;min-height:320px;margin:0 auto;padding:20px 20px 14px;border-radius:6px;box-shadow:0 10px 24px rgba(0,0,0,0.25);box-sizing:border-box;",
        "background-image:repeating-linear-gradient(to bottom, transparent 0px, transparent 25px, rgba(0,0,0,0.07) 26px);}",
        ".title{font-size:21px;font-weight:700;border:none;background:transparent;color:inherit;width:100%;margin-bottom:10px;font-family:Georgia,'Times New Roman',serif;}",
        ".title:focus{outline:none;}",
        "textarea{width:100%;min-height:260px;border:none;background:transparent;color:inherit;font-size:14.5px;line-height:1.6;font-family:inherit;resize:vertical;box-sizing:border-box;}",
        "textarea:focus{outline:none;}",
        ".foot{font-size:10.5px;opacity:0.55;margin-top:10px;}",
        "</style></head><body>",
        "<div class=\"card\">",
        "<input class=\"title\" id=\"t\" placeholder=\"Untitled document\" />",
        "<textarea id=\"body\" placeholder=\"Running notes\u2026\"></textarea>",
        "<div class=\"foot\">Saved from Sticky To-Do Board on " + exportedOn + ". Independent copy \u2014 edits here don\u2019t sync back to the board.</div>",
        "</div>",
        "<script>",
        "var KEY='sticky-export-" + exportId + "';",
        "function load(){try{return JSON.parse(localStorage.getItem(KEY));}catch(e){return null;}}",
        "function save(s){try{localStorage.setItem(KEY, JSON.stringify(s));}catch(e){}}",
        "var seed = " + JSON.stringify({ title: title, text: item.text || "" }) + ";",
        "var state = load() || seed;",
        "var t=document.getElementById('t'), b=document.getElementById('body');",
        "t.value = state.title || ''; b.value = state.text || '';",
        "t.addEventListener('input', function(){ state.title=t.value; save(state); });",
        "b.addEventListener('input', function(){ state.text=b.value; save(state); });",
        "<\/script>",
        "</body></html>",
      ].join("\n");
    }

    var seedItems = item.items.filter(function (it) { return it.text.trim() !== ""; }).map(function (it) {
      return { text: it.text, done: !!it.done };
    });

    return [
      "<!doctype html><html><head><meta charset=\"utf-8\">",
      "<title>" + escapeAttr(title || "Sticky note") + "</title>",
      "<style>",
      "html,body{margin:0;padding:16px;background:#00000010;box-sizing:border-box;font-family:-apple-system,Segoe UI,Roboto,sans-serif;}",
      ".card{background:" + pal.bg + ";color:" + pal.ink + ";width:260px;min-height:170px;margin:0 auto;padding:18px 16px 14px;border-radius:4px;box-shadow:0 10px 24px rgba(0,0,0,0.25);box-sizing:border-box;}",
      ".title{font-size:20px;font-weight:700;border:none;background:transparent;color:inherit;width:100%;margin-bottom:10px;font-family:Georgia,'Times New Roman',serif;}",
      ".title:focus{outline:none;}",
      ".item{display:flex;align-items:flex-start;gap:8px;margin-bottom:7px;font-size:14px;}",
      ".item.done span{text-decoration:line-through;opacity:0.55;}",
      ".item input[type=checkbox]{width:16px;height:16px;margin-top:1px;flex:none;}",
      ".add-row input{width:100%;border:none;border-top:1px dashed rgba(0,0,0,0.3);background:transparent;color:inherit;font-size:13px;font-style:italic;padding-top:7px;margin-top:2px;box-sizing:border-box;}",
      ".add-row input:focus{outline:none;}",
      ".foot{font-size:10.5px;opacity:0.55;margin-top:12px;}",
      "</style></head><body>",
      "<div class=\"card\">",
      "<input class=\"title\" id=\"t\" placeholder=\"Untitled note\" />",
      "<div id=\"items\"></div>",
      "<div class=\"add-row\"><input id=\"add\" placeholder=\"Add a task, press Enter\" /></div>",
      "<div class=\"foot\">Saved from Sticky To-Do Board on " + exportedOn + ". Independent copy \u2014 edits here don\u2019t sync back to the board.</div>",
      "</div>",
      "<script>",
      "var KEY='sticky-export-" + exportId + "';",
      "function load(){try{return JSON.parse(localStorage.getItem(KEY));}catch(e){return null;}}",
      "function save(s){try{localStorage.setItem(KEY, JSON.stringify(s));}catch(e){}}",
      "function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}",
      "var seed = " + JSON.stringify({ title: title, items: seedItems }) + ";",
      "var state = load() || seed;",
      "var t=document.getElementById('t');",
      "t.value = state.title || '';",
      "t.addEventListener('input', function(){ state.title=t.value; save(state); });",
      "function render(){",
      "  var html = state.items.map(function(it,i){",
      "    return '<label class=\"item'+(it.done?' done':'')+'\"><input type=\"checkbox\" data-i=\"'+i+'\" '+(it.done?'checked':'')+'/><span>'+esc(it.text)+'</span></label>';",
      "  }).join('');",
      "  document.getElementById('items').innerHTML = html;",
      "  Array.prototype.forEach.call(document.querySelectorAll('#items input[type=checkbox]'), function(cb){",
      "    cb.addEventListener('change', function(){ state.items[+this.getAttribute('data-i')].done = this.checked; save(state); render(); });",
      "  });",
      "}",
      "document.getElementById('add').addEventListener('keydown', function(e){",
      "  if (e.key==='Enter' && this.value.trim()) { state.items.push({text:this.value.trim(), done:false}); this.value=''; save(state); render(); }",
      "});",
      "render();",
      "<\/script>",
      "</body></html>",
    ].join("\n");
  }

  function isPipSupported() {
    return "documentPictureInPicture" in window;
  }

  function copyStylesInto(doc) {
    Array.prototype.forEach.call(document.querySelectorAll('style, link[rel="stylesheet"]'), function (node) {
      doc.head.appendChild(node.cloneNode(true));
    });
    var override = doc.createElement("style");
    override.textContent =
      "html,body{margin:0;padding:0;background:#B98A54;box-sizing:border-box;min-height:100%;}" +
      ".stb-pip-root{min-height:100%;display:flex;align-items:flex-start;justify-content:center;}" +
      ".stb-pip-root .stb-note,.stb-pip-root .stb-doc{position:static !important;left:auto !important;top:auto !important;transform:none !important;width:100% !important;max-width:270px;box-sizing:border-box;margin:0 !important;}";
    doc.head.appendChild(override);
  }

  function renderPopout(id) {
    var entry = poppedOutWindows[id];
    if (!entry) return;
    var found = findCard(id);
    if (!found) { closePopout(id); return; }
    entry.container.innerHTML = found.kind === "doc" ? docHTML(found.item, { hideActions: true }) : noteHTML(found.item, { hideActions: true });
  }

  function renderAllPopouts() {
    Object.keys(poppedOutWindows).forEach(renderPopout);
  }

  function unregisterPopout(id) {
    if (poppedOutWindows[id]) {
      delete poppedOutWindows[id];
      render();
    }
  }

  function closePopout(id) {
    var entry = poppedOutWindows[id];
    if (!entry) return;
    try { entry.win.close(); } catch (e) {}
    unregisterPopout(id);
  }

  function focusPopout(id) {
    var entry = poppedOutWindows[id];
    if (!entry) return;
    try { entry.win.focus(); } catch (e) {}
  }

  function estimatePopupSize(found) {
    if (found.kind === "doc") return { w: 320, h: 420 };
    var itemCount = found.item.items.length;
    var h = 150 + itemCount * 34 + 70;
    h = Math.max(220, Math.min(480, h));
    return { w: 300, h: h };
  }

  function openPopupWindow(id, found) {
    var size = estimatePopupSize(found);
    var openCount = Object.keys(poppedOutWindows).length;
    var left = Math.max(0, (window.screen.availWidth || 1200) - size.w - 24 - openCount * 28);
    var top = 70 + openCount * 28;
    var popup = window.open(
      "",
      "stb-popout-" + id,
      "width=" + size.w + ",height=" + size.h + ",left=" + left + ",top=" + top + ",popup=1"
    );
    if (!popup) {
      alert("Your browser blocked the pop-out window. Please allow pop-ups for this site and try again.");
      return;
    }
    popup.document.title = found.item.title || (found.kind === "doc" ? "Running notes" : "Sticky note");
    copyStylesInto(popup.document);
    var container = popup.document.createElement("div");
    container.className = "stb-root stb-pip-root";
    popup.document.body.appendChild(container);
    poppedOutWindows[id] = { win: popup, container: container };
    attachCardEvents(container, { enableReposition: false });
    popup.addEventListener("pagehide", function () { unregisterPopout(id); });
    renderPopout(id);
    render();
  }

  async function popOutCard(id) {
    if (poppedOutWindows[id]) { focusPopout(id); return; }
    var found = findCard(id);
    if (!found) return;

    // Only running-notes documents get true always-on-top Picture-in-Picture, since that's
    // the case that actually needs to float above other apps while you watch/read something.
    // Browsers only permit one such always-on-top window system-wide at a time.
    // Regular checklist notes always use plain popup windows instead, which have no such
    // limit -- you can pop out as many sticky notes at once as you like.
    if (found.kind === "doc" && isPipSupported()) {
      try {
        var pipWin = await window.documentPictureInPicture.requestWindow({ width: 320, height: 420 });
        copyStylesInto(pipWin.document);
        var container = pipWin.document.createElement("div");
        container.className = "stb-root stb-pip-root";
        pipWin.document.body.appendChild(container);
        poppedOutWindows[id] = { win: pipWin, container: container };
        attachCardEvents(container, { enableReposition: false });
        pipWin.addEventListener("pagehide", function () { unregisterPopout(id); });
        renderPopout(id);
        render();
        return;
      } catch (e) {
        console.error("Picture-in-Picture pop-out failed, falling back to a popup window", e);
      }
    }

    openPopupWindow(id, found);
  }

  // Safety net: catch windows closed in ways that don't reliably fire pagehide.
  setInterval(function () {
    Object.keys(poppedOutWindows).forEach(function (id) {
      var entry = poppedOutWindows[id];
      if (entry && entry.win && entry.win.closed) unregisterPopout(id);
    });
  }, 1000);

  function placeholderHTML(item, kind) {
    var pal = PALETTE[item.color];
    var w = kind === "doc" ? DOC_W : NOTE_W;
    var style = "background:" + pal.bg + "; left:" + item.x + "px; top:" + item.y + "px; width:" + w + "px; border:2px dashed " + pal.ink + "; opacity:0.7;";
    return (
      '<div class="stb-placeholder" data-action="focus-popout" data-card-id="' + item.id + '" style="' + style + '">' +
      '<div class="stb-placeholder-title" style="color:' + pal.ink + ';">' + escapeAttr(item.title || (kind === "doc" ? "Untitled document" : "Untitled note")) + "</div>" +
      '<div class="stb-placeholder-sub" style="color:' + pal.ink + ';">Popped out \u2014 click to bring to front</div>' +
      '<button class="stb-placeholder-close" style="color:' + pal.ink + ';" data-action="close-popout" data-card-id="' + item.id + '" aria-label="Bring back to board" title="Close the pop-out and bring it back to the board">' + ICON.x(12) + "</button>" +
      "</div>"
    );
  }

  function exportCardAsFile(id) {
    var found = findCard(id);
    if (!found) return;
    var html = buildExportHTML(found.kind, found.item);
    var base = sanitizeFilename(found.item.title || (found.kind === "doc" ? "running notes" : "sticky note"));
    var filename = base + ".html";
    try {
      var blob = new Blob([html], { type: "text/html" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      // Visible confirmation: clicking gives no browser feedback of its own, so without this
      // the file saves silently to Downloads and looks like nothing happened.
      exportedId = id;
      render();
      clearTimeout(exportedTimeout);
      exportedTimeout = setTimeout(function () {
        if (exportedId === id) { exportedId = null; render(); }
      }, 1800);
    } catch (e) {
      console.error("Could not export file", e);
    }
  }

  function handleExportDragStart(e, id) {
    var found = findCard(id);
    if (!found || !e.dataTransfer) return;
    var html = buildExportHTML(found.kind, found.item);
    var base = sanitizeFilename(found.item.title || (found.kind === "doc" ? "running notes" : "sticky note"));
    var filename = base + ".html";
    var dataUrl = "data:text/html;charset=utf-8," + encodeURIComponent(html);
    var entry = "text/html:" + filename + ":" + dataUrl;
    // Two ways to set the same non-standard Chrome entry, since engine support for each varies.
    try { e.dataTransfer.setData("DownloadURL", entry); } catch (err) {}
    try {
      if (e.dataTransfer.items && e.dataTransfer.items.add) e.dataTransfer.items.add("DownloadURL", entry);
    } catch (err) {}
    try {
      e.dataTransfer.effectAllowed = "copy";
      e.dataTransfer.dropEffect = "copy";
    } catch (err) {}
  }

  // ---- rendering ----
  function noteHTML(note, opts) {
    opts = opts || {};
    var pal = PALETTE[note.color];
    var recurring = note.days.length > 0;
    var isPickerOpen = openDayPickerId === note.id;
    var isCopied = copiedId === note.id;
    var isExported = exportedId === note.id;
    var isDragging = activeDragId === note.id;
    var style = "background:" + pal.bg + "; left:" + note.x + "px; top:" + note.y + "px; transform:rotate(" + note.rotation + "deg); z-index:" + (isDragging ? 50 : 1) + ";";

    var itemsHTML = note.items.map(function (it) {
      var cbStyle = it.done ? "background:" + pal.ink + ";border-color:" + pal.ink + ";" : "border-color:" + pal.ink + ";";
      var carriedDot = it.carried
        ? '<span class="stb-carried-dot" style="background:' + pal.ink + ';" title="Carried over from yesterday, still pending"></span>'
        : "";
      return (
        '<div class="stb-item">' +
        '<button class="stb-checkbox' + (it.done ? " is-done" : "") + '" style="' + cbStyle + '" data-action="toggle-item" data-card-id="' + note.id + '" data-item-id="' + it.id + '" aria-label="' + (it.done ? "Mark task not done" : "Mark task done") + '">' +
        (it.done ? ICON.check(11, "#FBF8F1") : "") +
        "</button>" +
        carriedDot +
        '<input class="stb-item-input" data-role="item-text" data-card-id="' + note.id + '" data-item-id="' + it.id + '" value="' + escapeAttr(it.text) + '" placeholder="Type a task" style="color:' + pal.ink + "; text-decoration:" + (it.done ? "line-through" : "none") + "; opacity:" + (it.done ? 0.55 : 1) + ';" />' +
        '<button class="stb-item-delete" style="color:' + pal.ink + ';" data-action="delete-item" data-card-id="' + note.id + '" data-item-id="' + it.id + '" aria-label="Delete task">' + ICON.x(11) + "</button>" +
        "</div>"
      );
    }).join("");

    var dayLabel = recurring
      ? note.days.slice().sort(function (a, b) { return a - b; }).map(function (d) { return DAY_LETTERS[d]; }).join(" ")
      : "Just today";

    var pickerHTML = "";
    if (isPickerOpen) {
      var chips = DAY_LETTERS.map(function (d, i) {
        var on = note.days.indexOf(i) !== -1;
        var chipStyle = on ? "background:" + pal.ink + ";border-color:" + pal.ink + ";color:" + pal.bg + ";" : "border-color:" + pal.ink + ";color:" + pal.ink + ";";
        return '<button class="stb-day-chip" title="' + DAY_NAMES[i] + '" style="' + chipStyle + '" data-action="toggle-day" data-card-id="' + note.id + '" data-day-index="' + i + '">' + d + "</button>";
      }).join("");
      pickerHTML =
        '<div class="stb-day-picker">' + chips +
        '<button class="stb-day-done" style="color:' + pal.ink + ";border-color:" + pal.ink + ';" data-action="toggle-picker" data-card-id="' + note.id + '">Done</button>' +
        "</div>";
    }

    var swatchesHTML = PALETTE.map(function (p, idx) {
      var shadow = idx === note.color ? "0 0 0 2px " + p.ink : "none";
      return '<button class="stb-swatch" style="background:' + p.bg + "; box-shadow:" + shadow + ';" data-action="set-color" data-card-id="' + note.id + '" data-color-index="' + idx + '" aria-label="Change note color to ' + p.name + '"></button>';
    }).join("");

    var draftVal = draftItems[note.id] || "";

    var actionsHTML = opts.hideActions
      ? ""
      : '<div class="stb-note-actions">' +
        '<button class="stb-note-popout" style="color:' + pal.ink + ';" data-action="pop-out" data-card-id="' + note.id + '" aria-label="Pop out" title="Pop this note out into its own window on your desktop (you can pop out several at once)">' + ICON.popout(12) + "</button>" +
        '<button class="stb-note-export" style="color:' + pal.ink + ';" draggable="true" data-export-id="' + note.id + '" aria-label="Save as a file" title="Save this note as an .html file (goes to your Downloads folder)">' + (isExported ? ICON.check(12) : ICON.download(12)) + "</button>" +
        '<button class="stb-note-copy" style="color:' + pal.ink + ';" data-action="copy-card" data-card-id="' + note.id + '" aria-label="Copy note text" title="Copy note text to paste into another app">' + (isCopied ? ICON.check(13) : ICON.copy(13)) + "</button>" +
        '<button class="stb-note-delete" data-action="delete-card" data-card-id="' + note.id + '" aria-label="Remove note">' + ICON.x(13) + "</button>" +
        "</div>";

    return (
      '<div class="stb-note' + (isDragging ? " is-dragging" : "") + '" data-card-id="' + note.id + '" style="' + style + '">' +
      '<span class="stb-pin" style="background:' + pal.ink + ';"></span>' +
      actionsHTML +
      '<input class="stb-note-title" data-role="title" data-card-id="' + note.id + '" value="' + escapeAttr(note.title) + '" placeholder="Untitled note" style="color:' + pal.ink + ';" />' +
      '<div class="stb-items">' + itemsHTML + "</div>" +
      '<input class="stb-additem-input" data-role="add-item" data-card-id="' + note.id + '" value="' + escapeAttr(draftVal) + '" placeholder="Add a task, press Enter" style="color:' + pal.ink + "; border-top-color:" + pal.ink + '33;" />' +
      '<div class="stb-note-footer">' +
      '<button class="stb-repeat-btn" style="color:' + pal.ink + ";border-color:" + pal.ink + ';" data-action="toggle-picker" data-card-id="' + note.id + '">' + ICON.repeat(11) + " " + dayLabel + "</button>" +
      '<div class="stb-swatches">' + swatchesHTML + "</div>" +
      "</div>" +
      pickerHTML +
      "</div>"
    );
  }

  function docHTML(doc, opts) {
    opts = opts || {};
    var pal = PALETTE[doc.color];
    var isCopied = copiedId === doc.id;
    var isExported = exportedId === doc.id;
    var isDragging = activeDragId === doc.id;
    var style = "background:" + pal.bg + "; left:" + doc.x + "px; top:" + doc.y + "px; transform:rotate(" + doc.rotation + "deg); z-index:" + (isDragging ? 50 : 1) + ";";

    var swatchesHTML = PALETTE.map(function (p, idx) {
      var shadow = idx === doc.color ? "0 0 0 2px " + p.ink : "none";
      return '<button class="stb-swatch" style="background:' + p.bg + "; box-shadow:" + shadow + ';" data-action="set-color" data-card-id="' + doc.id + '" data-color-index="' + idx + '" aria-label="Change color to ' + p.name + '"></button>';
    }).join("");

    var actionsHTML = opts.hideActions
      ? ""
      : '<div class="stb-note-actions">' +
        '<button class="stb-note-popout" style="color:' + pal.ink + ';" data-action="pop-out" data-card-id="' + doc.id + '" aria-label="Pop out" title="Pop this out into a window that floats on top of other apps while you study">' + ICON.popout(12) + "</button>" +
        '<button class="stb-note-export" style="color:' + pal.ink + ';" draggable="true" data-export-id="' + doc.id + '" aria-label="Save as a file" title="Save this as an .html file (goes to your Downloads folder)">' + (isExported ? ICON.check(12) : ICON.download(12)) + "</button>" +
        '<button class="stb-note-copy" style="color:' + pal.ink + ';" data-action="copy-card" data-card-id="' + doc.id + '" aria-label="Copy note text" title="Copy text to paste into another app">' + (isCopied ? ICON.check(13) : ICON.copy(13)) + "</button>" +
        '<button class="stb-note-delete" data-action="delete-card" data-card-id="' + doc.id + '" aria-label="Remove document">' + ICON.x(13) + "</button>" +
        "</div>";

    return (
      '<div class="stb-doc' + (isDragging ? " is-dragging" : "") + '" data-card-id="' + doc.id + '" style="' + style + '">' +
      '<span class="stb-pin" style="background:' + pal.ink + ';"></span>' +
      actionsHTML +
      '<input class="stb-note-title" data-role="title" data-card-id="' + doc.id + '" value="' + escapeAttr(doc.title) + '" placeholder="Untitled document" style="color:' + pal.ink + ';" />' +
      '<textarea class="stb-doc-text" data-role="doc-text" data-card-id="' + doc.id + '" placeholder="Jot running notes here while you watch or read\u2026" style="color:' + pal.ink + ';">' + escapeAttr(doc.text) + "</textarea>" +
      '<div class="stb-note-footer">' +
      '<span class="stb-doc-label" style="color:' + pal.ink + ';">Running notes</span>' +
      '<div class="stb-swatches">' + swatchesHTML + "</div>" +
      "</div>" +
      "</div>"
    );
  }

  function renderBoard() {
    var board = document.getElementById("stb-board");
    var visible = getVisibleNotes();
    var docs = state.documents;
    if (visible.length === 0 && docs.length === 0) {
      board.innerHTML =
        '<div class="stb-empty"><p>The board\'s empty. Pin a task, or start a running-notes page for something you\'re studying.</p>' +
        '<button data-action="add-note">+ New note</button></div>';
    } else {
      var noteMarkup = visible.map(function (n) {
        return poppedOutWindows[n.id] ? placeholderHTML(n, "note") : noteHTML(n);
      }).join("");
      var docMarkup = docs.map(function (d) {
        return poppedOutWindows[d.id] ? placeholderHTML(d, "doc") : docHTML(d);
      }).join("");
      board.innerHTML = noteMarkup + docMarkup;
    }
  }

  function renderAside() {
    var aside = document.getElementById("stb-clipboard");
    var visible = getVisibleNotes();
    var stats = computeStats(visible);
    var narrative = buildNarrative(stats, state.streak);
    var carriedPending = 0;
    visible.forEach(function (note) {
      note.items.forEach(function (it) {
        if (it.carried && !it.done && it.text.trim() !== "") carriedPending++;
      });
    });

    var padCount = Math.max(0, 6 - state.history.length);
    var paddedHistory = new Array(padCount).fill(null).concat(state.history.slice(-6));
    var barsHTML = paddedHistory.map(function (h) {
      var title = h ? h.date + ": " + h.percent + "%" : "No data";
      var height = h ? 6 + (h.percent / 100) * 42 + "px" : "4px";
      return '<div class="stb-bar" title="' + title + '" style="height:' + height + ';"></div>';
    }).join("") + '<div class="stb-bar" title="Today: ' + stats.percent + '%" style="height:' + (6 + (stats.percent / 100) * 42) + "px; background:#7A4B6B;\"></div>";

    var offset = RING_C * (1 - stats.percent / 100);
    var streakHTML = state.streak > 0
      ? '<div class="stb-streak">' + ICON.flame(15) + " " + state.streak + "-day streak</div>"
      : '<div class="stb-streak is-empty">Clear a full board to start a streak</div>';

    aside.innerHTML =
      '<div class="stb-clip-ring"></div><div class="stb-clip-band"></div>' +
      '<h2 class="stb-clipboard-heading">Dedication</h2>' +
      '<p class="stb-clipboard-date">' + formattedDate() + "</p>" +
      '<div class="stb-ring-wrap"><svg width="118" height="118" viewBox="0 0 120 120">' +
      '<circle cx="60" cy="60" r="' + RING_R + '" fill="none" stroke="#E3DCC8" stroke-width="10" />' +
      '<circle cx="60" cy="60" r="' + RING_R + '" fill="none" stroke="#2F4858" stroke-width="10" stroke-linecap="round" stroke-dasharray="' + RING_C + '" stroke-dashoffset="' + offset + '" transform="rotate(-90 60 60)" style="transition: stroke-dashoffset 0.6s ease;" />' +
      '<text x="60" y="57" text-anchor="middle" font-size="22" font-weight="700" fill="#2B2620" font-family="Work Sans, sans-serif">' + stats.percent + "%</text>" +
      '<text x="60" y="74" text-anchor="middle" font-size="9" fill="#6B6152" font-family="Work Sans, sans-serif">done today</text>' +
      "</svg></div>" +
      '<p class="stb-stat-line">' + stats.completed + " of " + stats.total + " pinned task" + (stats.total === 1 ? "" : "s") + " done</p>" +
      (carriedPending > 0 ? '<p class="stb-carried-line">' + carriedPending + " carried over from yesterday</p>" : "") +
      streakHTML +
      '<p class="stb-week-label">Last few days</p>' +
      '<div class="stb-week-bars">' + barsHTML + "</div>" +
      '<button class="stb-reveal-btn' + (showSummary ? " is-open" : "") + '" id="stb-reveal-btn">' + (showSummary ? "Hide summary" : "Read my summary") + " " + ICON.chevronDown(15) + "</button>" +
      '<div class="stb-narrative' + (showSummary ? " is-open" : "") + '"><p>' + narrative + "</p></div>";

    document.getElementById("stb-reveal-btn").addEventListener("click", function () {
      showSummary = !showSummary;
      renderAside();
    });
  }

  function render() {
    document.getElementById("stb-date").textContent = formattedDate();
    renderBoard();
    renderAside();
    renderAllPopouts();
  }

  // ---- drag to reposition on the board ----
  function startDrag(e, cardEl) {
    var board = document.getElementById("stb-board");
    var cardId = cardEl.getAttribute("data-card-id");
    var found = findCard(cardId);
    if (!found) return;
    var item = found.item;
    e.preventDefault();

    var cardRect = cardEl.getBoundingClientRect();
    var offsetX = e.clientX - cardRect.left;
    var offsetY = e.clientY - cardRect.top;

    activeDragId = cardId;
    cardEl.classList.add("is-dragging");
    cardEl.style.zIndex = 50;

    function handleMove(ev) {
      var rect = board.getBoundingClientRect();
      var x = ev.clientX - rect.left - offsetX;
      var y = ev.clientY - rect.top - offsetY;
      x = Math.max(0, Math.min(x, rect.width - cardRect.width));
      y = Math.max(0, Math.min(y, rect.height - cardRect.height));
      item.x = x;
      item.y = y;
      cardEl.style.left = x + "px";
      cardEl.style.top = y + "px";
    }
    function handleUp() {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      activeDragId = null;
      cardEl.classList.remove("is-dragging");
      cardEl.style.zIndex = 1;
      saveState();
    }
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  function clampCardsToBoard() {
    var board = document.getElementById("stb-board");
    if (!board) return;
    var rect = board.getBoundingClientRect();
    var changed = false;
    state.notes.forEach(function (n) {
      var maxX = Math.max(0, rect.width - NOTE_W);
      var maxY = Math.max(0, rect.height - 40);
      if (n.x > maxX) { n.x = maxX; changed = true; }
      if (n.y > maxY) { n.y = maxY; changed = true; }
    });
    state.documents.forEach(function (d) {
      var maxX = Math.max(0, rect.width - DOC_W);
      var maxY = Math.max(0, rect.height - 40);
      if (d.x > maxX) { d.x = maxX; changed = true; }
      if (d.y > maxY) { d.y = maxY; changed = true; }
    });
    if (changed) { saveState(); renderBoard(); }
  }

  // ---- event delegation ----
  function attachCardEvents(container, opts) {
    opts = opts || {};
    var enableReposition = opts.enableReposition !== false;

    container.addEventListener("click", function (e) {
      var expBtn = e.target.closest("[data-export-id]");
      if (expBtn) { exportCardAsFile(expBtn.getAttribute("data-export-id")); return; }

      var btn = e.target.closest("[data-action]");
      if (!btn) return;
      var action = btn.getAttribute("data-action");
      var cardId = btn.getAttribute("data-card-id");
      if (action === "add-note") { addNote(); return; }
      if (action === "add-doc") { addDocument(); return; }
      if (action === "pop-out") { popOutCard(cardId); return; }
      if (action === "focus-popout") { focusPopout(cardId); return; }
      if (action === "close-popout") { closePopout(cardId); return; }
      if (action === "delete-card") {
        var foundDel = findCard(cardId);
        if (foundDel && foundDel.kind === "doc") deleteDocument(cardId); else deleteNote(cardId);
        return;
      }
      if (action === "copy-card") { copyCardText(cardId); return; }
      if (action === "toggle-item") { toggleItem(cardId, btn.getAttribute("data-item-id")); return; }
      if (action === "delete-item") { deleteItem(cardId, btn.getAttribute("data-item-id")); return; }
      if (action === "toggle-picker") { togglePicker(cardId); return; }
      if (action === "set-color") {
        var idx = parseInt(btn.getAttribute("data-color-index"), 10);
        var foundColor = findCard(cardId);
        if (foundColor && foundColor.kind === "doc") setDocColor(cardId, idx); else setColor(cardId, idx);
        return;
      }
      if (action === "toggle-day") { toggleDay(cardId, parseInt(btn.getAttribute("data-day-index"), 10)); return; }
    });

    container.addEventListener("input", function (e) {
      var el = e.target;
      var role = el.getAttribute("data-role");
      var cardId = el.getAttribute("data-card-id");
      if (role === "title") {
        var found = findCard(cardId);
        if (found && found.kind === "doc") updateDocTitle(cardId, el.value, true);
        else updateTitle(cardId, el.value, true);
      } else if (role === "item-text") {
        updateItemText(cardId, el.getAttribute("data-item-id"), el.value, true);
      } else if (role === "add-item") {
        draftItems[cardId] = el.value;
      } else if (role === "doc-text") {
        updateDocText(cardId, el.value, true);
      }
    });

    container.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && e.target.getAttribute("data-role") === "add-item") {
        var noteId = e.target.getAttribute("data-card-id");
        var val = e.target.value.trim();
        if (val) {
          delete draftItems[noteId];
          addItem(noteId, val);
        }
      }
    });

    if (enableReposition) {
      container.addEventListener("pointerdown", function (e) {
        if (e.target.closest("input, button, textarea, select")) return;
        var cardEl = e.target.closest(".stb-note, .stb-doc");
        if (!cardEl) return;
        startDrag(e, cardEl);
      });
    }

    container.addEventListener("dragstart", function (e) {
      var handle = e.target.closest("[data-export-id]");
      if (!handle) return;
      handleExportDragStart(e, handle.getAttribute("data-export-id"));
    });
  }

  // ---- install prompt (Chrome/Edge, desktop + Android) ----
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

  // ---- iOS "Add to Home Screen" tip (no beforeinstallprompt on iOS Safari) ----
  function isIos() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }
  function isInStandaloneMode() {
    return ("standalone" in navigator && navigator.standalone) || window.matchMedia("(display-mode: standalone)").matches;
  }
  function maybeShowIosTip() {
    if (!isIos() || isInStandaloneMode()) return;
    if (localStorage.getItem(IOS_TIP_KEY) === "1") return;
    var el = document.getElementById("stb-ios-tip");
    el.innerHTML =
      '<span>On iPhone/iPad: tap the Share icon, then "Add to Home Screen" to install this board.</span>' +
      '<button id="stb-ios-tip-dismiss">Got it</button>';
    el.className = "stb-ios-tip";
    document.getElementById("stb-ios-tip-dismiss").addEventListener("click", function () {
      try { localStorage.setItem(IOS_TIP_KEY, "1"); } catch (e) {}
      el.innerHTML = "";
      el.className = "";
    });
  }

  // ---- init ----
  function init() {
    state = loadOrInitState();
    saveState();

    var addBtn = document.getElementById("stb-add-btn");
    addBtn.innerHTML = ICON.plus(16) + " New note";
    addBtn.addEventListener("click", addNote);

    var addDocBtn = document.getElementById("stb-add-doc-btn");
    if (addDocBtn) {
      addDocBtn.innerHTML = ICON.plus(16) + " New document";
      addDocBtn.addEventListener("click", addDocument);
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

    attachCardEvents(document.getElementById("stb-board"));
    maybeShowIosTip();
    render();

    window.addEventListener("resize", clampCardsToBoard);

    // Catch the day changing while the app stays open (e.g. left in a browser tab overnight).
    setInterval(function () {
      var rolled = rollover(state);
      if (rolled !== state) {
        state = rolled;
        saveState();
        render();
      }
    }, 60000);
  }

  document.addEventListener("DOMContentLoaded", init);

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    });
  }
})();
