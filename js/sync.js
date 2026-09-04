(function (STB) {
  "use strict";

  var client = null;
  var currentUser = null;
  var pushTimeout = null;
  var applyingRemoteUpdate = false;
  var realtimeChannel = null;
  var inRecoveryMode = false;

  function isConfigured() {
    return !!(
      window.STB_SUPABASE_URL &&
      window.STB_SUPABASE_ANON_KEY &&
      typeof window.supabase !== "undefined" &&
      typeof window.supabase.createClient === "function"
    );
  }

  function getClient() {
    if (!isConfigured()) return null;
    if (!client) client = window.supabase.createClient(window.STB_SUPABASE_URL, window.STB_SUPABASE_ANON_KEY);
    return client;
  }

  STB.isSyncAvailable = isConfigured;
  STB.getCurrentUser = function () { return currentUser; };

  STB.signUp = function (email, password) {
    var c = getClient();
    if (!c) return Promise.reject(new Error("Sync isn't set up yet."));
    return c.auth.signUp({
      email: email,
      password: password,
      // Without this, Supabase falls back to the dashboard's "Site URL" setting
      // (which defaults to localhost:3000) for the confirmation link -- explicitly
      // pointing it at wherever this page is actually loaded keeps it correct
      // whether that's your Vercel URL or a local dev server, without needing to
      // remember to update the dashboard every time.
      options: { emailRedirectTo: window.location.origin },
    });
  };

  STB.signIn = function (email, password) {
    var c = getClient();
    if (!c) return Promise.reject(new Error("Sync isn't set up yet."));
    return c.auth.signInWithPassword({ email: email, password: password });
  };

  STB.signOut = function () {
    var c = getClient();
    stopRealtime();
    currentUser = null;
    inRecoveryMode = false;
    STB.renderAuthUI();
    if (!c) return Promise.resolve();
    return c.auth.signOut();
  };

  STB.sendPasswordReset = function (email) {
    var c = getClient();
    if (!c) return Promise.reject(new Error("Sync isn't set up yet."));
    return c.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname });
  };

  STB.updatePassword = function (newPassword) {
    var c = getClient();
    if (!c) return Promise.reject(new Error("Sync isn't set up yet."));
    return c.auth.updateUser({ password: newPassword }).then(function (res) {
      if (!res.error) {
        inRecoveryMode = false;
        STB.renderAuthUI();
      }
      return res;
    });
  };

  function stopRealtime() {
    var c = getClient();
    if (c && realtimeChannel) { c.removeChannel(realtimeChannel); realtimeChannel = null; }
  }

  function startRealtime(userId) {
    var c = getClient();
    if (!c) return;
    stopRealtime();
    realtimeChannel = c
      .channel("boards-" + userId)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "boards", filter: "user_id=eq." + userId },
        function (payload) {
          if (!payload.new || !payload.new.data) return;
          applyingRemoteUpdate = true;
          STB.state = STB.normalizeAndRollover(payload.new.data);
          STB.saveState();
          STB.render();
          applyingRemoteUpdate = false;
        }
      )
      .subscribe();
  }

  function pullFromCloud(userId) {
    var c = getClient();
    return c
      .from("boards")
      .select("data")
      .eq("user_id", userId)
      .maybeSingle()
      .then(function (res) {
        if (res.error) throw res.error;
        return res.data ? res.data.data : null;
      });
  }

  function pushToCloud() {
    var c = getClient();
    if (!c || !currentUser) return;
    c.from("boards")
      .upsert({ user_id: currentUser.id, data: STB.state, updated_at: new Date().toISOString() })
      .then(function (res) {
        if (res.error) console.error("Sync push failed", res.error);
      });
  }

  STB.syncPush = function () {
    if (!currentUser || applyingRemoteUpdate) return;
    clearTimeout(pushTimeout);
    pushTimeout = setTimeout(pushToCloud, 1200);
  };

  function afterSignedIn(user) {
    currentUser = user;
    STB.renderAuthUI();
    pullFromCloud(user.id)
      .then(function (cloudData) {
        if (cloudData) {
          STB.state = STB.normalizeAndRollover(cloudData);
        } else {
          // First time this account has synced: seed the cloud with whatever's here now
          // (e.g. guest notes made before creating an account), rather than losing them.
          pushToCloud();
        }
        STB.saveState();
        STB.render();
        startRealtime(user.id);
      })
      .catch(function (e) {
        console.error("Could not load your synced board", e);
      });
  }

  STB.initSync = function () {
    var c = getClient();
    if (!c) { STB.renderAuthUI(); return; }
    c.auth.getSession().then(function (res) {
      var session = res.data && res.data.session;
      if (session && session.user) afterSignedIn(session.user);
      else STB.renderAuthUI();
    });
    c.auth.onAuthStateChange(function (event, session) {
      if (event === "PASSWORD_RECOVERY") {
        inRecoveryMode = true;
        STB.renderAuthUI();
        return;
      }
      if (event === "SIGNED_IN" && session && session.user && (!currentUser || currentUser.id !== session.user.id)) {
        afterSignedIn(session.user);
      } else if (event === "SIGNED_OUT") {
        currentUser = null;
        inRecoveryMode = false;
        stopRealtime();
        STB.renderAuthUI();
      }
    });
  };

  // ---- minimal inline auth UI ----
  function submitAuth(mode) {
    var email = document.getElementById("stb-auth-email").value.trim();
    var password = document.getElementById("stb-auth-password").value;
    var msg = document.getElementById("stb-auth-msg");
    if (!email || !password) { msg.textContent = "Enter an email and password."; return; }
    msg.textContent = "Working\u2026";
    var action = mode === "signin" ? STB.signIn(email, password) : STB.signUp(email, password);
    action.then(function (res) {
      if (res.error) { msg.textContent = res.error.message; return; }
      if (mode === "signup" && res.data && !res.data.session) {
        msg.textContent = "Check your email to confirm your account, then sign in.";
      }
    }).catch(function (e) {
      msg.textContent = (e && e.message) || "Something went wrong.";
    });
  }

  function submitForgotPassword() {
    var email = document.getElementById("stb-auth-email").value.trim();
    var msg = document.getElementById("stb-auth-msg");
    if (!email) { msg.textContent = "Enter your email above first, then click \"Forgot password?\" again."; return; }
    msg.textContent = "Sending reset link\u2026";
    STB.sendPasswordReset(email).then(function (res) {
      msg.textContent = res.error ? res.error.message : "Check your email for a password reset link.";
    }).catch(function (e) {
      msg.textContent = (e && e.message) || "Something went wrong.";
    });
  }

  function submitNewPassword() {
    var password = document.getElementById("stb-recovery-password").value;
    var msg = document.getElementById("stb-recovery-msg");
    if (!password || password.length < 6) { msg.textContent = "Choose a password with at least 6 characters."; return; }
    msg.textContent = "Saving\u2026";
    STB.updatePassword(password).then(function (res) {
      msg.textContent = res.error ? res.error.message : "Password updated.";
    }).catch(function (e) {
      msg.textContent = (e && e.message) || "Something went wrong.";
    });
  }

  STB.renderAuthUI = function () {
    var el = document.getElementById("stb-auth");
    if (!el) return;

    if (!STB.isSyncAvailable()) {
      el.innerHTML = '<span class="stb-auth-guest" title="Add your Supabase project details to enable accounts and sync">Guest \u00b7 not synced</span>';
      return;
    }

    if (inRecoveryMode) {
      el.innerHTML =
        '<span class="stb-auth-email">Choose a new password</span>' +
        '<div class="stb-auth-form" style="display:flex;">' +
        '<input type="password" id="stb-recovery-password" placeholder="New password" autocomplete="new-password" />' +
        '<button id="stb-recovery-save-btn">Save password</button>' +
        '<span class="stb-auth-msg" id="stb-recovery-msg"></span>' +
        "</div>";
      document.getElementById("stb-recovery-save-btn").addEventListener("click", submitNewPassword);
      return;
    }

    if (currentUser) {
      el.innerHTML =
        '<span class="stb-auth-email">' + STB.escapeAttr(currentUser.email) + " \u00b7 synced</span>" +
        '<button class="stb-auth-signout" id="stb-signout-btn">Sign out</button>';
      document.getElementById("stb-signout-btn").addEventListener("click", function () { STB.signOut(); });
      return;
    }

    el.innerHTML =
      '<span class="stb-auth-guest">Guest \u00b7 not synced</span>' +
      '<button class="stb-auth-toggle" id="stb-auth-toggle-btn">Sign in / Sign up</button>' +
      '<div class="stb-auth-form" id="stb-auth-form">' +
      '<input type="email" id="stb-auth-email" placeholder="Email" autocomplete="email" />' +
      '<input type="password" id="stb-auth-password" placeholder="Password" autocomplete="current-password" />' +
      '<button id="stb-auth-signin-btn">Sign in</button>' +
      '<button id="stb-auth-signup-btn">Create account</button>' +
      '<button class="stb-auth-link" id="stb-auth-forgot-btn" type="button">Forgot password?</button>' +
      '<span class="stb-auth-msg" id="stb-auth-msg"></span>' +
      "</div>";
    var form = document.getElementById("stb-auth-form");
    form.style.display = "none";
    document.getElementById("stb-auth-toggle-btn").addEventListener("click", function () {
      form.style.display = form.style.display === "none" ? "flex" : "none";
    });
    document.getElementById("stb-auth-signin-btn").addEventListener("click", function () { submitAuth("signin"); });
    document.getElementById("stb-auth-signup-btn").addEventListener("click", function () { submitAuth("signup"); });
    document.getElementById("stb-auth-forgot-btn").addEventListener("click", submitForgotPassword);
  };
})(window.STB = window.STB || {});
