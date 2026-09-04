(function (STB) {
  "use strict";

  var firedToday = {}; // "noteId:dateString" -> true, so a note only fires once per day
  function remindersEnabled() {
    return localStorage.getItem("remindersEnabled") !== "false";
  }

  function canNotify() {
    return typeof window.Notification !== "undefined";
  }

  // ---- alarm sound (synthesized, no audio file to ship or fetch) ----
  var audioCtx = null;

  // Browsers refuse to start audio unless it happens on the back of a genuine
  // user gesture (click/tap). Call this from inside a real click handler once
  // (the reminders button already qualifies) so the AudioContext is "unlocked"
  // and can be reused later when a reminder fires on its own, with no click.
  function unlockAudio() {
    try {
      var AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioCtx) audioCtx = new AudioCtx();
      if (audioCtx.state === "suspended") audioCtx.resume();
    } catch (e) {}
  }

  function beep(ctx, startTime, freq, duration) {
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(0.3, startTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.05);
  }

  // A simple two-tone alarm-clock-style beep, repeated a few times.
  function playAlarmSound() {
    try {
      if (!audioCtx) unlockAudio();
      if (!audioCtx) return;
      var now = audioCtx.currentTime;
      for (var i = 0; i < 4; i++) {
        beep(audioCtx, now + i * 0.55, 880, 0.16);
        beep(audioCtx, now + i * 0.55 + 0.2, 659, 0.16);
      }
    } catch (e) {}
  }

  if (typeof window !== "undefined") {
    window.addEventListener("pointerdown", unlockAudio, { once: true, passive: true });
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

  var alarmQueue = [];
  var currentAlarmNoteId = null;

  function renderAlarmModal(note, title, body) {
    var el = document.createElement("div");
    el.className = "stb-alarm-overlay";
    el.id = "stb-alarm-overlay";
    el.innerHTML =
      '<div class="stb-alarm-card">' +
      '<div class="stb-alarm-bell">' + STB.ICON.bell(28) + "</div>" +
      '<h3 class="stb-alarm-title">' + STB.escapeAttr(title) + "</h3>" +
      '<p class="stb-alarm-body">' + STB.escapeAttr(body) + "</p>" +
      '<div class="stb-alarm-actions">' +
      '<button class="stb-alarm-snooze" id="stb-alarm-snooze-btn">Snooze 5 min</button>' +
      '<button class="stb-alarm-dismiss" id="stb-alarm-dismiss-btn">Dismiss</button>' +
      "</div>" +
      "</div>";
    document.body.appendChild(el);
    document.getElementById("stb-alarm-dismiss-btn").addEventListener("click", function () { dismissAlarm(false); });
    document.getElementById("stb-alarm-snooze-btn").addEventListener("click", function () { dismissAlarm(true, note); });
  }

  function dismissAlarm(shouldSnooze, note) {
    var el = document.getElementById("stb-alarm-overlay");
    if (el) el.remove();
    currentAlarmNoteId = null;
    if (shouldSnooze && note) {
      setTimeout(function () {
        alarmQueue.push(note);
        showNextAlarm();
      }, 5 * 60 * 1000);
    }
    showNextAlarm();
  }

  function showNextAlarm() {
    if (currentAlarmNoteId || alarmQueue.length === 0) return;
    var note = alarmQueue.shift();
    currentAlarmNoteId = note.id;
    var title = STB.autoTitleFor("note", note);
    var openTasks = note.items.filter(function (it) { return it.text.trim() !== "" && !it.done; }).map(function (it) { return it.text; });
    var body = openTasks.length > 0 ? openTasks.slice(0, 3).join(", ") : "Time to check this note.";
    playAlarmSound();
    renderAlarmModal(note, title, body);
  }

  function fireReminder(note) {
    var title = "Reminder: " + STB.autoTitleFor("note", note);
    var openTasks = note.items.filter(function (it) { return it.text.trim() !== "" && !it.done; }).map(function (it) { return it.text; });
    var body = openTasks.length > 0 ? openTasks.slice(0, 3).join(", ") : "Time to check this note.";

    // The OS notification still fires too, since that's the only thing that can
    // reach the user if this tab isn't the one they're currently looking at.
    if (canNotify() && Notification.permission === "granted") {
      try {
        var n = new Notification(title, { body: body, tag: "stb-reminder-" + note.id });
        n.onclick = function () { window.focus(); n.close(); };
      } catch (e) {}
    }

    if (navigator.vibrate) {
      try { navigator.vibrate([200, 100, 200, 100, 200]); } catch (e) {}
    }

    alarmQueue.push(note);
    showNextAlarm();
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
        unlockAudio();
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
        unlockAudio();
        STB.requestNotificationPermission().then(function () { STB.renderReminderButton(); });
      };
    }
  };
})(window.STB = window.STB || {});
