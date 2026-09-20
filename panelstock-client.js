(function(){
  'use strict';
  var ua=navigator.userAgent||'';
  var legacy=/OS (?:10|9|8|7|6|5)_/.test(ua)&&/iP(?:ad|hone|od)/.test(ua);
  var script=document.createElement('script');
  script.src=legacy?'/panelstock-client.legacy.js?v=1':'/panelstock-client.modern.js?v=1';
  script.async=false;
  document.head.appendChild(script);
})();
