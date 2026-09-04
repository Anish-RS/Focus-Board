(function (STB) {
  "use strict";

  var firedToday = {}; // "noteId:dateString" -> true, so a note only fires once per day
  function remindersEnabled() {
    return localStorage.getItem("remindersEnabled") !== "false";
  }

  function canNotify() {
    return typeof window.Notification !== "undefined";
  }

  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function nowHHMM() {
    var d = new Date();
    return pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function minutesBetween(earlier, later) {
    var p1 = earlier.split(":").map(Number);
    var p2 = later.split(":").map(Number);
    return (p2[0] * 60 + p2[1]) - (p1[0] * 60 + p1[1]);
  }

  function showInAppReminder(title, body) {
    var el = document.createElement("div");
    el.className = "stb-inapp-reminder";
    el.innerHTML = "<strong>" + STB.escapeAttr(title) + "</strong><div>" + STB.escapeAttr(body) + "</div>";
    document.body.appendChild(el);
    setTimeout(function () {
      el.classList.add("is-leaving");
      setTimeout(function () { el.remove(); }, 400);
    }, 8000);
  }

  function fireReminder(note) {
    var title = "Reminder: " + STB.autoTitleFor("note", note);
    var openTasks = note.items.filter(function (it) { return it.text.trim() !== "" && !it.done; }).map(function (it) { return it.text; });
    var body = openTasks.length > 0 ? openTasks.slice(0, 3).join(", ") : "Time to check this note.";

    if (canNotify() && Notification.permission === "granted") {
      try {
        var n = new Notification(title, { body: body, tag: "stb-reminder-" + note.id });
        n.onclick = function () { window.focus(); n.close(); };
      } catch (e) {
        showInAppReminder(title, body);
      }
    } else {
      showInAppReminder(title, body);
    }
  }

  function checkReminders() {
    if (!STB.state) return;
    if (!remindersEnabled()) return;
    var today = STB.todayKey();
    var current = nowHHMM();
    STB.getVisibleNotes().forEach(function (note) {
      if (!note.reminderTime) return;
      var key = note.id + ":" + today;
      if (firedToday[key]) return;
      // Fire once the scheduled time has arrived, but only within a couple of minutes of
      // it -- so a reminder set for earlier today doesn't immediately fire the moment the
      // app happens to be opened hours later.
      if (note.reminderTime <= current && minutesBetween(note.reminderTime, current) <= 2) {
        firedToday[key] = true;
        fireReminder(note);
      }
    });
  }

  STB.notificationPermission = function () {
    return canNotify() ? Notification.permission : "unsupported";
  };

  STB.requestNotificationPermission = function () {
    if (!canNotify()) return Promise.resolve("unsupported");
    return Notification.requestPermission();
  };

  STB.startReminderChecks = function () {
    checkReminders();
    setInterval(checkReminders, 30000);
  };

  // Exposed for testing / manual re-render of the permission button after the user responds.
  STB.renderReminderButton = function () {
    var btn = document.getElementById("stb-reminder-btn");
    if (!btn) return;
    var perm = STB.notificationPermission();
    if (perm === "unsupported") { btn.style.display = "none"; return; }
    if (perm === "granted") {
    
      var enabled = remindersEnabled();
    
      btn.innerHTML =
        STB.ICON.bell(15) +
        (enabled ? " Reminders on" : " Reminders off");
    
      btn.disabled = false;
    
      btn.title = enabled
        ? "Click to turn reminders off"
        : "Click to turn reminders on";
    
      btn.onclick = function () {
    
        localStorage.setItem(
          "remindersEnabled",
          enabled ? "false" : "true"
        );
    
        STB.renderReminderButton();
      };
    } else if (perm === "denied") {
      btn.innerHTML = STB.ICON.bell(15) + " Reminders blocked";
      btn.disabled = true;
      btn.title = "Notifications are blocked in your browser settings for this site";
    } else {
      btn.innerHTML = STB.ICON.bell(15) + " Enable reminders";
      btn.disabled = false;
      btn.title = "Step 1 of 2: allow notifications here, then set a time on each note using its own bell icon";
      btn.onclick = function () {
        STB.requestNotificationPermission().then(function () { STB.renderReminderButton(); });
      };
    }
  };
})(window.STB = window.STB || {});
