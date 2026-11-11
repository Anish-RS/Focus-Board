(function (STB) {
  "use strict";

  // Snapshot-based undo. The whole board is a single small JSON object, so the simplest
  // thing that is guaranteed correct is to photograph the parts that can be destroyed and
  // put them back. No per-action inverse logic to get subtly wrong.
  //
  // The real problem this solves: every destructive control in the old build (delete note,
  // delete task, delete saved note) committed instantly, with no confirmation and no undo.
  // On a touch screen the delete "x" sits ~20px from the copy button.

  var MAX_STACK = 20;
  var stack = [];

  function photograph() {
    if (!STB.state) return null;
    return {
      notes: JSON.parse(JSON.stringify(STB.state.notes || [])),
      documents: JSON.parse(JSON.stringify(STB.state.documents || [])),
      nextZIndex: STB.state.nextZIndex || 2,
    };
  }

  function restore(snapshot) {
    if (!snapshot || !STB.state) return;
    STB.state.notes = snapshot.notes;
    STB.state.documents = snapshot.documents;
    STB.state.nextZIndex = snapshot.nextZIndex;
    STB.openDayPickerId = null;
    STB.openReminderPickerId = null;
    STB.openItemReminderId = null;
    STB.saveState();
    STB.render();
  }

  // Push the current board onto the undo stack before mutating it.
  STB.checkpoint = function (label) {
    var shot = photograph();
    if (!shot) return;
    stack.push({ label: label || "change", snapshot: shot });
    if (stack.length > MAX_STACK) stack.shift();
  };

  STB.canUndo = function () {
    return stack.length > 0;
  };

  STB.undo = function () {
    var entry = stack.pop();
    if (!entry) {
      if (STB.toast) STB.toast("Nothing left to undo", { duration: 2000 });
      return false;
    }
    restore(entry.snapshot);
    if (STB.toast) {
      STB.toast("Restored " + entry.label, { tone: "success", duration: 2500 });
    }
    return true;
  };

  // Wrap a destructive change: checkpoint, run it, offer Undo in a toast.
  //   STB.withUndo("note", "Note deleted", function () { STB.deleteNote(id); });
  STB.withUndo = function (label, message, mutate) {
    STB.checkpoint(label);
    mutate();
    if (STB.toast) {
      STB.toast(message, {
        actionLabel: "Undo",
        duration: 8000,
        onAction: function () { STB.undo(); },
      });
    }
  };
})(window.STB = window.STB || {});
