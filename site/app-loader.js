(function(){
  'use strict';
  var ua=navigator.userAgent||'';
  var legacy=/iP(?:ad|hone|od)/.test(ua)&&(/OS (?:10|9|8|7|6|5)_/.test(ua)||!/Version\/(?:1[1-9]|[2-9][0-9])/.test(ua));
  var script=document.createElement('script');
  script.src=legacy?'app.legacy.js?v=2':'app.js?v=security-2';
  script.async=false;
  script.onerror=function(){var el=document.getElementById('app');if(el)el.innerHTML='<div class="loading">PanelStock client failed to load.</div>';};
  document.body.appendChild(script);
})();
