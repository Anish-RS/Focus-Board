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
  // Set when the automatic claim loses a race: the username was free when they signed up
  // and taken by someone else by the time they confirmed. Distinct from profileLoadFailed
  // ("couldn't tell") so the UI can say something true and actionable.
  var claimConflict = false;
  var pushTimeout = null;
  var applyingRemoteUpdate = false;
  var realtimeChannel = null;
  var inRecoveryMode = false;
  // Tracks an in-flight afterSignedIn() run so a second notification for the SAME user
  // (Supabase can fire more than one "signed in" event for one page load -- see
  // afterSignedIn below for the full story) reuses it instead of starting a duplicate
  // run in parallel. Cleared once the run finishes, so a later, genuinely new attempt
  // (e.g. the Retry button, or actually signing out and back in) still starts fresh.
  var pendingAfterSignedIn = null; // { userId, promise }

  // Both helpers fall back to the browser dialog if js/toast.js hasn't loaded, so this
  // file keeps working on pages that don't include it (e.g. login.html).
  function showError(message) {
    if (typeof STB.alertToast === "function") STB.alertToast(message);
    else window.alert(message);
  }
  function showInfo(message) {
    if (typeof STB.toast === "function") STB.toast(message, { tone: "success", duration: 6000 });
    else window.alert(message);
  }

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

  // Used by js/desktop-app.js to authenticate the installer download. getSession() also
  // refreshes an expired access token, so a long-open tab doesn't fail the download with a
  // 401 from a token that quietly timed out an hour ago.
  STB.getAccessToken = function () {
    var c = getClient();
    if (!c) return Promise.resolve(null);
    return c.auth
      .getSession()
      .then(function (res) {
        return (res && res.data && res.data.session && res.data.session.access_token) || null;
      })
      .catch(function () { return null; });
  };
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
    // Outside India the price is not a converted estimate -- it is the dollar figure Stripe
    // will charge, so show that on its own.
    if (typeof STB.paymentRegion === "function" && STB.paymentRegion() === "intl") {
      var usd = (STB.PRICE_INTL && STB.PRICE_INTL.amount) || 4;
      return "Upgrade \u00b7 $" + usd + "/mo";
    }
    var suffix = (typeof STB.getPriceSuffix === "function") ? STB.getPriceSuffix() : "";
    return "Upgrade \u00b7 \u20b9" + STB.PRICE_INR + "/mo" + suffix;
  }
  STB.PRICE_INR = STB.PRICE_INR || 249; // currency.js also sets this; kept here too in case it isn't loaded on a page

  // ---------- returning from Stripe Checkout ----------
  // Stripe redirects the browser back the instant payment succeeds, but the webhook that
  // actually flips is_paid runs on the server and can land a second or two later. Showing
  // "trial expired" to somebody who has just paid is the worst possible first impression, so
  // poll the profile briefly instead of taking one reading.
  function isCheckoutReturn() {
    try { return /(?:^|[?&])checkout=success(?:&|$)/.test(window.location.search); } catch (e) { return false; }
  }

  function waitForPaidProfile(attemptsLeft) {
    if (typeof attemptsLeft !== "number") attemptsLeft = 12;
    if (!currentUser) return Promise.resolve(false);
    return fetchProfile(currentUser.id)
      .then(function (profile) {
        if (profile && profile.is_paid) {
          STB.renderAuthUI();
          if (STB.toast) STB.toast("Payment received \u2014 your subscription is active.", { tone: "success", duration: 6000 });
          try { window.history.replaceState({}, "", window.location.pathname); } catch (e) {}
          return true;
        }
        if (attemptsLeft <= 0) return false;
        return new Promise(function (r) { setTimeout(r, 1500); }).then(function () {
          return waitForPaidProfile(attemptsLeft - 1);
        });
      })
      .catch(function () {
        // A transient profile read failure must not end the wait early.
        if (attemptsLeft <= 0) return false;
        return new Promise(function (r) { setTimeout(r, 1500); }).then(function () {
          return waitForPaidProfile(attemptsLeft - 1);
        });
      });
  }

  // ---------- username availability + claiming ----------
  STB.checkUsernameAvailable = function (username) {
    var c = getClient();
    // Returning a bare `false` here used to be read by login.html as "no .available flag"
    // and rendered as "That username is taken." -- so on a deployment where sync wasn't
    // configured yet, every username anyone typed looked unavailable.
    if (!c) return Promise.resolve({ available: false, reason: "Accounts aren't configured on this deployment yet." });
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
  // Cancels the signed-in user's own subscription (server decides whether it ends now or at
  // the end of the paid period). Resolves with the server's message.
  STB.cancelSubscription = function () {
    var c = getClient();
    if (!c || !currentUser) return Promise.reject(new Error("Sign in first."));
    return c.auth.getSession().then(function (res) {
      var token = res.data && res.data.session && res.data.session.access_token;
      if (!token) throw new Error("Your session has expired -- sign in again.");
      return fetch("/api/cancel-subscription", {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
      });
    }).then(function (r) { return r.json(); }).then(function (body) {
      if (body.error) throw new Error(body.error);
      return body;
    });
  };

  // ---------- checkout, routed by where the visitor is ----------
  // Razorpay bills in INR and INR only. For a card holder in Ohio or Manchester that is, at
  // best, a conversion fee they never agreed to and, at worst, a decline. So the provider is
  // chosen by region: India -> Razorpay (unchanged), everywhere else -> Stripe Checkout in
  // USD. Both end in the same place: a webhook, server-side, sets is_paid. The browser is
  // never trusted to say it has paid.
  function startStripeCheckout(token) {
    return fetch("/api/create-checkout-session", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    })
      .then(function (r) {
        return r.json().then(function (body) { return { ok: r.ok, body: body || {} }; },
          function () { return { ok: false, body: {} }; });
      })
      .then(function (out) {
        if (out.ok && out.body.url) {
          window.location.href = out.body.url;
          return { redirecting: true };
        }
        // No international provider configured yet (no Stripe keys), so this visitor would
        // be charged an INR price after being shown a dollar one. Say so plainly and let
        // them decide, instead of quietly converting them into a ₹249 customer.
        var proceed = true;
        try {
          proceed = window.confirm(
            "Card payments in your region are still being set up.\n\n" +
            "You can subscribe now \u2014 our Indian payment provider will charge \u20b9" +
            STB.PRICE_INR + " (about $3) and your bank may add a conversion fee.\n\nContinue?"
          );
        } catch (e) { proceed = true; }
        if (!proceed) throw new Error("No charge was made.");
        return startRazorpayCheckout(token);
      });
  }

  STB.startCheckout = function () {
    var c = getClient();
    if (!c || !currentUser) return Promise.reject(new Error("Sign in first."));
    return c.auth.getSession().then(function (res) {
      var token = res.data && res.data.session && res.data.session.access_token;
      if (!token) throw new Error("Your session has expired -- sign in again.");
      if (typeof STB.paymentRegion === "function" && STB.paymentRegion() === "intl") {
        return startStripeCheckout(token);
      }
      return startRazorpayCheckout(token);
    });
  };

  function startRazorpayCheckout(token) {
    return fetch("/api/create-subscription", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
    }).then(function (r) { return r.json(); }).then(function (body) {
      if (body.error) throw new Error(body.error);
      if (typeof window.Razorpay === "undefined") {
        throw new Error("Payment widget failed to load -- check your connection and try again.");
      }
      return new Promise(function (resolve, reject) {
        var rzp = new window.Razorpay({
          key: body.key_id,
          subscription_id: body.subscription_id,
          name: "Nudgeboard",
          description: "Nudgeboard Pro \u2014 \u20b9249/month",
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
  }

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
      options: {
        emailRedirectTo: window.location.origin + "/app.html",
        // localStorage is per-browser. With "Confirm email" on, the gap between signup and
        // the first signed-in page is however long it takes them to open their inbox -- and
        // they may well open it on a phone, in another browser, or in a private window. All
        // three lose the stashed username, which stranded new accounts on "choose a
        // username" even though they had already chosen one. User metadata travels with the
        // account itself, so it survives all of that.
        data: { username: username || "" },
      },
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

  // Re-sending the confirmation email, for the "I never got it" case. Only meaningful when
  // the project requires a confirmed address (Supabase Dashboard -> Authentication ->
  // Sign In / Providers -> Email -> "Confirm email").
  STB.resendConfirmation = function (email) {
    var c = getClient();
    if (!c) return Promise.reject(new Error("Accounts aren't set up yet."));
    return c.auth.resend({
      type: "signup",
      email: email,
      options: { emailRedirectTo: window.location.origin + "/app.html" },
    });
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

  // ---- applying a remote board ----
  // Two-device edits are still last-write-wins (the whole board is one JSON blob), but a
  // remote update used to be applied the instant it arrived -- including in the middle of
  // a sentence. Everything typed since the last render then vanished when the board was
  // rebuilt, which looked like the app had eaten the text. So an update that lands while
  // the caret is in a field is held back and applied once the user leaves the field (or
  // after a short grace period, in case they never do).
  var pendingRemoteData = null;
  var pendingRemoteTimer = null;

  function isTypingNow() {
    var el = document.activeElement;
    if (!el || !el.tagName) return false;
    var tag = el.tagName.toUpperCase();
    if (tag !== "INPUT" && tag !== "TEXTAREA") return false;
    return document.body.contains(el);
  }

  function applyRemoteBoard(data) {
    applyingRemoteUpdate = true;
    try {
      STB.state = STB.normalizeAndRollover(data);
      STB.saveState();
      STB.render();
    } finally {
      applyingRemoteUpdate = false;
    }
  }

  function flushPendingRemote() {
    if (pendingRemoteData === null) return;
    if (isTypingNow()) return;
    var data = pendingRemoteData;
    pendingRemoteData = null;
    if (pendingRemoteTimer) { clearTimeout(pendingRemoteTimer); pendingRemoteTimer = null; }
    applyRemoteBoard(data);
  }

  function queueRemoteBoard(data) {
    if (!isTypingNow()) { applyRemoteBoard(data); return; }
    pendingRemoteData = data;
    if (pendingRemoteTimer) clearTimeout(pendingRemoteTimer);
    pendingRemoteTimer = setTimeout(flushPendingRemote, 20000);
  }

  document.addEventListener("focusout", function () {
    // Wait a tick: focusout fires before focus lands on whatever comes next.
    setTimeout(flushPendingRemote, 0);
  });

  // ---- the tab's own write, coming back at it ----
  // pushToCloud() upserts the whole board, and Realtime then broadcasts that UPDATE to
  // every subscriber of "boards-<user>" -- including the tab that just wrote it. Applying
  // that echo as though another device had sent it silently undid whatever had happened
  // since the push left: a note deleted in that window reappeared (which is why the x
  // looked like it needed two or three clicks), and restoring a second saved note put the
  // first one back in the saved list.
  //
  // The column is jsonb, which does not preserve key order, so the payload that comes back
  // is never byte-identical to what was sent -- comparison has to be on a canonical form.
  var recentPushes = [];
  var MAX_RECENT_PUSHES = 8;

  function canonical(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value) || "null";
    if (Object.prototype.toString.call(value) === "[object Array]") {
      var items = [];
      for (var j = 0; j < value.length; j++) items.push(canonical(value[j]));
      return "[" + items.join(",") + "]";
    }
    var keys = Object.keys(value).sort();
    var parts = [];
    for (var i = 0; i < keys.length; i++) {
      if (value[keys[i]] === undefined) continue;
      parts.push(JSON.stringify(keys[i]) + ":" + canonical(value[keys[i]]));
    }
    return "{" + parts.join(",") + "}";
  }

  function rememberPush(data) {
    var sig;
    try { sig = canonical(data); } catch (e) { return; }
    recentPushes.push(sig);
    if (recentPushes.length > MAX_RECENT_PUSHES) recentPushes.shift();
  }

  function isOwnEcho(data) {
    var sig;
    try { sig = canonical(data); } catch (e) { return false; }
    return recentPushes.indexOf(sig) !== -1;
  }

  // Rebuilding the board for data identical to what is already on screen throws away the
  // node under the pointer, and a click whose button disappears between press and release
  // never fires at all -- a second reason a single click could appear to do nothing.
  function isAlreadyOnScreen(data) {
    try { return canonical(data) === canonical(STB.state); } catch (e) { return false; }
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
          // Our own write echoed back, or a board identical to the one on screen: there is
          // nothing to apply, and re-rendering for it is what ate the click.
          if (isOwnEcho(payload.new.data) || isAlreadyOnScreen(payload.new.data)) return;
          queueRemoteBoard(payload.new.data);
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

  function reportSyncState(state, detail) {
    if (STB.setSyncStatus) STB.setSyncStatus(state, detail);
  }

  // Every push gets a sequence number; only the newest in-flight push may paint the
  // result, so a slow earlier request can't overwrite a later one's outcome.
  var pushSeq = 0;
  var savingPaintTimer = null;

  function pushToCloud() {
    var c = getClient();
    if (!c || !currentUser) return;
    var seq = ++pushSeq;

    // Only say "Saving..." if the request actually takes a moment. Most pushes land in
    // well under 400ms and should read as a straight "Saved" -> "Saved" with no flicker.
    clearTimeout(savingPaintTimer);
    savingPaintTimer = setTimeout(function () {
      if (seq === pushSeq) reportSyncState("saving");
    }, 400);

    function settle(state, detail) {
      if (seq !== pushSeq) return; // a newer push is in flight; its result is the truth
      clearTimeout(savingPaintTimer);
      reportSyncState(state, detail);
    }

    rememberPush(STB.state);

    c.from("boards")
      .upsert({ user_id: currentUser.id, data: STB.state, updated_at: new Date().toISOString() })
      .then(function (res) {
        if (!res.error) { settle("saved"); return; }
        console.error("Sync push failed", res.error);
        // 401/403 here almost always means the trial lapsed (the RLS policy blocks writes)
        // or the session went stale -- both of which used to be completely invisible.
        var code = res.error.code || "";
        var status = res.status || 0;
        if (/^PGRST30[13]$/.test(code) || status === 401 || status === 403) {
          settle("readonly", "Your changes couldn't be saved to your account. If your trial has ended, upgrade to keep editing.");
        } else if (!navigator.onLine) {
          settle("offline");
        } else {
          settle("error");
        }
      })
      .catch(function (err) {
        // A dropped connection rejects the promise rather than resolving with { error },
        // which previously left the pill sitting on "Saving..." with nothing in the log.
        console.error("Sync push threw", err);
        settle(navigator.onLine ? "error" : "offline");
      });
  }

  STB.syncPush = function () {
    if (!currentUser || applyingRemoteUpdate) return;
    clearTimeout(pushTimeout);
    pushTimeout = setTimeout(pushToCloud, 1200);
  };

  function afterSignedIn(user) {
    if (pendingAfterSignedIn && pendingAfterSignedIn.userId === user.id) {
      // Supabase can notify us twice for the same session on one page load: an automatic
      // event fired the moment onAuthStateChange is registered (using whatever session is
      // already in storage), plus the explicit getSession() check in initSync below
      // resolving to that same session. Running this whole chain twice in parallel for a
      // brand new account meant two concurrent attempts to insert the same username row --
      // one succeeded, the other got a 409 and reported "couldn't load your account" even
      // though the account had, moments earlier, actually finished setting up correctly
      // (which is why reloading always showed everything working fine). Reusing the
      // in-flight run instead removes the race entirely.
      return pendingAfterSignedIn.promise;
    }
    currentUser = user;
    profileLoadFailed = false;
    claimConflict = false;
    var promise = fetchProfileWithRetry(user.id)
      .then(function (profile) {
        if (profile) return profile;
        // No profile yet -- either this is their very first sign-in after confirming
        // email (claim the username they picked at signup time), or something went
        // wrong and they need to be prompted to pick one on app.html.
        var pending = null;
        try { pending = window.localStorage.getItem("stb_pending_username"); } catch (e) {}
        // The browser that signed up may not be the one that clicked the confirmation link,
        // so fall back to the username recorded on the account at signup time.
        if (!pending && user && user.user_metadata && typeof user.user_metadata.username === "string") {
          pending = user.user_metadata.username.trim();
        }
        if (pending) {
          // Only clear the pending flag once the claim actually succeeds. Clearing it
          // first (as before) meant a failed claim -- taken username, network blip,
          // RLS hiccup -- silently threw away the only record of what to try, leaving
          // the account stuck in "needs username" forever with nothing to retry.
          return claimUsernameAndStartTrial(user.id, pending).then(function (profile) {
            try { window.localStorage.removeItem("stb_pending_username"); } catch (e2) {}
            return profile;
          }).catch(function (claimErr) {
            // Someone else confirmed the same username first. Nothing is broken and no data
            // is at risk -- they simply need to pick again. Reporting this as a load failure
            // ("Couldn't load your account, try refreshing") was misleading and invited a
            // retry that could never succeed.
            var m = String((claimErr && (claimErr.message || claimErr.details)) || "");
            var dup = (claimErr && claimErr.code === "23505") ||
                      /duplicate key|already exists|unique constraint/i.test(m);
            if (!dup) throw claimErr;
            claimConflict = true;
            try { window.localStorage.removeItem("stb_pending_username"); } catch (e3) {}
            return null;
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
        if (isCheckoutReturn()) waitForPaidProfile();
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
    promise = promise.then(function (result) {
      // This run has settled (successfully or not) -- clear the guard so a genuinely
      // new attempt (Retry, or a real subsequent sign-in) isn't mistaken for a
      // duplicate of this one and made to just wait on its already-finished result.
      if (pendingAfterSignedIn && pendingAfterSignedIn.userId === user.id) pendingAfterSignedIn = null;
      return result;
    });
    pendingAfterSignedIn = { userId: user.id, promise: promise };
    return promise;
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
        // replace(), not href: with href, app.html stayed in the history stack behind
        // login.html, so pressing Back restored the signed-in board from the back/forward
        // cache. Replacing the entry means Back goes wherever you came from instead.
        window.location.replace("login.html");
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
    if (!password || password.length < 8) { msg.textContent = "Choose a password with at least 8 characters."; return; }
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
        banner.innerHTML = claimConflict
          ? "That username was taken while you were confirming your email \u2014 someone else claimed it first. <a href=\"login.html?step=username\">Pick another one</a> to start your free trial."
          : "Almost done \u2014 <a href=\"login.html?step=username\">choose a username</a> to start your free trial.";
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
              showError((e && e.message) || "Could not start checkout.");
            });
          });
        }
      } else {
        banner.classList.remove("is-visible");
      }
    }

    // The desktop-download card (?desktop=1) shows a different action depending on whether
    // the visitor is signed in and paying, so it has to follow the same auth updates this
    // function does.
    if (typeof STB.renderDesktopCard === "function") STB.renderDesktopCard();
  }

  // Minimal header widget for app.html: shows the username + trial status + sign out.
  // The actual sign-in/sign-up forms live on the dedicated login.html page now.
  // "26 days left" made people do arithmetic to answer "when?". A date answers it directly.
  // Note the wording differs by state on purpose: a paying subscriber's access does not
  // expire, it renews, and calling that "expires" would be a lie the first time it renews.
  function formatDate(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    try {
      return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    } catch (e) {
      return d.toDateString();
    }
  }

  function accountMetaLine(trial) {
    if (profileLoadFailed) return "Couldn\u2019t load your account";
    if (!currentProfile) return "Finish setup: choose a username";
    if (trial.isPaid) {
      var renews = formatDate(currentProfile.paid_until);
      return renews ? "Renews " + renews : "Full access";
    }
    if (trial.expired) {
      var ended = formatDate(currentProfile.trial_ends_at);
      return ended ? "Trial ended " + ended + " \u00b7 view only" : "Trial ended \u00b7 view only";
    }
    var ends = formatDate(currentProfile.trial_ends_at);
    return ends ? "Trial ends " + ends : "Trial";
  }

  // A paid account carries a seal beside the name, so "is this person paying?" is answerable
  // at a glance instead of by reading a trial badge. The shape is the recognisable
  // scalloped verified seal; the colours are the board's own paper and ink rather than the
  // usual corporate blue, so it looks drawn for this product instead of pasted in.
  var VERIFIED_TICK =
    '<svg class="stb-verified" width="17" height="17" viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
    '<path d="M8.00 1.40 A2.12 2.12 0 0 1 11.30 2.28 A2.12 2.12 0 0 1 13.72 4.70 A2.12 2.12 0 0 1 14.60 8.00 ' +
    'A2.12 2.12 0 0 1 13.72 11.30 A2.12 2.12 0 0 1 11.30 13.72 A2.12 2.12 0 0 1 8.00 14.60 ' +
    'A2.12 2.12 0 0 1 4.70 13.72 A2.12 2.12 0 0 1 2.28 11.30 A2.12 2.12 0 0 1 1.40 8.00 ' +
    'A2.12 2.12 0 0 1 2.28 4.70 A2.12 2.12 0 0 1 4.70 2.28 A2.12 2.12 0 0 1 8.00 1.40 Z" ' +
    'fill="#FBF8F1" stroke="#2B2620" stroke-width="0.7" stroke-linejoin="round"/>' +
    '<polyline points="4.9 8.2 7.0 10.3 11.2 5.9" fill="none" stroke="#2B2620" stroke-width="1.7" ' +
    'stroke-linecap="round" stroke-linejoin="round"/></svg>';

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
      var upgradeHtml = "";
      var locked = false;
      var reason = null;
      if (profileLoadFailed) {
        // A fetch failure, not a confirmed "no profile" -- see the comment on
        // profileLoadFailed above. Offer a retry instead of the "choose a username"
        // prompt, which would be wrong (and confusing) for an already-registered user.
        upgradeHtml = '<button class="stb-upgrade-btn" id="stb-retry-profile-btn">Retry</button>';
        locked = true;
        reason = "load_failed";
      } else if (!currentProfile) {
        locked = true;
        reason = "needs_username";
      } else if (trial.isPaid) {
        upgradeHtml = '<button class="stb-auth-signout" id="stb-cancel-btn">Cancel plan</button>';
      } else if (trial.expired) {
        locked = true;
        upgradeHtml = '<button class="stb-upgrade-btn" id="stb-upgrade-btn">' + upgradeLabel() + '</button>';
      } else {
        upgradeHtml = '<button class="stb-upgrade-btn" id="stb-upgrade-btn">' + upgradeLabel() + '</button>';
      }
      // Only fall back to the email-derived name when we've genuinely confirmed there's
      // no profile yet -- showing it during a load failure is exactly what made a
      // returning user's own account look unfamiliar ("roysing90s" instead of "roysing").
      var displayName = currentProfile
        ? currentProfile.username
        : (profileLoadFailed ? "Account" : currentUser.email.split("@")[0]);
      // Syncing is not a feature to advertise -- it happens by default, and the "Saved"
      // pill under the board title already reports its state honestly. So the account chip
      // is now just: who you are, whether you pay, and when that runs out.
      var showTick = !!(currentProfile && trial.isPaid);
      el.innerHTML =
        '<span class="stb-account">' +
          '<span class="stb-account-name">' + STB.escapeAttr(displayName) + (showTick ? VERIFIED_TICK : "") + "</span>" +
          '<span class="stb-account-meta">' + accountMetaLine(trial) + "</span>" +
        "</span>" +
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
            showError((e && e.message) || "Could not start checkout.");
          });
        });
      }
      var cancelBtn = document.getElementById("stb-cancel-btn");
      if (cancelBtn) {
        cancelBtn.addEventListener("click", function () {
          if (!window.confirm("Cancel your subscription?\n\nYou'll keep full access until the end of your current billing period, and you won't be charged again.")) return;
          cancelBtn.disabled = true;
          cancelBtn.textContent = "Cancelling\u2026";
          STB.cancelSubscription().then(function (body) {
            showInfo(body.message || "Your subscription is cancelled.");
            cancelBtn.textContent = "Cancelled";
          }).catch(function (e) {
            cancelBtn.disabled = false;
            cancelBtn.textContent = "Cancel plan";
            showError((e && e.message) || "Could not cancel right now.");
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
