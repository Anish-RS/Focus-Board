(function (STB) {
  "use strict";

  STB.uid = function () {
    return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  };

  STB.todayKey = function () {
    return new Date().toDateString();
  };

  STB.escapeAttr = function (str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  };

  STB.formattedDate = function () {
    return new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  };

  STB.autoTitleFor = function (kind, item) {
    var t = (item.title || "").trim();
    if (t) return t;
    if (kind === "doc") {
      var text = (item.text || "").trim();
      if (text) {
        var firstLine = text.split("\n").map(function (l) { return l.trim(); }).filter(Boolean)[0] || "";
        if (firstLine) return firstLine.length > 40 ? firstLine.slice(0, 40).trim() + "\u2026" : firstLine;
      }
      return "Untitled document";
    }
    var firstItemText = (item.items || []).map(function (it) { return it.text.trim(); }).filter(Boolean)[0];
    if (firstItemText) return firstItemText.length > 30 ? firstItemText.slice(0, 30).trim() + "\u2026" : firstItemText;
    return "Untitled note";
  };

  STB.computeStats = function (notes) {
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
  };

  STB.normalizeNotes = function (notes) {
    return (notes || []).map(function (n) {
      return Object.assign({}, n, {
        days: Array.isArray(n.days) ? n.days : [],
        reminderTime: n.reminderTime || null,
        zIndex: n.zIndex || null,
        items: (n.items || []).map(function (it) {
          return Object.assign({}, it, { carried: !!it.carried });
        }),
      });
    });
  };

  STB.normalizeDocuments = function (docs) {
    return (docs || []).map(function (d) {
      return Object.assign({}, d, {
        title: d.title || "",
        text: d.text || "",
        color: typeof d.color === "number" ? d.color : 0,
        archived: !!d.archived,
        width: d.width || null,
        height: d.height || null,
        zIndex: d.zIndex || null,
      });
    });
  };

  STB.starterNotes = function () {
    var uid = STB.uid;
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
  };

  STB.buildNarrative = function (stats, streak) {
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
  };

  STB.nextGridPosition = function (count, itemW, itemH, canvasW) {
    var cols = Math.max(1, Math.floor((canvasW - 40) / (itemW + 20)));
    var col = count % cols;
    var row = Math.floor(count / cols);
    return { x: 30 + col * (itemW + 20), y: 30 + row * (itemH + 20) };
  };

  // ---- placement ----
  // Every card currently on the board, as a rectangle. Archived documents are excluded
  // because they aren't on the board.
  STB.occupiedRects = function () {
    if (!STB.state) return [];
    var rects = [];
    (STB.state.notes || []).forEach(function (n) {
      rects.push({
        x: Number(n.x) || 0,
        y: Number(n.y) || 0,
        w: Number(n.width) || STB.NOTE_W,
        h: STB.NOTE_H_ESTIMATE,
      });
    });
    (STB.state.documents || []).forEach(function (d) {
      if (d.archived) return;
      rects.push({
        x: Number(d.x) || 0,
        y: Number(d.y) || 0,
        w: Number(d.width) || STB.DOC_W,
        h: Number(d.height) || STB.DOC_H_ESTIMATE,
      });
    });
    return rects;
  };

  var SLOT_PAD = 14;

  function freeAmong(rects, x, y, w, h) {
    for (var i = 0; i < rects.length; i++) {
      var r = rects[i];
      if (
        x < r.x + r.w + SLOT_PAD &&
        x + w + SLOT_PAD > r.x &&
        y < r.y + r.h + SLOT_PAD &&
        y + h + SLOT_PAD > r.y
      ) return false;
    }
    return true;
  }

  STB.isPositionFree = function (x, y, w, h) {
    return freeAmong(STB.occupiedRects(), x, y, w, h);
  };

  // The old code placed a new card at "grid cell number <how many cards exist>", which says
  // nothing about whether that cell is already taken -- and it routinely was, because notes
  // and documents share one grid, and because archiving a document doesn't advance the
  // count. Combined with new cards having no z-index (so they sat at the bottom of the
  // stack), a freshly added card could be created *completely hidden* behind an existing
  // one. That is what made "New document" and "Restore" look like they needed two clicks:
  // the first click worked, you just couldn't see the result.
  // ---- where the user can actually see ----
  // The board is a scrolling viewport, so "a free spot" and "a spot you can see" are two
  // different questions. A card placed at y=900 on a 700px-tall board is perfectly free
  // and completely invisible, which is why every new note used to land below the fold
  // while the top of the board sat empty.
  STB.boardViewport = function () {
    var b = document.getElementById("stb-board");
    var vw = 0, vh = 0, left = 0, top = 0;
    if (b) {
      left = b.scrollLeft || 0;
      top = b.scrollTop || 0;
      vw = b.clientWidth || b.offsetWidth || 0;
      vh = b.clientHeight || b.offsetHeight || 0;
    }
    if (!vw) vw = (typeof window !== "undefined" && window.innerWidth) || 1024;
    if (!vh) vh = (typeof window !== "undefined" && window.innerHeight) || 768;
    return { left: left, top: top, width: vw, height: vh };
  };

  // The card that was touched or added most recently -- where the eye already is.
  STB.newestCardRect = function () {
    if (!STB.state) return null;
    var best = null;
    function consider(x, y, w, h, z) {
      if (best && !(z > best.z)) return;
      best = { x: x, y: y, w: w, h: h, z: z };
    }
    (STB.state.notes || []).forEach(function (n) {
      consider(Number(n.x) || 0, Number(n.y) || 0, Number(n.width) || STB.NOTE_W,
        STB.NOTE_H_ESTIMATE, Number(n.zIndex) || 0);
    });
    (STB.state.documents || []).forEach(function (d) {
      if (d.archived) return;
      consider(Number(d.x) || 0, Number(d.y) || 0, Number(d.width) || STB.DOC_W,
        Number(d.height) || STB.DOC_H_ESTIMATE, Number(d.zIndex) || 0);
    });
    return best;
  };

  var VIEW_PAD = 30;   // the margin the old grid started from, kept so a fresh board
                       // still opens with its first note at 30,30
  var CASCADE_X = 28;  // each card in a stack steps right...
  var CASCADE_Y = 26;  // ...and down, so the card underneath still shows its top edge

  // Completely hidden by one single card on top of it (as opposed to partly overlapped).
  function isBuried(rects, x, y, w, h) {
    for (var i = 0; i < rects.length; i++) {
      var r = rects[i];
      if (r.x <= x && r.y <= y && r.x + r.w >= x + w && r.y + r.h >= y + h) return true;
    }
    return false;
  }

  STB.nextFreePosition = function (itemW, itemH, canvasW) {
    var rects = STB.occupiedRects();
    var view = STB.boardViewport();
    var vw = Math.max(Number(view.width) || 0, itemW + VIEW_PAD * 2, Number(canvasW) || 0);
    var vh = Math.max(Number(view.height) || 0, itemH + VIEW_PAD * 2);
    var left = view.left, top = view.top;

    // 1. A tidy spot inside what is on screen right now. Scrolling counts: if the user has
    //    scrolled down, "what is on screen" starts at scrollTop, not at zero.
    var cols = Math.max(1, Math.floor((vw - VIEW_PAD) / (itemW + 20)));
    var rows = Math.max(1, Math.floor((vh - VIEW_PAD) / (itemH + 20)));
    for (var row = 0; row < rows; row++) {
      for (var col = 0; col < cols; col++) {
        var gx = left + VIEW_PAD + col * (itemW + 20);
        var gy = top + VIEW_PAD + row * (itemH + 20);
        if (freeAmong(rects, gx, gy, itemW, itemH)) return { x: gx, y: gy };
      }
    }

    // 2. Every tidy slot is taken. Rather than fling the card off the bottom of the board,
    //    stack it on the newest one in cascade steps: overlapping, but every card keeps a
    //    strip of itself showing, and the stack never leaves the visible area.
    var anchor = STB.newestCardRect();
    var startX = left + VIEW_PAD;
    var startY = top + VIEW_PAD;
    if (anchor) {
      startX = Math.max(left + VIEW_PAD, Math.min(anchor.x + CASCADE_X, left + vw - itemW));
      startY = Math.max(top + VIEW_PAD, Math.min(anchor.y + CASCADE_Y, top + vh - itemH));
    }
    var perRow = Math.max(1, Math.floor((vw - itemW - VIEW_PAD) / CASCADE_X));
    for (var k = 0; k < 80; k++) {
      var cx = startX + (k % perRow) * CASCADE_X;
      var cy = startY + Math.floor(k / perRow) * CASCADE_Y;
      if (cx + itemW > left + vw || cy + itemH > top + vh) break;
      if (!isBuried(rects, cx, cy, itemW, itemH)) return { x: cx, y: cy };
    }

    // 3. Nothing sensible left even for a stack -- the front of the visible area is still a
    //    better answer than somewhere the user has to go looking for.
    return { x: left + VIEW_PAD, y: top + VIEW_PAD };
  };

  STB.rollover = function (data) {
    var today = STB.todayKey();
    if (data.date === today) return data;
    // A stored date that can't be parsed (hand-edited storage, a very old schema, a bad
    // sync) used to make getDay() return NaN. Nothing matched the weekday filter, the
    // history was written with a 0% day, and the streak silently reset. Skip the tally
    // entirely in that case rather than record a day that never happened.
    var previousDate = new Date(data.date);
    var dateIsUsable = !isNaN(previousDate.getTime());
    var yesterdayWeekday = dateIsUsable ? previousDate.getDay() : null;
    var yesterdayVisible = data.notes.filter(function (n) {
      return n.days.length === 0 || n.days.indexOf(yesterdayWeekday) !== -1;
    });
    var stats = STB.computeStats(yesterdayVisible);
    var newHistory = dateIsUsable
      ? (data.history || []).concat([{ date: data.date, percent: stats.percent }]).slice(-7)
      : (data.history || []).slice(-7);
    var newStreak = dateIsUsable
      ? (stats.total > 0 && stats.percent === 100 ? (data.streak || 0) + 1 : 0)
      : (data.streak || 0);

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
    return { date: today, notes: rolledNotes, documents: data.documents || [], streak: newStreak, history: newHistory, nextZIndex: data.nextZIndex || 2 };
  };

  STB.normalizeAndRollover = function (data) {
    data.notes = STB.normalizeNotes(data.notes);
    data.documents = STB.normalizeDocuments(data.documents);
    return STB.rollover(data);
  };
})(window.STB = window.STB || {});
