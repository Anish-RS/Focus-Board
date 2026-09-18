(function (STB) {
  "use strict";

  var client = null;
  var currentUser = null;
  var currentProfile = null; // { username, trial_ends_at, is_paid } or null
  // True only when we tried to load the profile and the request itself failed (network
  // blip, Supabase cold start, brief RLS/session hiccup) -- as opposed to currentProfile
  // being null because the account genuinely has no profile row yet. Conflating those two
  // used to show already-registered users the "choose a username" prompt on a transient
  // error, which risked them claiming a second username or thinking their account was
  // wiped. See renderAuthUI/applyLockState below for how this is used.
  var profileLoadFailed = false;
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

  // Exposed so js/state.js can stamp which account's data currently lives in
  // localStorage (see STB.saveState / STB.clearLocalBoard in state.js) without state.js
  // needing to know anything about how auth is implemented.
  STB.getCurrentUserId = function () {
    return currentUser ? currentUser.id : null;
  };

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
      return { known: false, expired: false, daysLeft: null, isPaid: false, renewsInDays: null };
    }
    if (currentProfile.is_paid) {
      // renewsInDays counts down to paid_until -- the end of the cycle already paid for.
      // It keeps counting down the same way whether auto-renew is still on or was
      // cancelled; see razorpay-webhook.js/reconcile-payments.js for why that's correct.
      var renewsInDays = null;
      if (currentProfile.paid_until) {
        var msLeftPaid = new Date(currentProfile.paid_until).getTime() - Date.now();
        renewsInDays = Math.max(Math.ceil(msLeftPaid / (1000 * 60 * 60 * 24)), 0);
      }
      return { known: true, expired: false, daysLeft: null, isPaid: true, renewsInDays: renewsInDays };
    }
    var msLeft = new Date(currentProfile.trial_ends_at).getTime() - Date.now();
    var daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));
    return { known: true, expired: msLeft <= 0, daysLeft: Math.max(daysLeft, 0), isPaid: false, renewsInDays: null };
  };

  // Shared label for every "Upgrade" button/banner so the native-currency estimate (once
  // currency.js has one) shows up everywhere consistently, without repeating the string.
  function upgradeLabel() {
    var suffix = (typeof STB.getPriceSuffix === "function") ? STB.getPriceSuffix() : "";
    return "Upgrade \u00b7 \u20b9" + STB.PRICE_INR + "/mo" + suffix;
  }
  STB.PRICE_INR = STB.PRICE_INR || 249; // currency.js also sets this; kept here too in case it isn't loaded on a page

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

  // Claims a username and creates the trial profile row. Written to be safe to call more
  // than once for the same account, because it used to fail permanently after a partial
  // success: if the username insert succeeded but the profile insert then failed for any
  // reason, every retry re-attempted the username insert, which now conflicted forever
  // (an account can only have one username row) -- so the retry could never reach the
  // step that was actually still missing. Now it checks what this account already has
  // before inserting anything, so it can always pick up wherever a previous attempt left
  // off and finish the job, rather than looping on the same conflict indefinitely.
  function claimUsernameAndStartTrial(userId, username) {
    var c = getClient();
    var normalized = username.trim();
    var lower = normalized.toLowerCase();
    return c.from("usernames").select("username").eq("user_id", userId).maybeSingle()
      .then(function (existingRes) {
        if (existingRes.error) throw existingRes.error;
        if (existingRes.data) {
          // This account already claimed a username in an earlier attempt -- use it
          // rather than trying to insert a second row (which would always conflict).
          return existingRes.data.username;
        }
        return c.from("usernames").insert({ username_lower: lower, username: normalized, user_id: userId }).then(function (res) {
          if (res.error) throw res.error; // a genuine "someone else already has this exact username" still surfaces normally here
          return normalized;
        });
      })
      .then(function (claimedUsername) {
        var trialEnds = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        return c.from("profiles").insert({ user_id: userId, username: claimedUsername, trial_ends_at: trialEnds }).select().single()
          .then(function (res) {
            if (!res.error) return res.data;
            // A profile row already exists for this account (the username step above
            // resumed from a prior attempt, and it turns out the profile was actually
            // created too). Fetch and use it as-is -- inserting again would just fail,
            // and upserting would risk overwriting real trial/payment status that's
            // already in progress.
            return c.from("profiles").select("*").eq("user_id", userId).single().then(function (fetchRes) {
              if (fetchRes.error) throw fetchRes.error;
              return fetchRes.data;
            });
          });
      })
      .then(function (profile) {
        currentProfile = profile;
        return currentProfile;
      });
  }
  STB.claimUsername = claimUsernameAndStartTrial;

  // Opens Razorpay's in-page checkout widget for the signed-in user. The server creates
  // the subscription and verifies who the user is from their session token -- nothing
  // about which account gets upgraded is decided client-side. Resolves once the payment
  // is made AND verified server-side (via /api/verify-razorpay-payment); the caller is
  // expected to refresh the UI/reload once this resolves.
  STB.startCheckout = function () {
    var c = getClient();
    if (!c || !currentUser) return Promise.reject(new Error("Sign in first."));
    var token;
    return c.auth.getSession().then(function (res) {
      token = res.data && res.data.session && res.data.session.access_token;
      if (!token) throw new Error("Your session has expired -- sign in again.");
      return fetch("/api/create-subscription", {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
      });
    }).then(function (r) { return r.json(); }).then(function (body) {
      if (body.error) throw new Error(body.error);
      if (typeof window.Razorpay === "undefined") {
        throw new Error("Payment widget failed to load -- check your connection and try again.");
      }
      return new Promise(function (resolve, reject) {
        var rzp = new window.Razorpay({
          key: body.key_id,
          subscription_id: body.subscription_id,
          name: "Focus Board",
          description: "Focus Board Pro \u2014 \u20b9249/month",
          theme: { color: "#2B2620" },
          handler: function (response) {
            fetch("/api/verify-razorpay-payment", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
              body: JSON.stringify(response),
            })
              .then(function (r2) { return r2.json(); })
              .then(function (verifyBody) {
                if (verifyBody.error) { reject(new Error(verifyBody.error)); return; }
                resolve(verifyBody);
              })
              .catch(reject);
          },
          modal: {
            ondismiss: function () { reject(new Error("Checkout closed before completing payment.")); },
          },
        });
        rzp.open();
      });
    });
  };

  function fetchProfile(userId) {
    var c = getClient();
    return c.from("profiles").select("username, trial_ends_at, is_paid, paid_until").eq("user_id", userId).maybeSingle().then(function (res) {
      if (res.error) throw res.error;
      currentProfile = res.data || null;
      return currentProfile;
    });
  }

  // Retries a couple of times with a short delay before giving up -- smooths over the
  // transient hiccups (a slow cold start, a dropped request) that used to get misread as
  // "no profile exists yet" after a single failed attempt.
  function fetchProfileWithRetry(userId, attemptsLeft) {
    attemptsLeft = typeof attemptsLeft === "number" ? attemptsLeft : 2;
    return fetchProfile(userId).catch(function (e) {
      if (attemptsLeft <= 0) throw e;
      return new Promise(function (resolve) { setTimeout(resolve, 700); }).then(function () {
        return fetchProfileWithRetry(userId, attemptsLeft - 1);
      });
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
    if (!c) return Promise.resolve();
    // Deliberately does nothing else here -- no clearing local state, no rendering, no
    // navigating. All of that now happens exactly once, in the SIGNED_OUT handler in
    // initSync below, and only once Supabase confirms the session is actually gone.
    // Doing it here too (as before) meant the app started navigating to login.html while
    // this very request was still in flight, which could get the request aborted
    // mid-navigation -- leaving a half-cleared session that made the next page load bounce
    // right back in, and made "Sign out" look like it needed several tries.
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
    profileLoadFailed = false;
    return fetchProfileWithRetry(user.id)
      .then(function (profile) {
        if (profile) return profile;
        // No profile yet -- either this is their very first sign-in after confirming
        // email (claim the username they picked at signup time), or something went
        // wrong and they need to be prompted to pick one on app.html.
        var pending = null;
        try { pending = window.localStorage.getItem("stb_pending_username"); } catch (e) {}
        if (pending) {
          // Only clear the pending flag once the claim actually succeeds. Clearing it
          // first (as before) meant a failed claim -- taken username, network blip,
          // RLS hiccup -- silently threw away the only record of what to try, leaving
          // the account stuck in "needs username" forever with nothing to retry.
          return claimUsernameAndStartTrial(user.id, pending).then(function (profile) {
            try { window.localStorage.removeItem("stb_pending_username"); } catch (e2) {}
            return profile;
          });
        }
        return null;
      })
      .catch(function (e) {
        console.error("Could not load profile", e);
        // Genuinely couldn't tell whether a profile exists -- do NOT fall through to the
        // "needs username" state. currentProfile is left as-is (still whatever it was
        // before this attempt, normally null on a fresh sign-in); profileLoadFailed is
        // what tells renderAuthUI to show a "couldn't load, retry" state instead of
        // wrongly asking an existing user to pick a username again.
        profileLoadFailed = true;
      })
      .then(function () {
        STB.renderAuthUI();
        return pullFromCloud(user.id);
      })
      .then(function (cloudData) {
        if (cloudData) {
          STB.state = STB.normalizeAndRollover(cloudData);
        } else {
          // This account has no cloud board yet. Before treating whatever's sitting in
          // localStorage as "this account's notes, ready to upload," check who it
          // actually belongs to -- localStorage survives across sign-outs/sign-ins in the
          // same browser, so without this check, Account A's leftover notes could get
          // copied straight into Account B's brand-new board the moment Account B signs
          // in (bug: same-browser local notes leaking into a new account).
          var localOwner = null;
          try { localOwner = window.localStorage.getItem(STB.STORAGE_OWNER_KEY); } catch (e) {}
          var localBoardIsThisAccounts = !localOwner || localOwner === user.id;
          if (localBoardIsThisAccounts) {
            // Safe to use whatever's in localStorage as-is (a guest's pre-signup notes,
            // or genuinely this account's own board continuing) -- STB.state was never
            // actually loaded from there in this flow before now, so without this it
            // stayed null all the way to STB.render(), which crashed trying to read a
            // null board (and pushToCloud() below would have pushed that null too).
            STB.state = STB.loadOrInitState();
          } else {
            // Belongs to a different account (most likely one that closed the tab
            // instead of signing out, so SIGNED_OUT's cleanup never ran). Start this
            // account clean rather than adopting someone else's notes.
            STB.state = STB.freshState();
          }
          // Either it's unowned (a guest's pre-signup notes, or already this account's)
          // or we just reset it to fresh above -- either way it's now safe to seed the
          // cloud with whatever STB.state holds.
          pushToCloud();
        }
        STB.saveState(); // also re-stamps local ownership to this user's id (see state.js)
        STB.render();
        startRealtime(user.id);
      })
      .catch(function (e) {
        console.error("Could not load your synced board", e);
        // Whatever failed above -- most likely pullFromCloud, on the same kind of
        // transient blip that can also fail the profile fetch -- must never leave
        // STB.state unset. app.js's initBoard() assumes it's already set by the time it
        // runs and will crash trying to render a null board, showing a "something went
        // wrong" message that a Retry click on the account banner alone couldn't fix
        // (that button only re-checked the profile, never the board). Fall back to
        // whatever's safely available locally -- still respecting the same ownership
        // check as above -- so the board always renders with something, even when this
        // account's latest cloud data couldn't be fetched just now.
        if (!STB.state) {
          var fallbackOwner = null;
          try { fallbackOwner = window.localStorage.getItem(STB.STORAGE_OWNER_KEY); } catch (e2) {}
          STB.state = (!fallbackOwner || fallbackOwner === user.id) ? STB.loadOrInitState() : STB.freshState();
        }
        try { STB.render(); } catch (renderErr) { console.error("Board still failed to render", renderErr); }
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
        // Wipe the local board now, not just in memory: leaving this account's notes in
        // localStorage is exactly what let them leak into the next account signed into on
        // this same browser (see afterSignedIn below for the full mechanism). Once signed
        // out, the cloud is the only source of truth for this account's data -- signing
        // back in later pulls it fresh from there anyway.
        if (STB.clearLocalBoard) STB.clearLocalBoard();
        // This is now the ONLY place that navigates away from app.html for being signed
        // out -- whether that's from STB.signOut() actually completing, a token refresh
        // failing, or another tab signing out. It only runs once Supabase has genuinely
        // confirmed there's no session, and it runs from exactly one place instead of as
        // a side effect buried inside renderAuthUI (which used to fire unpredictably from
        // any of its many callers -- the retry button, the upgrade button, password
        // recovery -- any time currentUser happened to be falsy).
        window.location.href = "login.html";
      }
    });
    return c.auth.getSession().then(function (res) {
      var session = res.data && res.data.session;
      if (session && session.user) {
        // Wait for afterSignedIn's full chain (profile + cloud pull/seed) to finish before
        // telling app.js it's safe to initialize the board. app.js used to call initBoard()
        // (which reads localStorage directly) as soon as this resolved, racing against
        // afterSignedIn still running in the background -- that race was the other half of
        // the same-browser local-notes-leaking-into-a-new-account bug: initBoard() could
        // clobber the correctly-loaded cloud state with a stale local read, or run before
        // the ownership check above ever had a chance to reset it.
        return afterSignedIn(session.user).then(function () { return true; });
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
  function applyLockState(locked, reason) {
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
      if (reason === "load_failed") {
        banner.innerHTML = "Couldn't load your account just now \u2014 this is usually temporary. Your board is safe; try refreshing the page in a moment.";
        banner.classList.add("is-visible");
      } else if (reason === "needs_username") {
        banner.innerHTML = "Almost done \u2014 <a href=\"login.html?step=username\">choose a username</a> to start your free trial.";
        banner.classList.add("is-visible");
      } else if (locked) {
        banner.innerHTML = 'Your free trial has ended. The board is view-only until you upgrade. <button class="stb-upgrade-btn stb-upgrade-btn--banner" id="stb-banner-upgrade-btn">' + upgradeLabel() + '</button>';
        banner.classList.add("is-visible");
        var bannerBtn = document.getElementById("stb-banner-upgrade-btn");
        if (bannerBtn) {
          bannerBtn.addEventListener("click", function () {
            bannerBtn.disabled = true;
            bannerBtn.textContent = "Opening checkout\u2026";
            STB.startCheckout().then(function () {
              window.location.reload();
            }).catch(function (e) {
              bannerBtn.disabled = false;
              bannerBtn.textContent = upgradeLabel();
              alert((e && e.message) || "Could not start checkout.");
            });
          });
        }
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
      var upgradeHtml = "";
      var locked = false;
      var reason = null;
      if (profileLoadFailed) {
        // A fetch failure, not a confirmed "no profile" -- see the comment on
        // profileLoadFailed above. Offer a retry instead of the "choose a username"
        // prompt, which would be wrong (and confusing) for an already-registered user.
        trialHtml = '<span class="stb-trial-badge stb-trial-badge--expired">Couldn\u2019t load your account</span>';
        upgradeHtml = '<button class="stb-upgrade-btn" id="stb-retry-profile-btn">Retry</button>';
        locked = true;
        reason = "load_failed";
      } else if (!currentProfile) {
        trialHtml = '<span class="stb-trial-badge stb-trial-badge--needsname">Finish setup: choose a username</span>';
        locked = true;
        reason = "needs_username";
      } else if (trial.isPaid) {
        trialHtml = trial.renewsInDays != null
          ? '<span class="stb-trial-badge">Full access \u00b7 ' + trial.renewsInDays + " day" + (trial.renewsInDays === 1 ? "" : "s") + " left</span>"
          : '<span class="stb-trial-badge">Full access</span>';
      } else if (trial.expired) {
        trialHtml = '<span class="stb-trial-badge stb-trial-badge--expired">Trial ended \u00b7 view only</span>';
        locked = true;
        upgradeHtml = '<button class="stb-upgrade-btn" id="stb-upgrade-btn">' + upgradeLabel() + '</button>';
      } else {
        trialHtml = '<span class="stb-trial-badge">' + trial.daysLeft + " day" + (trial.daysLeft === 1 ? "" : "s") + " left in trial</span>";
        upgradeHtml = '<button class="stb-upgrade-btn" id="stb-upgrade-btn">' + upgradeLabel() + '</button>';
      }
      // Only fall back to the email-derived name when we've genuinely confirmed there's
      // no profile yet -- showing it during a load failure is exactly what made a
      // returning user's own account look unfamiliar ("roysing90s" instead of "roysing").
      var displayName = currentProfile
        ? currentProfile.username
        : (profileLoadFailed ? "Account" : currentUser.email.split("@")[0]);
      el.innerHTML =
        '<span class="stb-auth-email">' + STB.escapeAttr(displayName) + " \u00b7 synced</span>" +
        trialHtml +
        upgradeHtml +
        '<button class="stb-auth-signout" id="stb-signout-btn">Sign out</button>';
      document.getElementById("stb-signout-btn").addEventListener("click", function () { STB.signOut(); });
      var upgradeBtn = document.getElementById("stb-upgrade-btn");
      if (upgradeBtn) {
        upgradeBtn.addEventListener("click", function () {
          upgradeBtn.disabled = true;
          upgradeBtn.textContent = "Opening checkout\u2026";
          STB.startCheckout().then(function () {
            window.location.reload();
          }).catch(function (e) {
            upgradeBtn.disabled = false;
            upgradeBtn.textContent = upgradeLabel();
            alert((e && e.message) || "Could not start checkout.");
          });
        });
      }
      var retryBtn = document.getElementById("stb-retry-profile-btn");
      if (retryBtn) {
        retryBtn.addEventListener("click", function () {
          retryBtn.disabled = true;
          retryBtn.textContent = "Retrying\u2026";
          // Re-run the entire sign-in load chain (profile AND board), not just the
          // profile check -- if the first attempt also failed to load the board itself
          // (see the fallback added in afterSignedIn above), only retrying the profile
          // would fix the header badge while leaving the board frozen on its own
          // "something went wrong" message with no way to recover except a hard refresh.
          // afterSignedIn re-renders the header itself once it knows the outcome.
          afterSignedIn(currentUser);
        });
      }
      applyLockState(locked, reason);
      return;
    }

    // Not signed in and sync is configured: app.html requires an account, but navigating
    // away is a real side effect that shouldn't happen as a side effect of just rendering
    // a header widget -- this function gets called from lots of places (retry, upgrade,
    // password recovery) and any one of them could trip this if currentUser was ever
    // unexpectedly falsy. The actual "go to login.html" redirect lives in exactly two
    // deliberate places instead: app.js's initial gate (first load, no session), and the
    // SIGNED_OUT handler in initSync above (becoming signed out while already here).
    el.innerHTML = "";
  };
})(window.STB = window.STB || {});
