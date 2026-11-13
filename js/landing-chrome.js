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
