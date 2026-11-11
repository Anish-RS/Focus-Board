(function(){
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
