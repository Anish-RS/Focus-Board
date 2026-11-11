(function () {
  "use strict";
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
  var emailInput = document.getElementById("stb-email");
  var passwordInput = document.getElementById("stb-password");
  var submitBtn = document.getElementById("stb-submit-btn");
  var msg = document.getElementById("stb-login-msg");
  var form = document.getElementById("stb-login-form");
  var trialNote = document.getElementById("stb-trial-note");

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
      if (res.error) { msg.textContent = res.error.message; return; }
      window.location.href = "app.html";
    }).catch(function (e3) { msg.textContent = (e3 && e3.message) || "Something went wrong."; });
  });

  // If someone's already signed in and lands here, send them to the board -- UNLESS
  // their account has no profile/username row yet, in which case app.html can't do
  // anything for them (it just links back here) and bouncing them to app.html would
  // loop forever. In that case, show the claim-username form right here instead.
  var configReady = STB.configReady && typeof STB.configReady.then === "function" ? STB.configReady : Promise.resolve();
  configReady.then(function () {
    if (!STB.isSyncAvailable()) return;
    var c = STB.getClient();
    c.auth.getSession().then(function (res) {
      var session = res.data && res.data.session;
      if (!session) return;
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
        if (pending) claimUsernameInput.value = pending;
        setMode("claim");
        if (pending) claimUsernameInput.dispatchEvent(new Event("input"));
      });
    }).catch(function (e) {
      console.error("Could not check session/profile", e);
    });
  });
})();
