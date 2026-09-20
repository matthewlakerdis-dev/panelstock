(function(){
  'use strict';
  var ua=navigator.userAgent||'';
  var legacy=/iP(?:ad|hone|od)/.test(ua)&&/OS (?:10|9|8|7|6|5)_/.test(ua);
  function showError(message){
    if(!legacy)return;
    var root=document.getElementById('root')||document.body;
    root.innerHTML='<div style="font-family:Arial,sans-serif;padding:28px;color:#7a1f1f;background:#fff;min-height:100vh;box-sizing:border-box"><h2>PanelStock legacy startup error</h2><p>Please send this message back:</p><pre style="white-space:pre-wrap;font-size:14px">'+String(message).replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</pre></div>';
  }
  if(legacy){
    window.onerror=function(message,source,line,column,error){showError(String(message)+'\n'+String(source||'')+':'+String(line||0)+':'+String(column||0)+(error&&error.stack?'\n'+error.stack:''));return false;};
    window.addEventListener('unhandledrejection',function(event){showError('Unhandled promise rejection: '+String(event&&event.reason||'unknown'));});
  }
  var s=document.createElement('script');
  s.src=legacy?'panelstock-app.legacy.js?v=5':'panelstock-app.modern.js?v=5';
  s.async=false;
  s.onerror=function(){showError('Failed to download '+s.src);};
  document.body.appendChild(s);
  if(legacy)setTimeout(function(){var root=document.getElementById('root');if(root&&/LENNOX|Loading/i.test(root.textContent||''))showError('Startup timed out after 15 seconds with no reported JavaScript error.');},15000);
})();
