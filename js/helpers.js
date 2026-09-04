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
        items: (n.items || []).map(function (it) {
          return Object.assign({}, it, { carried: !!it.carried, reminderTime: it.reminderTime || null });
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

  STB.rollover = function (data) {
    var today = STB.todayKey();
    if (data.date === today) return data;
    var yesterdayWeekday = new Date(data.date).getDay();
    var yesterdayVisible = data.notes.filter(function (n) {
      return n.days.length === 0 || n.days.indexOf(yesterdayWeekday) !== -1;
    });
    var stats = STB.computeStats(yesterdayVisible);
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
  };

  STB.normalizeAndRollover = function (data) {
    data.notes = STB.normalizeNotes(data.notes);
    data.documents = STB.normalizeDocuments(data.documents);
    return STB.rollover(data);
  };
})(window.STB = window.STB || {});
