(function () {
  'use strict';
  // The standalone Site app owns this reminder, never an embedded Orders view.
  if (window.top !== window || window.PanelStockSiteHost || window.PanelStockSiteInstallPromptLoaded) return;
  window.PanelStockSiteInstallPromptLoaded = true;

  var KEY = 'panelstock:site-orders:install-snoozed-until:v1';
  var WEEK = 7 * 24 * 60 * 60 * 1000;
  var standalone = window.matchMedia ? window.matchMedia('(display-mode: standalone)') : {matches: false};
  var ios = /iPad|iPhone|iPod/.test(navigator.userAgent || '') ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var deferred = null, popup = null, timer = null, dismissed = false, didInstall = false;

  function installed() { return didInstall || navigator.standalone === true || standalone.matches; }
  function snoozed() {
    if (dismissed) return true;
    try { return Number(localStorage.getItem(KEY) || 0) > Date.now(); } catch (error) { return false; }
  }
  function hide() {
    if (timer !== null) { window.clearTimeout(timer); timer = null; }
    if (popup && popup.parentNode) popup.parentNode.removeChild(popup);
    popup = null;
  }
  function dismiss() {
    dismissed = true;
    try { localStorage.setItem(KEY, String(Date.now() + WEEK)); } catch (error) {}
    hide();
  }
  function unavailable() {
    if (!popup) return;
    popup.querySelector('[data-install]').hidden = true;
    popup.querySelector('[data-description]').textContent =
      'Use your browser menu and choose Install app or Add to Home Screen.';
  }
  function install() {
    if (installed()) { hide(); return; }
    if (!popup) return;
    var button = popup.querySelector('[data-install]');
    if (!deferred) {
      if (ios) {
        var steps = popup.querySelector('[data-steps]');
        steps.hidden = !steps.hidden;
        button.setAttribute('aria-expanded', String(!steps.hidden));
        button.textContent = steps.hidden ? 'Show install steps' : 'Hide install steps';
      }
      return;
    }
    // prompt() must run directly inside this click, before any asynchronous work.
    var request = deferred;
    deferred = null;
    button.disabled = true;
    try {
      Promise.resolve(request.prompt()).then(function () { return request.userChoice; }).then(function () {
        dismiss();
      }, unavailable);
    } catch (error) { unavailable(); }
  }
  function show() {
    timer = null;
    if (popup || installed() || snoozed() || document.hidden || (!deferred && !ios)) return;
    if (!document.getElementById('site-install-prompt-style')) {
      var style = document.createElement('style');
      style.id = 'site-install-prompt-style';
      style.textContent =
        '.site-install-prompt{position:fixed;z-index:1000;right:16px;bottom:100px;bottom:calc(90px + env(safe-area-inset-bottom));width:calc(100% - 32px);max-width:380px;box-sizing:border-box;padding:18px;background:#fff;color:#0f172a;border:1px solid #cbd5e1;border-radius:16px;box-shadow:0 12px 40px #0f172a30;font-family:Arial,sans-serif;line-height:1.5;text-align:left}' +
        '.site-install-prompt *{box-sizing:border-box}.site-install-prompt [hidden]{display:none!important}' +
        '.site-install-prompt-header{display:flex;gap:12px;align-items:center;padding-right:28px}.site-install-prompt img{width:44px;height:44px;border-radius:10px}.site-install-prompt h2{margin:0;font-size:18px;line-height:1.3}' +
        '.site-install-prompt p{margin:12px 0;font-size:14px;color:#475569}.site-install-prompt ol{margin:12px 0;padding-left:22px;font-size:14px}.site-install-prompt li{margin:6px 0}' +
        '.site-install-prompt button{min-height:44px;font:600 14px Arial,sans-serif;cursor:pointer;border-radius:8px}.site-install-prompt button:focus-visible{outline:3px solid #0891b2;outline-offset:3px}' +
        '.site-install-prompt-close{position:absolute;right:8px;top:8px;min-width:44px;border:0;background:transparent;color:#475569;font-size:24px!important}' +
        '.site-install-prompt-actions{display:flex;flex-wrap:wrap;gap:10px}.site-install-prompt-install{flex:1;padding:10px 14px;border:1px solid #155e75;background:#155e75;color:#fff}.site-install-prompt-later{padding:10px 14px;border:1px solid #cbd5e1;background:#fff;color:#475569}.site-install-prompt button:disabled{opacity:.6;cursor:wait}';
      document.head.appendChild(style);
    }
    popup = document.createElement('section');
    popup.className = 'site-install-prompt';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-modal', 'false');
    popup.setAttribute('aria-labelledby', 'site-install-prompt-title');
    popup.setAttribute('aria-describedby', 'site-install-prompt-description');
    popup.setAttribute('aria-live', 'polite');
    popup.innerHTML = '<button type="button" class="site-install-prompt-close" data-close aria-label="Dismiss install reminder">&times;</button>' +
      '<div class="site-install-prompt-header"><img src="/icon-mobile-v3-192.png" alt=""><h2 id="site-install-prompt-title">Install Site Orders</h2></div>' +
      '<p id="site-install-prompt-description" data-description>Keep Site Orders on your device for quick access.</p>' +
      '<ol id="site-install-prompt-steps" data-steps hidden><li>Tap your browser\'s <strong>Share</strong> button.</li><li>Choose <strong>Add to Home Screen</strong>.</li><li>Tap <strong>Add</strong> to finish.</li></ol>' +
      '<div class="site-install-prompt-actions"><button type="button" class="site-install-prompt-install" data-install>' + (deferred ? 'Install app' : 'Show install steps') +
      '</button><button type="button" class="site-install-prompt-later" data-later>Not now</button></div>';
    var button = popup.querySelector('[data-install]');
    if (ios && !deferred) {
      button.setAttribute('aria-controls', 'site-install-prompt-steps');
      button.setAttribute('aria-expanded', 'false');
    }
    button.addEventListener('click', install);
    popup.querySelector('[data-close]').addEventListener('click', dismiss);
    popup.querySelector('[data-later]').addEventListener('click', dismiss);
    popup.addEventListener('keydown', function (event) { if (event.key === 'Escape') dismiss(); });
    // This is a non-modal reminder: leave focus and any in-progress form alone.
    document.body.appendChild(popup);
  }
  function schedule() {
    if (timer === null && !installed() && !snoozed()) timer = window.setTimeout(show, 2000);
  }
  window.addEventListener('beforeinstallprompt', function (event) {
    if (installed() || snoozed()) return;
    event.preventDefault();
    deferred = event;
    schedule();
  });
  window.addEventListener('appinstalled', function () { didInstall = true; deferred = null; dismiss(); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) show(); });
  function displayChanged() { if (installed()) hide(); }
  if (standalone.addEventListener) standalone.addEventListener('change', displayChanged);
  else if (standalone.addListener) standalone.addListener(displayChanged);
  if (ios) schedule();
})();
