(function (STB) {
  "use strict";

  var client = null;
  var currentUser = null;
  var currentProfile = null; // { username, trial_ends_at, is_paid } or null
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
  STB.getClient = getClient;
  STB.getCurrentUser = function () { return currentUser; };
  STB.getCurrentProfile = function () { return currentProfile; };

  // ---------- trial status, derived from the profile row ----------
  // Reads are always allowed by the database; writes are blocked server-side (RLS) once
  // the trial has expired and the account isn't marked paid. This mirrors that client-side
  // so the UI can show a banner and disable inputs instead of writes silently failing.
  STB.getTrialStatus = function () {
    if (!currentProfile) {
      return { known: false, expired: false, daysLeft: null, isPaid: false };
    }
    if (currentProfile.is_paid) {
      return { known: true, expired: false, daysLeft: null, isPaid: true };
    }
    var msLeft = new Date(currentProfile.trial_ends_at).getTime() - Date.now();
    var daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));
    return { known: true, expired: msLeft <= 0, daysLeft: Math.max(daysLeft, 0), isPaid: false };
  };

  // ---------- username availability + claiming ----------
  STB.checkUsernameAvailable = function (username) {
    var c = getClient();
    if (!c) return Promise.resolve(false);
    var normalized = String(username || "").trim().toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(normalized)) {
      return Promise.resolve({ available: false, reason: "3-20 characters: letters, numbers, underscore only." });
    }
    return c.from("usernames").select("username_lower").eq("username_lower", normalized).maybeSingle().then(function (res) {
      if (res.error) return { available: false, reason: "Couldn't check that right now." };
      return { available: !res.data, reason: res.data ? "That username is taken." : null };
    });
  };

  function claimUsernameAndStartTrial(userId, username) {
    var c = getClient();
    var normalized = username.trim();
    var lower = normalized.toLowerCase();
    return c.from("usernames").insert({ username_lower: lower, username: normalized, user_id: userId }).then(function (res) {
      if (res.error) throw res.error;
      var trialEnds = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      return c.from("profiles").insert({ user_id: userId, username: normalized, trial_ends_at: trialEnds }).select().single();
    }).then(function (res) {
      if (res.error) throw res.error;
      currentProfile = res.data;
      return currentProfile;
    });
  }
  STB.claimUsername = claimUsernameAndStartTrial;

  function fetchProfile(userId) {
    var c = getClient();
    return c.from("profiles").select("username, trial_ends_at, is_paid").eq("user_id", userId).maybeSingle().then(function (res) {
      if (res.error) throw res.error;
      currentProfile = res.data || null;
      return currentProfile;
    });
  }

  // ---------- auth ----------
  // email/password stay the sign-in credential (Supabase requires one), but the email is
  // never shown anywhere in the app UI -- only the username chosen at signup is displayed.
  STB.signUp = function (email, password, username) {
    var c = getClient();
    if (!c) return Promise.reject(new Error("Sync isn't set up yet."));
    // Stashed so afterSignedIn can claim it once a session exists -- which may be
    // immediately, or only after the user confirms their email, depending on project settings.
    try { window.localStorage.setItem("stb_pending_username", username || ""); } catch (e) {}
    return c.auth.signUp({
      email: email,
      password: password,
      options: { emailRedirectTo: window.location.origin + "/app.html" },
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
    currentProfile = null;
    inRecoveryMode = false;
    STB.renderAuthUI();
    if (!c) return Promise.resolve();
    return c.auth.signOut();
  };

  STB.sendPasswordReset = function (email) {
    var c = getClient();
    if (!c) return Promise.reject(new Error("Sync isn't set up yet."));
    return c.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + "/login.html" });
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
    fetchProfile(user.id)
      .then(function (profile) {
        if (profile) return profile;
        // No profile yet -- either this is their very first sign-in after confirming
        // email (claim the username they picked at signup time), or something went
        // wrong and they need to be prompted to pick one on app.html.
        var pending = null;
        try { pending = window.localStorage.getItem("stb_pending_username"); } catch (e) {}
        if (pending) {
          try { window.localStorage.removeItem("stb_pending_username"); } catch (e) {}
          return claimUsernameAndStartTrial(user.id, pending);
        }
        return null;
      })
      .catch(function (e) { console.error("Could not load profile", e); })
      .then(function () {
        STB.renderAuthUI();
        return pullFromCloud(user.id);
      })
      .then(function (cloudData) {
        if (cloudData) {
          STB.state = STB.normalizeAndRollover(cloudData);
        } else {
          // First time this account has synced: seed the cloud with whatever's here now
          // (e.g. notes made before this sign-in), rather than losing them.
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

  // Resolves once the initial session check is done: true if signed in, false if not.
  // Ongoing changes (sign in/out in another tab, password recovery links) are still
  // handled live via onAuthStateChange.
  STB.initSync = function () {
    var c = getClient();
    if (!c) { STB.renderAuthUI(); return Promise.resolve(false); }
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
        currentProfile = null;
        inRecoveryMode = false;
        stopRealtime();
        STB.renderAuthUI();
      }
    });
    return c.auth.getSession().then(function (res) {
      var session = res.data && res.data.session;
      if (session && session.user) {
        afterSignedIn(session.user);
        return true;
      }
      STB.renderAuthUI();
      return false;
    });
  };

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

  // Disables note-editing controls once the trial has expired (or the account has no
  // username/profile yet). This is a UX convenience only -- the real enforcement is the
  // "trial_active" row-level security policy on the boards table, which blocks writes
  // at the database no matter what the client does.
  function applyLockState(locked, needsUsername) {
    var board = document.getElementById("stb-board");
    var clipboard = document.getElementById("stb-clipboard");
    var addBtn = document.getElementById("stb-add-btn");
    var addDocBtn = document.getElementById("stb-add-doc-btn");
    var banner = document.getElementById("stb-readonly-banner");
    [board, clipboard].forEach(function (elm) {
      if (!elm) return;
      elm.classList.toggle("stb-locked", !!locked);
    });
    [addBtn, addDocBtn].forEach(function (btn) {
      if (!btn) return;
      btn.disabled = !!locked;
      btn.style.opacity = locked ? "0.5" : "";
      btn.style.pointerEvents = locked ? "none" : "";
    });
    if (banner) {
      if (needsUsername) {
        banner.innerHTML = "Almost done \u2014 <a href=\"login.html?step=username\">choose a username</a> to start your free trial.";
        banner.classList.add("is-visible");
      } else if (locked) {
        banner.innerHTML = "Your free trial has ended. The board is view-only until you upgrade.";
        banner.classList.add("is-visible");
      } else {
        banner.classList.remove("is-visible");
      }
    }
  }

  // Minimal header widget for app.html: shows the username + trial status + sign out.
  // The actual sign-in/sign-up forms live on the dedicated login.html page now.
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
      var trial = STB.getTrialStatus();
      var trialHtml = "";
      var locked = false;
      if (!currentProfile) {
        trialHtml = '<span class="stb-trial-badge stb-trial-badge--needsname">Finish setup: choose a username</span>';
        locked = true;
      } else if (trial.isPaid) {
        trialHtml = '<span class="stb-trial-badge">Full access</span>';
      } else if (trial.expired) {
        trialHtml = '<span class="stb-trial-badge stb-trial-badge--expired">Trial ended \u00b7 view only</span>';
        locked = true;
      } else {
        trialHtml = '<span class="stb-trial-badge">' + trial.daysLeft + " day" + (trial.daysLeft === 1 ? "" : "s") + " left in trial</span>";
      }
      el.innerHTML =
        '<span class="stb-auth-email">' + STB.escapeAttr(currentProfile ? currentProfile.username : currentUser.email.split("@")[0]) + " \u00b7 synced</span>" +
        trialHtml +
        '<button class="stb-auth-signout" id="stb-signout-btn">Sign out</button>';
      document.getElementById("stb-signout-btn").addEventListener("click", function () { STB.signOut(); });
      applyLockState(locked, !currentProfile);
      return;
    }

    // Not signed in and sync is configured: this page requires an account, so send them
    // to the dedicated login page rather than showing an inline form.
    window.location.href = "login.html";
  };
})(window.STB = window.STB || {});
