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
  s.src=legacy?'panelstock-legacy-ui.js?v=4&refresh=20261029&delivery=20261103&dispatch-defaults=20261104&unified-dispatch=20261112-card-details':'panelstock-app.modern.js?v=20261013-toolbox-session&settings=20261027-sop&qa=20261123-loading-recovery&refresh=20261029&orders-frame=20261031&dispatch=20261101&delivery=20261103&dispatch-defaults=20261104&unified-dispatch=20261112-card-details&catalogue-m2=20261105&stocktake-settings=20261106&offcut-labels=20261111-admin-pdf&reports-hub=5&offcut-cuts=20261119&undo-cut=20261119&org-chart=1&panel-area=20261125-import';
  s.async=false;
  s.onerror=function(){showError('Failed to download '+s.src);};
  if(legacy){
    document.body.appendChild(s);
  }else{
    var chart=document.createElement('script');
    chart.src='org-chart.js?v=3';
    chart.async=false;
    var workshop=document.createElement('script');
    workshop.async=false;
    var reports=document.createElement('script');
    workshop.src='workshop-stock.js?v=20261113-reporting-period-year&soh-reports=3&soh-in-stock=20261119&material-prices=20261120&profile-images=20261120&profile-picker=20261121&capral-reference=20261121-gallery&supplier-reference=20261121-sculptform-track&stock-response=20261123-deferred-images';
    reports.src='reports-page.js?v=5';
    workshop.onload=function(){document.body.appendChild(reports);};
    reports.onload=function(){document.body.appendChild(s);};
    workshop.onerror=function(){document.getElementById('root').textContent='Unable to load workshop stock. Please refresh.';};
    reports.onerror=function(){document.getElementById('root').textContent='Unable to load reports. Please refresh.';};
    document.body.appendChild(chart);
    document.body.appendChild(workshop);
  }
  if(legacy)setTimeout(function(){var root=document.getElementById('root');if(root&&/LENNOX|Loading/i.test(root.textContent||''))showError('Startup timed out after 15 seconds with no reported JavaScript error.');},15000);
})();
