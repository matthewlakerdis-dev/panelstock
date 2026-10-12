(function () {
  'use strict';
  var host;
  try {
    if (window.parent !== window && window.parent.location.origin === window.location.origin) {
      host = window.parent.PanelStockMobileOrders;
    }
  } catch (_) {}
  if (!host || !host.isCurrent() || !host.session || !(host.session.isAdmin || host.session.taskAccess && host.session.taskAccess['site.orders.view'] === true)) {
    document.getElementById('app').textContent = 'Open Site Orders from the PanelStock mobile app.';
    return;
  }
  window.PanelStockSiteHost = host;
  var legacy = /iP(?:ad|hone|od)/.test(navigator.userAgent || '') && /OS (?:10|9|8|7|6|5)_/.test(navigator.userAgent || '');
  if (legacy) {
    window.require = function (path) {
      if (path === '../worker/src/brand-logo.js') return {brandLogo: host.logo};
      throw new Error('Unknown Site Orders module');
    };
  }
  var script = document.createElement('script');
  if (!legacy) script.type = 'module';
  script.src = legacy ? '../site/app.legacy.js' : '../site/app.js';
  script.onerror = function () { document.getElementById('app').textContent = 'Site Orders could not load. Please reopen it while online.'; };
  document.body.appendChild(script);
})();
