(function (STB) {
  "use strict";

  function noteHTML(note, opts) {
    opts = opts || {};
    var pal = STB.PALETTE[note.color];
    var ICON = STB.ICON;
    var recurring = note.days.length > 0;
    var isPickerOpen = STB.openDayPickerId === note.id;
    var isCopied = STB.copiedId === note.id;
    var isDragging = STB.activeDragId === note.id;
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
        '<input class="stb-item-input" data-role="item-text" data-card-id="' + note.id + '" data-item-id="' + it.id + '" value="' + STB.escapeAttr(it.text) + '" placeholder="Type a task" style="color:' + pal.ink + "; text-decoration:" + (it.done ? "line-through" : "none") + "; opacity:" + (it.done ? 0.55 : 1) + ';" />' +
        '<button class="stb-item-delete" style="color:' + pal.ink + ';" data-action="delete-item" data-card-id="' + note.id + '" data-item-id="' + it.id + '" aria-label="Delete task">' + ICON.x(11) + "</button>" +
        "</div>"
      );
    }).join("");

    var dayLabel = recurring
      ? note.days.slice().sort(function (a, b) { return a - b; }).map(function (d) { return STB.DAY_LETTERS[d]; }).join(" ")
      : "Just today";

    var pickerHTML = "";
    if (isPickerOpen) {
      var chips = STB.DAY_LETTERS.map(function (d, i) {
        var on = note.days.indexOf(i) !== -1;
        var chipStyle = on ? "background:" + pal.ink + ";border-color:" + pal.ink + ";color:" + pal.bg + ";" : "border-color:" + pal.ink + ";color:" + pal.ink + ";";
        return '<button class="stb-day-chip" title="' + STB.DAY_NAMES[i] + '" style="' + chipStyle + '" data-action="toggle-day" data-card-id="' + note.id + '" data-day-index="' + i + '">' + d + "</button>";
      }).join("");
      pickerHTML =
        '<div class="stb-day-picker">' + chips +
        '<button class="stb-day-done" style="color:' + pal.ink + ";border-color:" + pal.ink + ';" data-action="toggle-picker" data-card-id="' + note.id + '">Done</button>' +
        "</div>";
    }

    var isReminderPickerOpen = STB.openReminderPickerId === note.id;
    var reminderPickerHTML = "";
    if (isReminderPickerOpen) {
      reminderPickerHTML =
        '<div class="stb-reminder-row">' +
        '<input type="time" class="stb-reminder-input" data-role="reminder-time" data-card-id="' + note.id + '" value="' + (note.reminderTime || "") + '" style="color:' + pal.ink + ';" />' +
        (note.reminderTime
          ? '<button class="stb-reminder-clear" data-action="clear-reminder" data-card-id="' + note.id + '" style="color:' + pal.ink + ';" title="Remove reminder" aria-label="Remove reminder">' + ICON.x(11) + "</button>"
          : "") +
        '<button class="stb-day-done" data-action="toggle-reminder-picker" data-card-id="' + note.id + '" style="color:' + pal.ink + ";border-color:" + pal.ink + ';">Done</button>' +
        "</div>";
    }

    var swatchesHTML = STB.PALETTE.map(function (p, idx) {
      var shadow = idx === note.color ? "0 0 0 2px " + p.ink : "none";
      return '<button class="stb-swatch" style="background:' + p.bg + "; box-shadow:" + shadow + ';" data-action="set-color" data-card-id="' + note.id + '" data-color-index="' + idx + '" aria-label="Change note color to ' + p.name + '"></button>';
    }).join("");

    var draftVal = STB.draftItems[note.id] || "";

    var actionsHTML = opts.hideActions
      ? ""
      : '<div class="stb-note-actions">' +
        '<button class="stb-note-popout" style="color:' + pal.ink + ';" data-action="pop-out" data-card-id="' + note.id + '" aria-label="Pop out" title="Pop this note out into its own window on your desktop (you can pop out several at once)">' + ICON.popout(12) + "</button>" +
        '<button class="stb-note-copy" style="color:' + pal.ink + ';" data-action="copy-card" data-card-id="' + note.id + '" aria-label="Copy note text" title="Copy note text to paste into another app">' + (isCopied ? ICON.check(13) : ICON.copy(13)) + "</button>" +
        '<button class="stb-note-delete" data-action="delete-card" data-card-id="' + note.id + '" aria-label="Remove note">' + ICON.x(13) + "</button>" +
        "</div>";

    return (
      '<div class="stb-note' + (isDragging ? " is-dragging" : "") + '" data-card-id="' + note.id + '" style="' + style + '">' +
      '<span class="stb-pin" style="background:' + pal.ink + ';"></span>' +
      actionsHTML +
      '<input class="stb-note-title" data-role="title" data-card-id="' + note.id + '" value="' + STB.escapeAttr(note.title) + '" placeholder="Untitled note" style="color:' + pal.ink + ';" />' +
      '<div class="stb-items">' + itemsHTML + "</div>" +
      '<input class="stb-additem-input" data-role="add-item" data-card-id="' + note.id + '" value="' + STB.escapeAttr(draftVal) + '" placeholder="Add a task, press Enter" style="color:' + pal.ink + "; border-top-color:" + pal.ink + '33;" />' +
      '<div class="stb-note-footer">' +
      '<div class="stb-schedule-group">' +
      '<button class="stb-repeat-btn" style="color:' + pal.ink + ";border-color:" + pal.ink + ';" data-action="toggle-picker" data-card-id="' + note.id + '">' + ICON.repeat(11) + " " + dayLabel + "</button>" +
      '<button class="stb-reminder-btn" style="color:' + pal.ink + ";border-color:" + pal.ink + ';" data-action="toggle-reminder-picker" data-card-id="' + note.id + '" title="' + (note.reminderTime ? "Reminder at " + note.reminderTime + " -- click to change" : "Set a time to be reminded about this note") + '">' + ICON.bell(11) + (note.reminderTime ? " " + note.reminderTime : "") + "</button>" +
      "</div>" +
      '<div class="stb-swatches">' + swatchesHTML + "</div>" +
      "</div>" +
      pickerHTML +
      reminderPickerHTML +
      "</div>"
    );
  }

  function docHTML(doc, opts) {
    opts = opts || {};
    var pal = STB.PALETTE[doc.color];
    var ICON = STB.ICON;
    var isCopied = STB.copiedId === doc.id;
    var isDragging = STB.activeDragId === doc.id;
    var style = "background:" + pal.bg + "; left:" + doc.x + "px; top:" + doc.y + "px; transform:rotate(" + doc.rotation + "deg); z-index:" + (isDragging ? 50 : 1) + ";";

    var swatchesHTML = STB.PALETTE.map(function (p, idx) {
      var shadow = idx === doc.color ? "0 0 0 2px " + p.ink : "none";
      return '<button class="stb-swatch" style="background:' + p.bg + "; box-shadow:" + shadow + ';" data-action="set-color" data-card-id="' + doc.id + '" data-color-index="' + idx + '" aria-label="Change color to ' + p.name + '"></button>';
    }).join("");

    var actionsHTML = opts.hideActions
      ? ""
      : '<div class="stb-note-actions">' +
        '<button class="stb-note-popout" style="color:' + pal.ink + ';" data-action="pop-out" data-card-id="' + doc.id + '" aria-label="Pop out" title="Pop this out into a window that floats on top of other apps while you study">' + ICON.popout(12) + "</button>" +
        '<button class="stb-note-save" style="color:' + pal.ink + ';" data-action="archive-doc" data-card-id="' + doc.id + '" aria-label="Save to sidebar" title="Save this to the sidebar and clear it off the board">' + ICON.bookmark(12) + "</button>" +
        '<button class="stb-note-copy" style="color:' + pal.ink + ';" data-action="copy-card" data-card-id="' + doc.id + '" aria-label="Copy note text" title="Copy text to paste into another app">' + (isCopied ? ICON.check(13) : ICON.copy(13)) + "</button>" +
        '<button class="stb-note-delete" data-action="delete-card" data-card-id="' + doc.id + '" aria-label="Remove document">' + ICON.x(13) + "</button>" +
        "</div>";

    return (
      '<div class="stb-doc' + (isDragging ? " is-dragging" : "") + '" data-card-id="' + doc.id + '" style="' + style + '">' +
      '<span class="stb-pin" style="background:' + pal.ink + ';"></span>' +
      actionsHTML +
      '<input class="stb-note-title" data-role="title" data-card-id="' + doc.id + '" value="' + STB.escapeAttr(doc.title) + '" placeholder="Untitled document" style="color:' + pal.ink + ';" />' +
      '<textarea class="stb-doc-text" data-role="doc-text" data-card-id="' + doc.id + '" placeholder="Jot running notes here while you watch or read\u2026" style="color:' + pal.ink + ';">' + STB.escapeAttr(doc.text) + "</textarea>" +
      '<div class="stb-note-footer">' +
      '<span class="stb-doc-label" style="color:' + pal.ink + ';">Running notes</span>' +
      '<div class="stb-swatches">' + swatchesHTML + "</div>" +
      "</div>" +
      "</div>"
    );
  }

  function placeholderHTML(item, kind) {
    var pal = STB.PALETTE[item.color];
    var w = kind === "doc" ? STB.DOC_W : STB.NOTE_W;
    var style = "background:" + pal.bg + "; left:" + item.x + "px; top:" + item.y + "px; width:" + w + "px; border:2px dashed " + pal.ink + "; opacity:0.7;";
    return (
      '<div class="stb-placeholder" data-action="focus-popout" data-card-id="' + item.id + '" style="' + style + '">' +
      '<div class="stb-placeholder-title" style="color:' + pal.ink + ';">' + STB.escapeAttr(STB.autoTitleFor(kind, item)) + "</div>" +
      '<div class="stb-placeholder-sub" style="color:' + pal.ink + ';">Popped out \u2014 click to bring to front</div>' +
      '<button class="stb-placeholder-close" style="color:' + pal.ink + ';" data-action="close-popout" data-card-id="' + item.id + '" aria-label="Bring back to board" title="Close the pop-out and bring it back to the board">' + STB.ICON.x(12) + "</button>" +
      "</div>"
    );
  }

  function renderBoard() {
    var board = document.getElementById("stb-board");
    var allCards =
      STB.getVisibleNotes().concat(
        STB.state.documents.filter(function (d) {
          return !d.archived;
        })
      );
    
    var maxX = 0;
    var maxY = 0;
    
    allCards.forEach(function (card) {
      maxX = Math.max(maxX, card.x);
      maxY = Math.max(maxY, card.y);
    });
    
    board.style.minWidth = (maxX + 800) + "px";
    board.style.minHeight = (maxY + 800) + "px";
    var visible = STB.getVisibleNotes();
    var docs = STB.state.documents.filter(function (d) { return !d.archived; });
    if (visible.length === 0 && docs.length === 0) {
      board.innerHTML =
        '<div class="stb-empty"><p>The board\'s empty. Pin a task, or start a running-notes page for something you\'re studying.</p>' +
        '<button data-action="add-note">+ New note</button></div>';
    } else {
      var noteMarkup = visible.map(function (n) {
        return STB.poppedOutWindows[n.id] ? placeholderHTML(n, "note") : noteHTML(n);
      }).join("");
      var docMarkup = docs.map(function (d) {
        return STB.poppedOutWindows[d.id] ? placeholderHTML(d, "doc") : docHTML(d);
      }).join("");
      board.innerHTML = noteMarkup + docMarkup;
    }
  }

  function renderAside() {
    var aside = document.getElementById("stb-clipboard");
    var visible = STB.getVisibleNotes();
    var stats = STB.computeStats(visible);
    var narrative = STB.buildNarrative(stats, STB.state.streak);
    var carriedPending = 0;
    visible.forEach(function (note) {
      note.items.forEach(function (it) {
        if (it.carried && !it.done && it.text.trim() !== "") carriedPending++;
      });
    });

    var padCount = Math.max(0, 6 - STB.state.history.length);
    var paddedHistory = new Array(padCount).fill(null).concat(STB.state.history.slice(-6));
    var barsHTML = paddedHistory.map(function (h) {
      var title = h ? h.date + ": " + h.percent + "%" : "No data";
      var height = h ? 6 + (h.percent / 100) * 42 + "px" : "4px";
      return '<div class="stb-bar" title="' + title + '" style="height:' + height + ';"></div>';
    }).join("") + '<div class="stb-bar" title="Today: ' + stats.percent + '%" style="height:' + (6 + (stats.percent / 100) * 42) + "px; background:#7A4B6B;\"></div>";

    var offset = STB.RING_C * (1 - stats.percent / 100);
    var streakHTML = STB.state.streak > 0
      ? '<div class="stb-streak">' + STB.ICON.flame(15) + " " + STB.state.streak + "-day streak</div>"
      : '<div class="stb-streak is-empty">Clear a full board to start a streak</div>';

    var archivedDocs = STB.state.documents.filter(function (d) { return d.archived; });
    var savedSectionHTML = "";
    if (archivedDocs.length > 0) {
      savedSectionHTML =
        '<div class="stb-saved-section">' +
        '<p class="stb-saved-label">Saved notes</p>' +
        archivedDocs.map(function (d) {
          var p = STB.PALETTE[d.color];
          return (
            '<div class="stb-saved-item">' +
            '<span class="stb-saved-dot" style="background:' + p.bg + ";border-color:" + p.ink + ';"></span>' +
            '<span class="stb-saved-title">' + STB.escapeAttr(STB.autoTitleFor("doc", d)) + "</span>" +
            '<button class="stb-saved-restore" data-action="restore-doc" data-card-id="' + d.id + '" title="Bring back to the board" aria-label="Restore to board">' + STB.ICON.restore(13) + "</button>" +
            '<button class="stb-saved-delete" data-action="delete-card" data-card-id="' + d.id + '" title="Delete permanently" aria-label="Delete permanently">' + STB.ICON.x(13) + "</button>" +
            "</div>"
          );
        }).join("") +
        "</div>";
    }

    aside.innerHTML =
      '<div class="stb-clip-ring"></div><div class="stb-clip-band"></div>' +
      '<h2 class="stb-clipboard-heading">Dedication</h2>' +
      '<p class="stb-clipboard-date">' + STB.formattedDate() + "</p>" +
      savedSectionHTML +
      '<div class="stb-ring-wrap"><svg width="118" height="118" viewBox="0 0 120 120">' +
      '<circle cx="60" cy="60" r="' + STB.RING_R + '" fill="none" stroke="#E3DCC8" stroke-width="10" />' +
      '<circle cx="60" cy="60" r="' + STB.RING_R + '" fill="none" stroke="#2F4858" stroke-width="10" stroke-linecap="round" stroke-dasharray="' + STB.RING_C + '" stroke-dashoffset="' + offset + '" transform="rotate(-90 60 60)" style="transition: stroke-dashoffset 0.6s ease;" />' +
      '<text x="60" y="57" text-anchor="middle" font-size="22" font-weight="700" fill="#2B2620" font-family="Work Sans, sans-serif">' + stats.percent + "%</text>" +
      '<text x="60" y="74" text-anchor="middle" font-size="9" fill="#6B6152" font-family="Work Sans, sans-serif">done today</text>' +
      "</svg></div>" +
      '<p class="stb-stat-line">' + stats.completed + " of " + stats.total + " pinned task" + (stats.total === 1 ? "" : "s") + " done</p>" +
      (carriedPending > 0 ? '<p class="stb-carried-line">' + carriedPending + " carried over from yesterday</p>" : "") +
      streakHTML +
      '<p class="stb-week-label">Last few days</p>' +
      '<div class="stb-week-bars">' + barsHTML + "</div>" +
      '<button class="stb-reveal-btn' + (STB.showSummary ? " is-open" : "") + '" id="stb-reveal-btn">' + (STB.showSummary ? "Hide summary" : "Read my summary") + " " + STB.ICON.chevronDown(15) + "</button>" +
      '<div class="stb-narrative' + (STB.showSummary ? " is-open" : "") + '"><p>' + narrative + "</p></div>";

    document.getElementById("stb-reveal-btn").addEventListener("click", function () {
      STB.showSummary = !STB.showSummary;
      renderAside();
    });
  }

  function renderPopout(id) {
    var entry = STB.poppedOutWindows[id];
    if (!entry) return;
    var found = STB.findCard(id);
    if (!found) { STB.closePopout(id); return; }
    entry.container.innerHTML = found.kind === "doc" ? docHTML(found.item, { hideActions: true }) : noteHTML(found.item, { hideActions: true });
  }

  function renderAllPopouts() {
    Object.keys(STB.poppedOutWindows).forEach(renderPopout);
  }

  function render() {
    document.getElementById("stb-date").textContent = STB.formattedDate();
    renderBoard();
    renderAside();
    renderAllPopouts();
  }

  STB.noteHTML = noteHTML;
  STB.docHTML = docHTML;
  STB.placeholderHTML = placeholderHTML;
  STB.renderBoard = renderBoard;
  STB.renderAside = renderAside;
  STB.renderPopout = renderPopout;
  STB.renderAllPopouts = renderAllPopouts;
  STB.render = render;
})(window.STB = window.STB || {});
