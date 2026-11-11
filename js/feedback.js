(function () {
  "use strict";

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function timeAgo(iso) {
    var diffMs = Date.now() - new Date(iso).getTime();
    var mins = Math.floor(diffMs / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + "m ago";
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + "h ago";
    var days = Math.floor(hrs / 24);
    if (days < 30) return days + "d ago";
    return new Date(iso).toLocaleDateString();
  }

  var messageInput = document.getElementById("fb-message");
  var authorInput = document.getElementById("fb-author");
  var countEl = document.getElementById("fb-count");
  var submitBtn = document.getElementById("fb-submit");
  var msgEl = document.getElementById("fb-msg");
  var listEl = document.getElementById("fb-list");
  var threadCountEl = document.getElementById("fb-thread-count");

  messageInput.addEventListener("input", function () {
    countEl.textContent = (500 - messageInput.value.length) + " characters left";
  });

  function client() {
    return window.supabase.createClient(window.STB_SUPABASE_URL, window.STB_SUPABASE_ANON_KEY);
  }

  function renderPosts(rows) {
    if (!rows.length) {
      listEl.innerHTML = '<div class="empty-state">No posts yet \u2014 be the first to leave one.</div>';
      threadCountEl.textContent = "";
      return;
    }
    threadCountEl.textContent = rows.length + (rows.length === 1 ? " post" : " posts");
    listEl.innerHTML = rows.map(function (row) {
      var reply = row.response
        ? '<div class="post-reply"><b>Anish replied:</b> ' + escapeHtml(row.response) + "</div>"
        : "";
      return (
        '<div class="post">' +
        '<div class="post-meta"><span>' + escapeHtml(row.author || "Anonymous") + "</span><span>" + timeAgo(row.created_at) + "</span></div>" +
        '<div class="post-message">' + escapeHtml(row.message) + "</div>" +
        reply +
        "</div>"
      );
    }).join("");
  }

  function loadPosts() {
    if (!window.STB_SUPABASE_URL) {
      listEl.innerHTML = '<div class="empty-state">Feedback board isn\u2019t connected yet.</div>';
      return;
    }
    client().from("feedback").select("author, message, response, created_at").order("created_at", { ascending: false }).limit(100)
      .then(function (res) {
        if (res.error) { listEl.innerHTML = '<div class="empty-state">Couldn\u2019t load the thread right now.</div>'; return; }
        renderPosts(res.data || []);
      });
  }

  function canPostAgain() {
    var last = 0;
    try { last = parseInt(window.localStorage.getItem("stb_fb_last_post") || "0", 10); } catch (e) {}
    return Date.now() - last > 60000;
  }

  submitBtn.addEventListener("click", function () {
    var message = messageInput.value.trim();
    var author = authorInput.value.trim() || "Anonymous";
    if (!message) { msgEl.textContent = "Write something first."; return; }
    if (!canPostAgain()) { msgEl.textContent = "One post per minute \u2014 give it a moment."; return; }
    if (!window.STB_SUPABASE_URL) { msgEl.textContent = "Feedback board isn\u2019t connected yet."; return; }
    submitBtn.disabled = true;
    msgEl.textContent = "Posting\u2026";
    client().from("feedback").insert({ author: author, message: message }).then(function (res) {
      submitBtn.disabled = false;
      if (res.error) { msgEl.textContent = res.error.message; return; }
      try { window.localStorage.setItem("stb_fb_last_post", String(Date.now())); } catch (e) {}
      messageInput.value = "";
      countEl.textContent = "500 characters left";
      msgEl.textContent = "Posted. Thanks!";
      loadPosts();
    });
  });

  var configReady = window.STB && window.STB.configReady && typeof window.STB.configReady.then === "function" ? window.STB.configReady : Promise.resolve();
  configReady.then(loadPosts, loadPosts);
})();
