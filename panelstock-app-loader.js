(function(){
  'use strict';
  var ua=navigator.userAgent||'';
  var legacy=/iP(?:ad|hone|od)/.test(ua)&&/OS (?:10|9|8|7|6|5)_/.test(ua);
  var s=document.createElement('script');
  s.src=legacy?'panelstock-app.legacy.js?v=2':'panelstock-app.modern.js?v=2';
  s.async=false;
  document.body.appendChild(s);
})();
