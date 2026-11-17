(function(){
  // A failed auth link (an expired or already-used password-reset link, most often) is sent
  // back to the Site URL -- which is this page -- with #error=... in the hash. Left alone, the
  // visitor lands on the marketing page with no explanation and no way forward. Forward it to
  // login.html, which explains what happened and can send a fresh link.
  var h = window.location.hash || "";
  if (/[#&]error(_code|_description)?=/.test(h)) {
    window.location.replace("login.html" + h);
    return;
  }
  var nav=document.getElementById('topnav'), bar=document.getElementById('progress'), top=document.getElementById('toTop');
  function onScroll(){
    var y=window.scrollY||0, h=document.documentElement.scrollHeight-window.innerHeight;
    nav.classList.toggle('scrolled', y>10);
    bar.style.width=(h>0?(y/h)*100:0)+'%';
    top.classList.toggle('show', y>600);
  }
  window.addEventListener('scroll', onScroll, {passive:true}); onScroll();
  top.addEventListener('click', function(){ window.scrollTo({top:0, behavior:'smooth'}); });
})();

// Click a preview still and it opens full size. Esc, a click anywhere, or the back
// gesture closes it. Inline script is blocked by the CSP, which is why this lives here.
(function(){
  var stills = document.querySelectorAll(".showcase-stills img");
  if (!stills.length) return;
  var box = null, opener = null;

  function close(){
    if (!box) return;
    box.remove();
    box = null;
    document.body.style.overflow = "";
    if (opener) opener.focus();
    opener = null;
  }

  function open(img){
    opener = img;
    box = document.createElement("div");
    box.className = "lightbox";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", img.alt || "Preview image, full size");
    var big = document.createElement("img");
    big.src = img.currentSrc || img.src;
    big.alt = img.alt || "";
    box.appendChild(big);
    box.addEventListener("click", close);
    document.body.appendChild(box);
    document.body.style.overflow = "hidden";
  }

  Array.prototype.forEach.call(stills, function(img){
    img.tabIndex = 0;
    img.setAttribute("role", "button");
    img.addEventListener("click", function(){ open(img); });
    img.addEventListener("keydown", function(e){
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(img); }
    });
  });

  document.addEventListener("keydown", function(e){
    if (e.key === "Escape") close();
  });
})();
