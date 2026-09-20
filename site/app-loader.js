(function(){
  'use strict';
  var ua=navigator.userAgent||'';
  var legacy=/OS (?:10|9|8|7|6|5)_/.test(ua)&&/iP(?:ad|hone|od)/.test(ua);
  var script=document.createElement('script');
  script.src=legacy?'app.legacy.js?v=1':'app.js?v=security-2';
  script.async=false;
  document.body.appendChild(script);
})();
