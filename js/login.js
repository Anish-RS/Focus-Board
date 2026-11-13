(function () {
  "use strict";

  // A password-reset link lands here as /login.html#access_token=...&type=recovery. Supabase
  // turns that into a real session, which the "already signed in? go to the board" gate below
  // would happily follow -- dropping the person straight into their notes with the password
  // never changed. Capture the intent before the hash is consumed.
  var isRecoveryLink =
    /(^|[#&?])type=recovery(&|$|#)/.test(window.location.hash) ||
    /(^|[?&])type=recovery(&|$|#)/.test(window.location.search);

  var mode = "signin";
  var usernameOk = false;
  var usernameCheckTimer = null;

  var tabs = document.getElementById("stb-login-tabs") || document.querySelector(".stb-login-tabs");
  var tabSignin = document.getElementById("stb-tab-signin");
  var tabSignup = document.getElementById("stb-tab-signup");
  var heading = document.getElementById("stb-login-heading");
  var sub = document.getElementById("stb-login-sub");
  var fieldUsername = document.getElementById("stb-field-username");
  var usernameInput = document.getElementById("stb-username");
  var usernameHint = document.getElementById("stb-username-hint");
  // Disables a button for a set period, counting down so the wait is visible rather than the
  // button just looking broken.
  function cooldown(btn, seconds) {
    var left = seconds;
    var label = "Resend it";
    btn.disabled = true;
    btn.textContent = label + " in " + left + "s";
    var timer = setInterval(function () {
      left -= 1;
      if (left <= 0) {
        clearInterval(timer);
        btn.disabled = false;
        btn.textContent = label;
        return;
      }
      btn.textContent = label + " in " + left + "s";
    }, 1000);
  }

  var emailInput = document.getElementById("stb-email");
  var passwordInput = document.getElementById("stb-password");
  var submitBtn = document.getElementById("stb-submit-btn");
  var msg = document.getElementById("stb-login-msg");
  var form = document.getElementById("stb-login-form");
  var trialNote = document.getElementById("stb-trial-note");

  // ---- "is this visitor already signed in?" gate ----
  // The form is hidden in the markup and only revealed once we know there's no session to
  // redirect. Every path below must call revealForm() or redirect; the timeout is a
  // safety net so a hung request can never leave someone staring at a spinner.
  var stageEl = document.querySelector(".stb-login-stage");
  var formRevealed = false;
  function revealForm() {
    if (formRevealed) return;
    formRevealed = true;
    if (stageEl) stageEl.classList.remove("is-checking");
  }
  setTimeout(revealForm, 4000);

  // Shown instead of the sign-in form when arriving from a password-reset email. The session
  // already exists (it came in the link), so all that's missing is the new password.
  function showRecoveryPanel() {
    if (tabs) tabs.style.display = "none";
    if (form) form.style.display = "none";
    if (trialNote) trialNote.style.display = "none";
    if (heading) heading.textContent = "Choose a new password";
    if (sub) sub.textContent = "You're signed in from the reset link. Set a new password to finish.";
    var host = (form && form.parentNode) || document.querySelector(".stb-login-card") || document.body;
    if (document.getElementById("stb-recovery-panel")) return;
    var box = document.createElement("div");
    box.id = "stb-recovery-panel";
    box.innerHTML =
      '<div class="stb-field">' +
      '  <label for="stb-new-password">New password</label>' +
      '  <input type="password" id="stb-new-password" placeholder="At least 8 characters" autocomplete="new-password" />' +
      "</div>" +
      '<div class="stb-field">' +
      '  <label for="stb-new-password2">Repeat it</label>' +
      '  <input type="password" id="stb-new-password2" autocomplete="new-password" />' +
      "</div>" +
      '<button type="button" class="stb-login-submit" id="stb-new-password-save">Save new password</button>' +
      '<div class="stb-login-msg" id="stb-new-password-msg"></div>';
    host.appendChild(box);
    revealForm();

    var pw1 = document.getElementById("stb-new-password");
    var pw2 = document.getElementById("stb-new-password2");
    var saveBtn = document.getElementById("stb-new-password-save");
    var pmsg = document.getElementById("stb-new-password-msg");
    if (pw1) pw1.focus();

    saveBtn.addEventListener("click", function () {
      var a = pw1 ? pw1.value : "";
      var b = pw2 ? pw2.value : "";
      if (a.length < 8) { pmsg.textContent = "Use at least 8 characters."; return; }
      if (a !== b) { pmsg.textContent = "Those two don't match."; return; }
      saveBtn.disabled = true;
      pmsg.textContent = "Saving\u2026";
      STB.updatePassword(a).then(function (res) {
        if (res && res.error) {
          saveBtn.disabled = false;
          pmsg.textContent = res.error.message || "Couldn't save that password.";
          return;
        }
        pmsg.textContent = "Password changed \u2014 opening your board\u2026";
        setTimeout(function () { window.location.replace("app.html"); }, 900);
      }).catch(function (e) {
        saveBtn.disabled = false;
        pmsg.textContent = (e && e.message) || "Couldn't save that password just now.";
      });
    });
  }

  var claimForm = document.getElementById("stb-claim-form");
  var claimUsernameInput = document.getElementById("stb-claim-username");
  var claimUsernameHint = document.getElementById("stb-claim-username-hint");
  var claimMsg = document.getElementById("stb-claim-msg");
  var claimSignoutBtn = document.getElementById("stb-claim-signout-btn");
  var claimOk = false;
  var claimCheckTimer = null;
  var claimUserId = null; // set once we know a signed-in user needs a username

  function setMode(next) {
    mode = next;
    var isClaim = mode === "claim";
    if (tabs) tabs.style.display = isClaim ? "none" : "flex";
    tabSignin.classList.toggle("is-active", mode === "signin");
    tabSignup.classList.toggle("is-active", mode === "signup");
    fieldUsername.style.display = mode === "signup" ? "block" : "none";
    form.style.display = isClaim ? "none" : "block";
    claimForm.style.display = isClaim ? "block" : "none";
    if (isClaim) {
      heading.textContent = "Almost done";
      sub.textContent = "Pick a username to start your free trial.";
    } else {
      heading.textContent = mode === "signup" ? "Create your board" : "Welcome back";
      sub.textContent = mode === "signup" ? "Pick a username, then set your email and password." : "Sign in to sync your board across devices.";
    }
    submitBtn.textContent = mode === "signup" ? "Create account" : "Sign in";
    trialNote.style.display = mode === "signup" ? "block" : "none";
    msg.textContent = "";
  }
  tabSignin.addEventListener("click", function () { setMode("signin"); });
  tabSignup.addEventListener("click", function () { setMode("signup"); });
  var params = new URLSearchParams(window.location.search);
  setMode(params.get("signup") ? "signup" : "signin");

  // Shared "is this username free?" checker used by both the signup field and the
  // finish-setup (claim) field.
  function wireUsernameCheck(inputEl, hintEl, setTimer, getTimer, setOk) {
    inputEl.addEventListener("input", function () {
      setOk(false);
      var val = inputEl.value.trim();
      clearTimeout(getTimer());
      if (!val) {
        hintEl.textContent = "Shown instead of your email. 3-20 characters, letters/numbers/underscore, must be unique.";
        hintEl.className = "stb-field-hint";
        return;
      }
      hintEl.textContent = "Checking availability\u2026";
      hintEl.className = "stb-field-hint";
      setTimer(setTimeout(function () {
        STB.checkUsernameAvailable(val).then(function (res) {
          if (res.available) {
            setOk(true);
            hintEl.textContent = "Available.";
            hintEl.className = "stb-field-hint is-good";
          } else {
            setOk(false);
            hintEl.textContent = res.reason || "That username is taken.";
            hintEl.className = "stb-field-hint is-bad";
          }
        });
      }, 400));
    });
  }

  wireUsernameCheck(
    usernameInput, usernameHint,
    function (t) { usernameCheckTimer = t; }, function () { return usernameCheckTimer; },
    function (v) { usernameOk = v; }
  );
  wireUsernameCheck(
    claimUsernameInput, claimUsernameHint,
    function (t) { claimCheckTimer = t; }, function () { return claimCheckTimer; },
    function (v) { claimOk = v; }
  );

  claimForm.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!claimUserId) { claimMsg.textContent = "Something went wrong \u2014 please refresh and try again."; return; }
    var username = claimUsernameInput.value.trim();
    if (!username) { claimMsg.textContent = "Choose a username first."; return; }
    if (!claimOk) { claimMsg.textContent = "Pick a username that's available (see the hint above)."; return; }
    claimMsg.textContent = "Saving\u2026";
    STB.claimUsername(claimUserId, username).then(function () {
      try { window.localStorage.removeItem("stb_pending_username"); } catch (err) {}
      window.location.href = "app.html";
    }).catch(function (err) {
      claimMsg.textContent = (err && err.message) || "That username was just taken \u2014 try another.";
    });
  });

  claimSignoutBtn.addEventListener("click", function () {
    var c = STB.getClient();
    var go = c ? c.auth.signOut() : Promise.resolve();
    go.then(function () { window.location.href = "login.html"; });
  });

  document.getElementById("stb-forgot-btn").addEventListener("click", function () {
    var email = emailInput.value.trim();
    if (!email) { msg.textContent = "Enter your email above first, then click \u201cForgot password?\u201d again."; return; }
    msg.textContent = "Sending reset link\u2026";
    STB.sendPasswordReset(email).then(function (res) {
      msg.textContent = res.error ? res.error.message : "Check your email for a password reset link.";
    }).catch(function (e) { msg.textContent = (e && e.message) || "Something went wrong."; });
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!STB.isSyncAvailable()) { msg.textContent = "Sync isn't set up on this deployment yet."; return; }
    var email = emailInput.value.trim();
    var password = passwordInput.value;
    if (!email || !password) { msg.textContent = "Enter an email and password."; return; }

    if (mode === "signup") {
      // Supabase's own minimum defaults to 6. Asking for 8 here is deliberately stricter:
      // raise the project's minimum to match under Authentication -> Settings -> Password.
      if (password.length < 8) {
        msg.textContent = "Use at least 8 characters for your password.";
        return;
      }
      var username = usernameInput.value.trim();
      if (!username) { msg.textContent = "Choose a username first."; return; }
      if (!usernameOk) { msg.textContent = "Pick a username that's available (see the hint above)."; return; }
      msg.textContent = "Creating your account\u2026";
      STB.signUp(email, password, username).then(function (res) {
        if (res.error) { msg.textContent = res.error.message; return; }
        if (res.data && res.data.session) {
          window.location.href = "app.html";
        } else {
          msg.textContent = "Check your email to confirm your account, then sign in.";
        }
      }).catch(function (e2) { msg.textContent = (e2 && e2.message) || "Something went wrong."; });
      return;
    }

    msg.textContent = "Signing in\u2026";
    STB.signIn(email, password).then(function (res) {
      if (res.error) {
        var why = String(res.error.message || "");
        // Supabase's raw text for this is "Email not confirmed", which tells the person
        // nothing about what to do next. Say it plainly and offer to send it again.
        if (/email not confirmed/i.test(why)) {
          msg.innerHTML = "";
          var line = document.createElement("span");
          line.textContent = "Confirm your email first \u2014 open the link we sent, then sign in. ";

          var again = document.createElement("button");
          again.type = "button";
          again.textContent = "Resend it";
          again.style.cssText =
            "background:none;border:0;padding:0;margin-left:4px;font:inherit;color:inherit;" +
            "text-decoration:underline;cursor:pointer;";
          // Supabase's built-in sender allows 2 emails an hour for the whole project, and
          // returns 429 once that's gone. A cooldown stops people burning the allowance by
          // clicking twice and makes the limit visible instead of a silent failure.
          again.addEventListener("click", function () {
            if (again.disabled) return;
            if (typeof STB.resendConfirmation !== "function") {
              line.textContent = "Re-sending isn't available on this deployment.";
              return;
            }
            again.disabled = true;
            again.textContent = "Sending\u2026";
            STB.resendConfirmation(email)
              .then(function (r) {
                var err = r && r.error;
                if (err && /rate limit|too many|429/i.test(String(err.message || ""))) {
                  line.textContent = "Too many attempts \u2014 email sending is limited to a few an hour. Try again shortly.";
                  cooldown(again, 90);
                  return;
                }
                if (err) {
                  line.textContent = "Couldn't send it: " + err.message;
                  cooldown(again, 30);
                  return;
                }
                line.textContent = "Sent \u2014 check your inbox, and your spam folder.";
                cooldown(again, 45);
              })
              .catch(function () {
                line.textContent = "Couldn't send it right now. Try again in a minute.";
                cooldown(again, 30);
              });
          });

          msg.appendChild(line);
          msg.appendChild(again);
          return;
        }
        msg.textContent = why;
        return;
      }
      window.location.href = "app.html";
    }).catch(function (e3) { msg.textContent = (e3 && e3.message) || "Something went wrong."; });
  });

  // If someone's already signed in and lands here, send them to the board -- UNLESS
  // their account has no profile/username row yet, in which case app.html can't do
  // anything for them (it just links back here) and bouncing them to app.html would
  // loop forever. In that case, show the claim-username form right here instead.
  var configReady = STB.configReady && typeof STB.configReady.then === "function" ? STB.configReady : Promise.resolve();
  configReady.then(function () {
    // No accounts configured on this deployment (local dev, env vars missing): there is
    // nothing to check, so show the form straight away.
    if (!STB.isSyncAvailable()) { revealForm(); return; }
    var c = STB.getClient();
    c.auth.getSession().then(function (res) {
      var session = res.data && res.data.session;
      if (isRecoveryLink && session) { showRecoveryPanel(); return; }
      if (!session) { revealForm(); return; }
      return c.from("profiles").select("username").eq("user_id", session.user.id).maybeSingle().then(function (profRes) {
        if (profRes.data) {
          window.location.href = "app.html";
          return;
        }
        // Signed in, no profile yet: this is exactly the case login.html?step=username
        // is meant to handle. Let them claim a username here instead of bouncing back
        // to app.html (whose banner just links back to this same page).
        claimUserId = session.user.id;
        var pending = null;
        try { pending = window.localStorage.getItem("stb_pending_username"); } catch (e) {}
        var meta = session.user && session.user.user_metadata;
        if (!pending && meta && typeof meta.username === "string") pending = meta.username.trim();
        if (pending) claimUsernameInput.value = pending;
        setMode("claim");
        revealForm();
        if (pending) claimUsernameInput.dispatchEvent(new Event("input"));
      });
    }).catch(function (e) {
      // A failed check must not lock anyone out of the sign-in form.
      console.error("Could not check session/profile", e);
      revealForm();
    });
  });
})();
