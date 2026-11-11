(function(){
  var links=[].slice.call(document.querySelectorAll('.toc a'));
  var secs=links.map(function(a){return document.querySelector(a.getAttribute('href'));});
  function spy(){
    var y=window.scrollY+140, cur=0;
    secs.forEach(function(s,i){ if(s && s.offsetTop<=y) cur=i; });
    links.forEach(function(a,i){ a.classList.toggle('active', i===cur); });
  }
  window.addEventListener('scroll',spy,{passive:true}); spy();
})();
