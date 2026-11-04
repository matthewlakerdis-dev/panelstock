(function(){
  if(!window.Promise){document.documentElement.innerHTML='<body><div style="font-family:Arial;padding:30px">PanelStock requires Promise support.</div></body>';return;}
  if(!window.Symbol)window.Symbol=function Symbol(description){return '@@symbol:'+String(description||'')+':'+Math.random();};
  if(!window.Symbol.for){var symbolRegistry={};window.Symbol.for=function(key){key=String(key);return symbolRegistry[key]||(symbolRegistry[key]=window.Symbol(key));};}
  if(!Object.assign)Object.assign=function(target){if(target==null)throw new TypeError('Cannot convert undefined or null to object');var to=Object(target);for(var i=1;i<arguments.length;i++){var src=arguments[i];if(src!=null)for(var key in src)if(Object.prototype.hasOwnProperty.call(src,key))to[key]=src[key];}return to;};
  if(!Object.fromEntries)Object.fromEntries=function(entries){var o={};for(var i=0;i<entries.length;i++)o[entries[i][0]]=entries[i][1];return o;};
  if(!Array.prototype.flatMap)Array.prototype.flatMap=function(fn,thisArg){return Array.prototype.concat.apply([],this.map(fn,thisArg));};
  if(!String.prototype.padStart)String.prototype.padStart=function(n,s){s=String(s||' ');var v=String(this);while(v.length<n)v=s+v;return v.slice(-n);};
  if(!window.queueMicrotask)window.queueMicrotask=function(fn){Promise.resolve().then(fn);};
  if(!Promise.prototype.finally)Promise.prototype.finally=function(callback){var P=this.constructor||Promise;return this.then(function(value){return P.resolve(callback()).then(function(){return value;});},function(reason){return P.resolve(callback()).then(function(){throw reason;});});};
  if(!window.crypto)window.crypto={};
  if(!window.crypto.randomUUID)window.crypto.randomUUID=function(){return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){var r=Math.random()*16|0,v=c==='x'?r:(r&3|8);return v.toString(16);});};
  if(!Element.prototype.replaceChildren)Element.prototype.replaceChildren=function(){while(this.firstChild)this.removeChild(this.firstChild);for(var i=0;i<arguments.length;i++)this.appendChild(arguments[i]);};
  if(!Element.prototype.remove)Element.prototype.remove=function(){if(this.parentNode)this.parentNode.removeChild(this);};
  if(!window.AbortSignal)window.AbortSignal={};
  if(!window.AbortSignal.timeout)window.AbortSignal.timeout=function(){return undefined;};
})();
"use strict";

var _brandLogo = require("../worker/src/brand-logo.js");
var _excluded = ["file", "missing"],
  _excluded2 = ["file", "missing"],
  _excluded3 = ["file"],
  _excluded4 = ["file"];
function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
function _regeneratorValues(e) { if (null != e) { var t = e["function" == typeof Symbol && Symbol.iterator || "@@iterator"], r = 0; if (t) return t.call(e); if ("function" == typeof e.next) return e; if (!isNaN(e.length)) return { next: function next() { return e && r >= e.length && (e = void 0), { value: e && e[r++], done: !e }; } }; } throw new TypeError(_typeof(e) + " is not iterable"); }
function _regenerator() { /*! regenerator-runtime -- Copyright (c) 2014-present, Facebook, Inc. -- license (MIT): https://github.com/babel/babel/blob/main/packages/babel-helpers/LICENSE */ var r, e, o = "function" == typeof Symbol ? Symbol : {}, n = o.iterator || "@@iterator", a = o.toStringTag || "@@toStringTag"; function i(o, n, a, i) { var u = n && n.prototype instanceof Generator ? n : Generator, f = Object.create(u.prototype); return _regeneratorDefine2(f, "_invoke", function (t, o, n) { var a, i, u, f = 0, p = n || [], y = !1, G = { p: 0, n: 0, v: r, a: l, f: l.bind(r, 4), d: function d(t, e) { return a = t, i = 0, u = r, G.n = e, c; } }; function l(t, o) { for (i = t, u = o, e = 0; !y && f && !n && e < p.length; e++) { var n, a = p[e], l = G.p, F = a[2]; t > 3 ? (n = F === o) && (u = a[(i = a[4]) ? 5 : (i = 3, 3)], a[4] = a[5] = r) : a[0] <= l && ((n = t < 2 && l < a[1]) ? (i = 0, G.v = o, G.n = a[1]) : l < F && (n = t < 3 || a[0] > o || o > F) && (a[4] = t, a[5] = o, G.n = F, i = 0)); } if (n || t > 1) return c; throw y = !0, o; } return function (n, p, F) { if (f > 1) throw TypeError("Generator is already running"); for (y && 1 === p && l(p, F), i = p, u = F; (e = i < 2 ? r : u) || !y;) { a || (i ? i < 3 ? (i > 1 && (G.n = -1), l(i, u)) : G.n = u : G.v = u); try { if (f = 2, a) { if (i || (n = "next"), e = a[n]) { if (!(e = e.call(a, u))) throw TypeError("iterator result is not an object"); if (!e.done) return e; u = e.value, i < 2 && (i = 0); } else 1 === i && (e = a.return) && e.call(a), i < 2 && (u = TypeError("The iterator does not provide a '" + n + "' method"), i = 1); a = r; } else if ((e = (y = G.n < 0) ? u : t.call(o, G)) !== c) break; } catch (t) { a = r, i = 1, u = t; } finally { f = 1; } } return { value: e, done: y }; }; }(o, a, i), !0), f; } var c = {}; function Generator() {} function GeneratorFunction() {} function GeneratorFunctionPrototype() {} e = Object.getPrototypeOf; var u = [][n] ? e(e([][n]())) : (_regeneratorDefine2(e = {}, n, function () { return this; }), e), f = GeneratorFunctionPrototype.prototype = Generator.prototype = Object.create(u); function p(r) { return Object.setPrototypeOf ? Object.setPrototypeOf(r, GeneratorFunctionPrototype) : (r.__proto__ = GeneratorFunctionPrototype, _regeneratorDefine2(r, a, "GeneratorFunction")), r.prototype = Object.create(f), r; } return GeneratorFunction.prototype = GeneratorFunctionPrototype, _regeneratorDefine2(f, "constructor", GeneratorFunctionPrototype), _regeneratorDefine2(GeneratorFunctionPrototype, "constructor", GeneratorFunction), GeneratorFunction.displayName = "GeneratorFunction", _regeneratorDefine2(GeneratorFunctionPrototype, a, "GeneratorFunction"), _regeneratorDefine2(f), _regeneratorDefine2(f, a, "Generator"), _regeneratorDefine2(f, n, function () { return this; }), _regeneratorDefine2(f, "toString", function () { return "[object Generator]"; }), (_regenerator = function _regenerator() { return { w: i, m: p }; })(); }
function _regeneratorDefine2(e, r, n, t) { var i = Object.defineProperty; try { i({}, "", {}); } catch (e) { i = 0; } _regeneratorDefine2 = function _regeneratorDefine(e, r, n, t) { function o(r, n) { _regeneratorDefine2(e, r, function (e) { return this._invoke(r, n, e); }); } r ? i ? i(e, r, { value: n, enumerable: !t, configurable: !t, writable: !t }) : e[r] = n : (o("next", 0), o("throw", 1), o("return", 2)); }, _regeneratorDefine2(e, r, n, t); }
function _createForOfIteratorHelper(e, t) { var _n = "undefined" != typeof Symbol && e[Symbol.iterator] || e["@@iterator"]; if (!_n) { if (Array.isArray(e) || (_n = _unsupportedIterableToArray(e)) || t && e && "number" == typeof e.length) { _n && (e = _n); var o = 0, F = function F() {}; return { s: F, n: function n() { return o >= e.length ? { done: !0 } : { done: !1, value: e[o++] }; }, e: function e(r) { throw r; }, f: F }; } throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); } var a, u, i = !0; return { s: function s() { _n = _n.call(e); }, n: function n() { i = !0; var r = _n.next(); return r.done ? { done: !0 } : { value: r.value, done: i = !1 }; }, e: function e(r) { a = !0, u = r; }, f: function f() { try { i || null == _n.return || _n.return(); } finally { if (a) throw u; } } }; }
function _slicedToArray(e, i) { return _iterableToArrayLimit(e, i) || _unsupportedIterableToArray(e, i) || _nonIterableRest(); }
function _nonIterableRest() { throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _iterableToArrayLimit(r, t) { var e = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"]; if (Array.isArray(r) && (null == e || e === ("undefined" != typeof Symbol && [][Symbol.iterator]) || e === []["@@iterator"])) return r; if (null != e) { var l, n, i, a, u = [], o = !0, f = !1; try { if (i = (e = e.call(r)).next, 0 === t) { if (Object(e) !== e) return; o = !1; } else for (; !(o = (l = i.call(e)).done) && (u.push(l.value), u.length !== t); o = !0); } catch (r) { f = !0, n = r; } finally { try { if (!o && null != e.return && (a = e.return(), Object(a) !== a)) return; } finally { if (f) throw n; } } return u; } }
function _objectWithoutProperties(t, r) { if (null == t) return {}; var o, n, i = _objectWithoutPropertiesLoose(t, r); if (Object.getOwnPropertySymbols) { var l = Object.getOwnPropertySymbols(t); for (n = 0; n < l.length; n++) o = l[n], -1 === r.indexOf(o) && {}.propertyIsEnumerable.call(t, o) && (i[o] = t[o]); } return i; }
function _objectWithoutPropertiesLoose(r, e) { if (null == r) return {}; var t = {}; for (var n in r) if ({}.hasOwnProperty.call(r, n)) { if (-1 !== e.indexOf(n)) continue; t[n] = r[n]; } return t; }
function _toConsumableArray(a) { return _arrayWithoutHoles(a) || _iterableToArray(a) || _unsupportedIterableToArray(a) || _nonIterableSpread(); }
function _nonIterableSpread() { throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _unsupportedIterableToArray(t, e) { if (t) { if ("string" == typeof t) return _arrayLikeToArray(t, e); var o = {}.toString.call(t).slice(8, -1); return "Object" === o && t.constructor && (o = t.constructor.name), "Map" === o || "Set" === o ? Array.from(t) : "Arguments" === o || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(o) ? _arrayLikeToArray(t, e) : void 0; } }
function _iterableToArray(r) { var e = "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"]; if (Array.isArray(r) && (null == e || e === ("undefined" != typeof Symbol && [][Symbol.iterator]) || e === []["@@iterator"])) return r; if (null != e) { for (var t, o = [], a = e.call(r); !(t = a.next()).done;) o.push(t.value); return o; } }
function _arrayWithoutHoles(a) { if (Array.isArray(a)) return _arrayLikeToArray(a); }
function _arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }
function asyncGeneratorStep(n, t, e, r, o, a, c) { try { var i = n[a](c), u = i.value; } catch (n) { return void e(n); } i.done ? t(u) : Promise.resolve(u).then(r, o); }
function _asyncToGenerator(n) { return function () { var t = this, e = arguments; return new Promise(function (r, o) { var a = n.apply(t, e); function _next(n) { asyncGeneratorStep(a, r, o, _next, _throw, "next", n); } function _throw(n) { asyncGeneratorStep(a, r, o, _next, _throw, "throw", n); } _next(void 0); }); }; }
function ownKeys(e, r) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r).enumerable; })), t.push.apply(t, o); } return t; }
function _objectSpread(r) { for (var t = 1; t < arguments.length; t++) { var o = null != arguments[t] ? arguments[t] : {}; t % 2 ? ownKeys(Object(o), !0).forEach(function (t) { _defineProperty(r, t, o[t]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(r, Object.getOwnPropertyDescriptors(o)) : ownKeys(Object(o)).forEach(function (e) { Object.defineProperty(r, e, Object.getOwnPropertyDescriptor(o, e)); }); } return r; }
function _defineProperty(r, t, o) { return (t = _toPropertyKey(t)) in r ? Object.defineProperty(r, t, { value: o, enumerable: !0, configurable: !0, writable: !0 }) : r[t] = o, r; }
function _toPropertyKey(r) { var o = _toPrimitive(r, "string"); return "symbol" == _typeof(o) ? o : o + ""; }
function _toPrimitive(t, e) { if ("object" != _typeof(t) || !t) return t; var r; if ("undefined" != typeof Symbol && void 0 !== (r = t[Symbol.toPrimitive])) { var i = r.call(t, e || "default"); if ("object" != _typeof(i)) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === e ? String : Number)(t); }
(function (_session, _session2, _session25, _window$PanelStockPul, _document$addEventLis, _document) {
  'use strict';

  var API = 'https://panelstock-reports.matthewlakerdis.workers.dev';
  var SESSION_KEY = 'panelstock:site-orders:session:v1',
    OUTBOX_KEY = 'panelstock:site-orders:outbox:v1',
    PROJECTS_KEY = 'panelstock:site-orders:projects:v1',
    USERNAME_KEY = 'panelstock:site-orders:remembered-username:v3';
  var deviceStorage = localStorage,
    siteWorkspace = null,
    workspaceOwner = null,
    workspaceRequest = 0;
  var workspacePrefixes = ['panelstock:site-orders:draft:v1:', 'panelstock:site-orders:comment:v1:', 'panelstock:receipt:'];
  var mobileHost = window.PanelStockSiteHost || null;
  var root = document.getElementById('app');
  var session = mobileHost ? _objectSpread({}, mobileHost.session) : read(SESSION_KEY, null),
    outbox = read(OUTBOX_KEY, {
      owner: null,
      queue: []
    }),
    projects = readProjects((_session = session) === null || _session === void 0 ? void 0 : _session.username),
    orders = [],
    cncPanels = [],
    supportTickets = [],
    supportSelected = '',
    supportPhoto = '',
    supportReplyPhoto = '',
    profile = null,
    pendingSetup = null,
    view = 'orders',
    busy = false,
    message = '',
    orderScope = 'all',
    orderFilter = 'active',
    cncFilter = 'all',
    cncQuery = '',
    selectedProfilePhoto = null,
    profileAdjustment = {
      zoom: 1,
      x: 50,
      y: 50
    },
    profileGesture = {
      pointers: new Map(),
      distance: 0
    };
  var cncExpanded = new Set();
  var userDetailsDraft = null,
    orderValidationId = '',
    editorReady = true;
  var DEFAULT_ORDER_TYPES = ['Panels', 'Fixings', 'Plant / Equipment', 'Other'];
  var orderTypes = readOrderTypes((_session2 = session) === null || _session2 === void 0 ? void 0 : _session2.username);
  function readOrderTypes(owner) {
    var saved = read(PROJECTS_KEY, {});
    return owner && saved.owner === owner && Array.isArray(saved.orderTypes) ? saved.orderTypes : [].concat(DEFAULT_ORDER_TYPES);
  }
  var selectedOrderFiles = [];
  var DRAFT_KEY = 'panelstock:site-orders:draft:v1:';
  var orderDraft = null,
    draftOwner = '',
    draftNotice = '',
    restoringDraft = false,
    selectedOrderId = '',
    discardDraftArmed = false;
  var draftFields = ['projectId', 'orderType', 'orderTypeOther', 'siteContact', 'phone', 'requestedDeliveryDate', 'requestedDeliveryTime', 'locationNotes'];
  var cloudDrafts = [],
    cloudDraftError = '',
    cloudDiscardId = '',
    deviceDiscardId = '';
  var sharingKeys = [],
    sharingLoaded = false,
    sharingBusy = false,
    sharingError = '',
    sharingSecret = '',
    sharingSecretId = '',
    sharingLabel = '',
    sharedDraftOpening = false;
  function sharedDraftIntent() {
    var _window$location;
    if (mobileHost || !((_window$location = window.location) !== null && _window$location !== void 0 && _window$location.hash)) return null;
    var params = new URLSearchParams(window.location.hash.slice(1)),
      id = params.get('shared-draft'),
      owner = params.get('owner');
    return /^[a-f0-9-]{36}$/i.test(id || '') && owner && owner.length <= 80 ? {
      id: id,
      owner: owner
    } : null;
  }
  function sharedDraftBanner() {
    var _session3;
    var intent = sharedDraftIntent();
    if (!intent) return '';
    return "<div class=\"notice\"><strong>PDF shared from Goodnotes</strong><p>".concat(intent.owner === ((_session3 = session) === null || _session3 === void 0 ? void 0 : _session3.username) ? 'Open the shared draft to complete your order.' : 'Sign in as ' + esc(intent.owner) + ' to open this draft.', "</p><button type=\"button\" data-open-shared ").concat(busy || sharedDraftOpening ? 'disabled' : '', ">Open shared draft</button> <button type=\"button\" data-dismiss-shared>Dismiss</button></div>");
  }
  function resumeSharedDraft() {
    return _resumeSharedDraft.apply(this, arguments);
  }
  function _resumeSharedDraft() {
    _resumeSharedDraft = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee8() {
      var intent, owner, version, _session31, _orderDraft8, current, _session32;
      return _regenerator().w(function (_context8) {
        while (1) switch (_context8.p = _context8.n) {
          case 0:
            intent = sharedDraftIntent();
            if (!(!intent || !session || busy || !editorReady || sharedDraftOpening)) {
              _context8.n = 1;
              break;
            }
            return _context8.a(2);
          case 1:
            if (!(intent.owner !== session.username)) {
              _context8.n = 2;
              break;
            }
            message = 'This shared draft belongs to ' + intent.owner + '. Sign in to that account to open it.';
            render();
            return _context8.a(2);
          case 2:
            if (can('site.orders.create')) {
              _context8.n = 3;
              break;
            }
            message = 'Order creation access is required to open this shared draft.';
            render();
            return _context8.a(2);
          case 3:
            owner = session.username, version = sessionVersion;
            sharedDraftOpening = true;
            _context8.p = 4;
            _context8.n = 5;
            return openCloudDraft(intent.id);
          case 5:
            if (!(version !== sessionVersion || ((_session31 = session) === null || _session31 === void 0 ? void 0 : _session31.username) !== owner)) {
              _context8.n = 6;
              break;
            }
            return _context8.a(2);
          case 6:
            if (view === 'new' && ((_orderDraft8 = orderDraft) === null || _orderDraft8 === void 0 ? void 0 : _orderDraft8.id) === intent.id) {
              current = sharedDraftIntent();
              if ((current === null || current === void 0 ? void 0 : current.id) === intent.id && current.owner === intent.owner) history.replaceState(null, '', location.pathname + location.search);
              message = 'Shared PDF attached. Complete the order details, then submit when ready.';
              render();
            }
          case 7:
            _context8.p = 7;
            sharedDraftOpening = false;
            if (version === sessionVersion && ((_session32 = session) === null || _session32 === void 0 ? void 0 : _session32.username) === owner) render();
            return _context8.f(7);
          case 8:
            return _context8.a(2);
        }
      }, _callee8, null, [[4,, 7, 8]]);
    }));
    return _resumeSharedDraft.apply(this, arguments);
  }
  function loadSharingKeys() {
    return _loadSharingKeys.apply(this, arguments);
  }
  function _loadSharingKeys() {
    _loadSharingKeys = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee9() {
      var version, response, result, _t0;
      return _regenerator().w(function (_context9) {
        while (1) switch (_context9.p = _context9.n) {
          case 0:
            if (!(mobileHost || !session || !can('site.orders.create') || sharingBusy)) {
              _context9.n = 1;
              break;
            }
            return _context9.a(2);
          case 1:
            version = sessionVersion;
            sharingBusy = true;
            sharingError = '';
            _context9.p = 2;
            _context9.n = 3;
            return api('/order-share/keys');
          case 3:
            response = _context9.v;
            _context9.n = 4;
            return response.json();
          case 4:
            result = _context9.v;
            if (response.ok) {
              _context9.n = 5;
              break;
            }
            throw Error(result.error || 'Could not load sharing settings.');
          case 5:
            sharingKeys = result.keys || [];
            sharingLoaded = true;
            _context9.n = 7;
            break;
          case 6:
            _context9.p = 6;
            _t0 = _context9.v;
            if (version === sessionVersion) sharingError = _t0.message;
          case 7:
            _context9.p = 7;
            if (version === sessionVersion) {
              sharingBusy = false;
              if (view === 'settings') render();
            }
            return _context9.f(7);
          case 8:
            return _context9.a(2);
        }
      }, _callee9, null, [[2, 6, 7, 8]]);
    }));
    return _loadSharingKeys.apply(this, arguments);
  }
  function updateSharingKey(_x) {
    return _updateSharingKey.apply(this, arguments);
  }
  function _updateSharingKey() {
    _updateSharingKey = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee0(event) {
      var form, version, id, action, label, response, result, _t1;
      return _regenerator().w(function (_context0) {
        while (1) switch (_context0.p = _context0.n) {
          case 0:
            event.preventDefault();
            if (!(sharingBusy || busy)) {
              _context0.n = 1;
              break;
            }
            return _context0.a(2);
          case 1:
            form = event.currentTarget, version = sessionVersion, id = form.dataset.sharingId;
            action = id ? 'revoke' : 'create', label = id ? '' : String(new FormData(form).get('label') || '').trim();
            if (!id) sharingLabel = label;
            sharingBusy = true;
            sharingError = '';
            render();
            _context0.p = 2;
            _context0.n = 3;
            return api('/order-share/keys', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                action: action,
                id: id,
                label: label
              })
            });
          case 3:
            response = _context0.v;
            _context0.n = 4;
            return response.json();
          case 4:
            result = _context0.v;
            if (response.ok) {
              _context0.n = 5;
              break;
            }
            throw Error(result.error || 'Could not update sharing settings.');
          case 5:
            sharingKeys = result.keys || [];
            sharingLoaded = true;
            if (result.key) {
              sharingSecret = result.key;
              sharingSecretId = result.key.split('.')[1];
              sharingLabel = '';
            } else if (id === sharingSecretId) {
              sharingSecret = '';
              sharingSecretId = '';
            }
            _context0.n = 7;
            break;
          case 6:
            _context0.p = 6;
            _t1 = _context0.v;
            if (version === sessionVersion) sharingError = _t1.message;
          case 7:
            _context0.p = 7;
            if (version === sessionVersion) {
              sharingBusy = false;
              render();
            }
            return _context0.f(7);
          case 8:
            return _context0.a(2);
        }
      }, _callee0, null, [[2, 6, 7, 8]]);
    }));
    return _updateSharingKey.apply(this, arguments);
  }
  function sharingSettings() {
    if (mobileHost || !can('site.orders.create')) return '';
    var endpoint = API + '/order-share/import';
    return "<section class=\"card site-sharing\"><h3>Goodnotes sharing</h3><p>Share a PDF into a new Site Order draft using an Apple Shortcut. Each iPad needs a one-time setup. You still complete and submit the order.</p>\n    ".concat(sharingError ? "<div class=\"notice\" role=\"alert\">".concat(esc(sharingError), "</div>") : '', "\n    <button type=\"button\" data-load-sharing ").concat(sharingBusy ? 'disabled' : '', ">").concat(sharingBusy ? 'Loading…' : sharingLoaded ? 'Refresh sharing keys' : 'Set up sharing', "</button>\n    ").concat(sharingLoaded ? "<ul>".concat(sharingKeys.map(function (key) {
      return "<li><form data-sharing-key data-sharing-id=\"".concat(esc(key.id), "\"><strong>").concat(esc(key.label), "</strong> \xB7 expires ").concat(esc(new Date(key.expiresAt).toLocaleDateString('en-AU')), " <button type=\"submit\" data-revoke-sharing=\"").concat(esc(key.id), "\" ").concat(sharingBusy ? 'disabled' : '', ">Remove</button></form></li>");
    }).join(''), "</ul><form data-sharing-key><label>Name this iPad<input name=\"label\" maxlength=\"60\" required value=\"").concat(esc(sharingLabel), "\" placeholder=\"e.g. Alex\u2019s iPad\" ").concat(sharingBusy ? 'disabled' : '', "></label><button type=\"submit\" ").concat(sharingBusy || sharingKeys.length >= 5 ? 'disabled' : '', ">Create Shortcut key</button></form>") : '', "\n    ").concat(sharingSecret ? "<label>Sharing key \u2014 copy into your own Shortcut<input data-sharing-secret readonly value=\"Bearer ".concat(esc(sharingSecret), "\" aria-label=\"Shortcut Authorization header\"></label><p>This key is shown only during this session. It cannot be retrieved after reloading or signing out. Keep your configured Shortcut private. Remove its key above to disconnect it.</p>") : '', "\n    <details><summary>One-time Shortcut setup</summary><p>In Apple Shortcuts, create \u201CNew Site Order\u201D. Open its Details and turn on <strong>Show in Share Sheet</strong>. Accept <strong>PDFs</strong> only. Set \u201CIf there\u2019s no input\u201D to <strong>Stop and Respond</strong>.</p><ol>\n    <li>Add <strong>Get Name</strong> for <strong>Shortcut Input</strong>, including the <code>.pdf</code> extension.</li>\n    <li>Add <strong>Base64 Encode</strong>, explicitly choosing <strong>Shortcut Input</strong> (not Name). Set line breaks to <strong>None</strong>.</li>\n    <li>Add <strong>Current Date</strong>, then <strong>Format Date</strong> using Custom format <code>yyyyMMddHHmmssSSS</code>. Add <strong>Random Number</strong> from 100000000 to 999999999, then a <strong>Text</strong> action combining <code>[Formatted Date]-[Random Number]</code>.</li>\n    <li>Add <strong>Get Contents of URL</strong> with this URL: <code>").concat(esc(endpoint), "</code>. Use <strong>POST</strong>, request body <strong>JSON</strong>. Add three text fields: <code>id</code> = the combined Text; <code>name</code> = Name; <code>data</code> = Base64 Encoded. Add the header <code>Authorization</code> with the full <code>Bearer \u2026</code> value shown above.</li>\n    <li>Add <strong>Get Dictionary Value</strong>: get <code>openUrl</code> from Contents of URL.</li>\n    <li>Add <strong>If</strong> Dictionary Value has any value, then <strong>Open URLs</strong> with that value. In Otherwise, <strong>Show Alert</strong> with Contents of URL. End If.</li>\n    </ol><p>In Goodnotes, export <strong>one PDF up to 5 MB</strong>, tap Share, then \u201CNew Site Order\u201D. Allow the Shortcut to connect to PanelStock. It opens Site Orders in Safari; sign in with the account that created the key if asked. The draft is also available under My drafts in the installed app. Other unfinished drafts are saved before opening it.</p><p>Each key lasts 90 days. Create a new key and update the Shortcut when it expires. Never share a Shortcut containing your key with other users; they should create their own.</p></details></section>");
  }
  function draftApi(_x2, _x3) {
    return _draftApi.apply(this, arguments);
  }
  function _draftApi() {
    _draftApi = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee1(path, body) {
      var response, result;
      return _regenerator().w(function (_context1) {
        while (1) switch (_context1.n) {
          case 0:
            _context1.n = 1;
            return api('/order-drafts' + path, body === undefined ? {} : {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(body)
            });
          case 1:
            response = _context1.v;
            _context1.n = 2;
            return response.json();
          case 2:
            result = _context1.v;
            if (response.ok) {
              _context1.n = 3;
              break;
            }
            throw Error(result.error || 'Draft could not be saved.');
          case 3:
            return _context1.a(2, result);
        }
      }, _callee1);
    }));
    return _draftApi.apply(this, arguments);
  }
  function loadCloudDrafts() {
    return _loadCloudDrafts.apply(this, arguments);
  }
  function _loadCloudDrafts() {
    _loadCloudDrafts = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee10() {
      var version, result, _t10;
      return _regenerator().w(function (_context10) {
        while (1) switch (_context10.p = _context10.n) {
          case 0:
            if (can('site.orders.create')) {
              _context10.n = 1;
              break;
            }
            cloudDrafts = [];
            return _context10.a(2);
          case 1:
            version = sessionVersion;
            _context10.p = 2;
            _context10.n = 3;
            return draftApi('');
          case 3:
            result = _context10.v;
            if (!(version !== sessionVersion)) {
              _context10.n = 4;
              break;
            }
            return _context10.a(2);
          case 4:
            cloudDrafts = result.drafts || [];
            cloudDraftError = '';
            _context10.n = 6;
            break;
          case 5:
            _context10.p = 5;
            _t10 = _context10.v;
            if (version === sessionVersion) cloudDraftError = _t10.message;
          case 6:
            return _context10.a(2);
        }
      }, _callee10, null, [[2, 5]]);
    }));
    return _loadCloudDrafts.apply(this, arguments);
  }
  function persistCloudDraft() {
    return _persistCloudDraft.apply(this, arguments);
  }
  function _persistCloudDraft() {
    _persistCloudDraft = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee11() {
      var _session33;
      var draft, owner, version, selected, order, result, remember, _iterator7, _step7, _loop5, _t11;
      return _regenerator().w(function (_context12) {
        while (1) switch (_context12.p = _context12.n) {
          case 0:
            captureDraft();
            draft = orderDraft && draftOwner === ((_session33 = session) === null || _session33 === void 0 ? void 0 : _session33.username) ? orderDraft : savedDraft();
            if (draft) {
              _context12.n = 1;
              break;
            }
            throw Error('No unfinished order to save.');
          case 1:
            owner = session.username, version = sessionVersion, selected = projects.find(function (project) {
              return (project.id || project.name) === draft.fields.projectId;
            }), order = _objectSpread(_objectSpread({}, draft.fields), {}, {
              project: (selected === null || selected === void 0 ? void 0 : selected.name) || draft.projectName || draft.fields.projectId || '',
              items: draft.items
            });
            _context12.n = 2;
            return draftApi('/' + draft.id, {
              order: order,
              attachmentIds: (draft.attachments || []).map(function (file) {
                return file.id;
              }),
              expectedUpdatedAt: draft.cloudUpdatedAt || ''
            });
          case 2:
            result = _context12.v;
            remember = function remember() {
              var _session34;
              if (((_session34 = session) === null || _session34 === void 0 ? void 0 : _session34.username) !== owner || sessionVersion !== version) throw Error('Your account changed.');
              draft.cloudUpdatedAt = result.draft.updatedAt;
              orderDraft = draft;
              draftOwner = owner;
              if (!writeDraft()) throw Error(draftNotice);
            };
            remember();
            _iterator7 = _createForOfIteratorHelper(draft.attachments || []);
            _context12.p = 3;
            _loop5 = /*#__PURE__*/_regenerator().m(function _loop5() {
              var _session35;
              var metadata, file, data;
              return _regenerator().w(function (_context11) {
                while (1) switch (_context11.n) {
                  case 0:
                    metadata = _step7.value;
                    if (!result.draft.attachments.some(function (file) {
                      return file.id === metadata.id;
                    })) {
                      _context11.n = 1;
                      break;
                    }
                    return _context11.a(2, 1);
                  case 1:
                    _context11.n = 2;
                    return attachmentDb('get', metadata.id);
                  case 2:
                    file = _context11.v;
                    if (file) {
                      _context11.n = 3;
                      break;
                    }
                    throw Error('A saved file is unavailable. Reattach it before saving to your account.');
                  case 3:
                    _context11.n = 4;
                    return attachmentData(file);
                  case 4:
                    data = _context11.v;
                    if (!(((_session35 = session) === null || _session35 === void 0 ? void 0 : _session35.username) !== owner || sessionVersion !== version)) {
                      _context11.n = 5;
                      break;
                    }
                    throw Error('Your account changed.');
                  case 5:
                    _context11.n = 6;
                    return draftApi('/' + draft.id + '/files', {
                      id: metadata.id,
                      name: metadata.name,
                      data: data,
                      expectedUpdatedAt: result.draft.updatedAt
                    });
                  case 6:
                    result = _context11.v;
                    remember();
                  case 7:
                    return _context11.a(2);
                }
              }, _loop5);
            });
            _iterator7.s();
          case 4:
            if ((_step7 = _iterator7.n()).done) {
              _context12.n = 7;
              break;
            }
            return _context12.d(_regeneratorValues(_loop5()), 5);
          case 5:
            if (!_context12.v) {
              _context12.n = 6;
              break;
            }
            return _context12.a(3, 6);
          case 6:
            _context12.n = 4;
            break;
          case 7:
            _context12.n = 9;
            break;
          case 8:
            _context12.p = 8;
            _t11 = _context12.v;
            _iterator7.e(_t11);
          case 9:
            _context12.p = 9;
            _iterator7.f();
            return _context12.f(9);
          case 10:
            _context12.n = 11;
            return loadCloudDrafts();
          case 11:
            return _context12.a(2, draft);
        }
      }, _callee11, null, [[3, 8, 9, 10]]);
    }));
    return _persistCloudDraft.apply(this, arguments);
  }
  function saveCloudDraft() {
    return _saveCloudDraft.apply(this, arguments);
  }
  function _saveCloudDraft() {
    _saveCloudDraft = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee12() {
      var _session36;
      var _t12;
      return _regenerator().w(function (_context13) {
        while (1) switch (_context13.p = _context13.n) {
          case 0:
            if (!busy) {
              _context13.n = 1;
              break;
            }
            return _context13.a(2);
          case 1:
            captureDraft();
            if (orderDraft && draftOwner === ((_session36 = session) === null || _session36 === void 0 ? void 0 : _session36.username)) orderDraft.explicitlySaved = true;
            if (navigator.onLine) {
              _context13.n = 3;
              break;
            }
            if (writeDraft()) {
              _context13.n = 2;
              break;
            }
            message = draftNotice;
            render();
            return _context13.a(2);
          case 2:
            message = 'Draft saved on this device. Connect and save again to make it available on Web.';
            discardDraftArmed = false;
            view = 'orders';
            render();
            return _context13.a(2);
          case 3:
            busy = true;
            render();
            _context13.p = 4;
            _context13.n = 5;
            return persistCloudDraft();
          case 5:
            message = 'Draft saved to your account, including files and photos.';
            discardDraftArmed = false;
            view = 'orders';
            _context13.n = 7;
            break;
          case 6:
            _context13.p = 6;
            _t12 = _context13.v;
            message = _t12.message;
          case 7:
            _context13.p = 7;
            busy = false;
            render();
            return _context13.f(7);
          case 8:
            return _context13.a(2);
        }
      }, _callee12, null, [[4, 6, 7, 8]]);
    }));
    return _saveCloudDraft.apply(this, arguments);
  }
  function openCloudDraft(_x4) {
    return _openCloudDraft.apply(this, arguments);
  }
  function _openCloudDraft() {
    _openCloudDraft = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee13(id) {
      var owner, version, local, _session37, saved, files, _iterator8, _step8, metadata, _result, restored, _t13, _t14, _t15;
      return _regenerator().w(function (_context14) {
        while (1) switch (_context14.p = _context14.n) {
          case 0:
            if (!busy) {
              _context14.n = 1;
              break;
            }
            return _context14.a(2);
          case 1:
            if (navigator.onLine) {
              _context14.n = 2;
              break;
            }
            message = 'Connect to open account drafts. Your device draft is available offline.';
            render();
            return _context14.a(2);
          case 2:
            captureDraft();
            owner = session.username, version = sessionVersion, local = listedDeviceDraft();
            if (!((local === null || local === void 0 ? void 0 : local.id) === id)) {
              _context14.n = 4;
              break;
            }
            _context14.n = 3;
            return openDraft();
          case 3:
            return _context14.a(2);
          case 4:
            busy = true;
            _context14.p = 5;
            if (!local) {
              _context14.n = 6;
              break;
            }
            _context14.n = 6;
            return persistCloudDraft();
          case 6:
            _context14.n = 7;
            return draftApi('/' + id);
          case 7:
            saved = _context14.v.draft;
            files = [];
            _iterator8 = _createForOfIteratorHelper(saved.attachments);
            _context14.p = 8;
            _iterator8.s();
          case 9:
            if ((_step8 = _iterator8.n()).done) {
              _context14.n = 12;
              break;
            }
            metadata = _step8.value;
            _context14.n = 10;
            return draftApi('/' + id + '/files/' + metadata.id);
          case 10:
            _result = _context14.v;
            files.push(_objectSpread(_objectSpread({}, metadata), {}, {
              file: new Blob([Uint8Array.from(atob(_result.file.data), function (c) {
                return c.charCodeAt(0);
              })], {
                type: 'application/octet-stream'
              })
            }));
          case 11:
            _context14.n = 9;
            break;
          case 12:
            _context14.n = 14;
            break;
          case 13:
            _context14.p = 13;
            _t13 = _context14.v;
            _iterator8.e(_t13);
          case 14:
            _context14.p = 14;
            _iterator8.f();
            return _context14.f(14);
          case 15:
            _context14.n = 16;
            return attachmentDb('put', files);
          case 16:
            if (!(sessionVersion !== version || ((_session37 = session) === null || _session37 === void 0 ? void 0 : _session37.username) !== owner)) {
              _context14.n = 17;
              break;
            }
            return _context14.a(2);
          case 17:
            restored = {
              id: saved.id,
              owner: owner,
              fields: saved.order,
              projectName: saved.order.project,
              items: saved.order.items.length ? saved.order.items : [{
                quantity: '1',
                description: ''
              }],
              attachments: saved.attachments,
              cloudUpdatedAt: saved.updatedAt,
              updatedAt: saved.updatedAt
            };
            _context14.p = 18;
            deviceStorage.setItem(DRAFT_KEY + owner, JSON.stringify(restored));
            _context14.n = 20;
            break;
          case 19:
            _context14.p = 19;
            _t14 = _context14.v;
            throw Error('Could not save this draft on the device. Free up storage and try again. Your account drafts are kept.');
          case 20:
            orderDraft = restored;
            draftOwner = owner;
            selectedOrderFiles = files;
            discardDraftArmed = false;
            orderValidationId = '';
            view = 'new';
            message = 'Account draft restored.';
            draftNotice = 'Saved to your account';
            _context14.n = 22;
            break;
          case 21:
            _context14.p = 21;
            _t15 = _context14.v;
            message = _t15.message;
          case 22:
            _context14.p = 22;
            busy = false;
            render();
            return _context14.f(22);
          case 23:
            return _context14.a(2);
        }
      }, _callee13, null, [[18, 19], [8, 13, 14, 15], [5, 21, 22, 23]]);
    }));
    return _openCloudDraft.apply(this, arguments);
  }
  function deleteCloudDraft(_x5) {
    return _deleteCloudDraft.apply(this, arguments);
  }
  function _deleteCloudDraft() {
    _deleteCloudDraft = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee14(id) {
      var draft, owner, version, local, _session38, _t16;
      return _regenerator().w(function (_context15) {
        while (1) switch (_context15.p = _context15.n) {
          case 0:
            if (!busy) {
              _context15.n = 1;
              break;
            }
            return _context15.a(2);
          case 1:
            if (!(cloudDiscardId !== id)) {
              _context15.n = 2;
              break;
            }
            cloudDiscardId = id;
            render();
            return _context15.a(2);
          case 2:
            draft = cloudDrafts.find(function (item) {
              return item.id === id;
            }), owner = session.username, version = sessionVersion;
            if (draft) {
              _context15.n = 3;
              break;
            }
            return _context15.a(2);
          case 3:
            busy = true;
            _context15.p = 4;
            _context15.n = 5;
            return draftApi('/' + id + '/discard', {
              expectedUpdatedAt: draft.updatedAt
            });
          case 5:
            local = savedDraft();
            if (!((local === null || local === void 0 ? void 0 : local.id) === id)) {
              _context15.n = 8;
              break;
            }
            _context15.n = 6;
            return attachmentDb('delete', local.attachments || []);
          case 6:
            if (!(sessionVersion !== version || ((_session38 = session) === null || _session38 === void 0 ? void 0 : _session38.username) !== owner)) {
              _context15.n = 7;
              break;
            }
            return _context15.a(2);
          case 7:
            deviceStorage.removeItem(DRAFT_KEY + owner);
            orderDraft = null;
            draftOwner = '';
            selectedOrderFiles = [];
          case 8:
            cloudDiscardId = '';
            _context15.n = 9;
            return loadCloudDrafts();
          case 9:
            message = 'Draft deleted.';
            _context15.n = 11;
            break;
          case 10:
            _context15.p = 10;
            _t16 = _context15.v;
            message = _t16.message;
          case 11:
            _context15.p = 11;
            busy = false;
            render();
            return _context15.f(11);
          case 12:
            return _context15.a(2);
        }
      }, _callee14, null, [[4, 10, 11, 12]]);
    }));
    return _deleteCloudDraft.apply(this, arguments);
  }
  function startNewSiteDraft() {
    return _startNewSiteDraft.apply(this, arguments);
  }
  function _startNewSiteDraft() {
    _startNewSiteDraft = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee15() {
      var local, _t17;
      return _regenerator().w(function (_context16) {
        while (1) switch (_context16.p = _context16.n) {
          case 0:
            if (!busy) {
              _context16.n = 1;
              break;
            }
            return _context16.a(2);
          case 1:
            busy = true;
            _context16.p = 2;
            local = listedDeviceDraft();
            if (!local) {
              _context16.n = 4;
              break;
            }
            if (navigator.onLine) {
              _context16.n = 3;
              break;
            }
            throw Error('Save or discard the current device draft before starting another offline.');
          case 3:
            _context16.n = 4;
            return persistCloudDraft();
          case 4:
            deviceStorage.removeItem(DRAFT_KEY + session.username);
            orderDraft = null;
            draftOwner = '';
            selectedOrderFiles = [];
            busy = false;
            _context16.n = 5;
            return openDraft();
          case 5:
            _context16.n = 7;
            break;
          case 6:
            _context16.p = 6;
            _t17 = _context16.v;
            busy = false;
            message = _t17.message;
            render();
          case 7:
            return _context16.a(2);
        }
      }, _callee15, null, [[2, 6]]);
    }));
    return _startNewSiteDraft.apply(this, arguments);
  }
  function copiedOrderDraft(order, owner) {
    var _order$items;
    var project = order.projectId ? projects.find(function (project) {
      return project.id === order.projectId;
    }) : projects.find(function (project) {
      return project.name === order.project;
    });
    return {
      id: crypto.randomUUID(),
      owner: owner,
      fields: {
        projectId: (project === null || project === void 0 ? void 0 : project.id) || (project === null || project === void 0 ? void 0 : project.name) || order.projectId || order.project || '',
        orderType: String(order.orderType || ''),
        orderTypeOther: order.orderType === 'Other' ? String(order.orderTypeOther || '') : '',
        siteContact: String(order.siteContact || ''),
        phone: String(order.phone || ''),
        locationNotes: String(order.locationNotes || ''),
        requestedDeliveryDate: '',
        requestedDeliveryTime: ''
      },
      projectName: String(order.project || ''),
      items: (_order$items = order.items) !== null && _order$items !== void 0 && _order$items.length ? order.items.map(function (item) {
        return {
          quantity: item.quantity,
          description: String(item.description || '').toUpperCase()
        };
      }) : [{
        quantity: '1',
        description: ''
      }],
      attachments: [],
      explicitlySaved: true,
      updatedAt: new Date().toISOString()
    };
  }
  function copyOrderToDraft(_x6) {
    return _copyOrderToDraft.apply(this, arguments);
  }
  function _copyOrderToDraft() {
    _copyOrderToDraft = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee16(id) {
      var original, owner, version, originView, originOrderId, opened, current, source, _result2$order, response, _result2, editing, candidate, fields, existing, _draft, _session40, _t18, _t19;
      return _regenerator().w(function (_context17) {
        while (1) switch (_context17.p = _context17.n) {
          case 0:
            if (!(busy || !session || !can('site.orders.view') || !can('site.orders.create'))) {
              _context17.n = 1;
              break;
            }
            return _context17.a(2);
          case 1:
            original = orders.find(function (order) {
              return order.id === id;
            });
            if (!(!original || original.local)) {
              _context17.n = 2;
              break;
            }
            return _context17.a(2);
          case 2:
            owner = session.username, version = sessionVersion, originView = view, originOrderId = selectedOrderId;
            opened = false;
            current = function current() {
              var _session39;
              return sessionVersion === version && ((_session39 = session) === null || _session39 === void 0 ? void 0 : _session39.username) === owner && view === originView && selectedOrderId === originOrderId && can('site.orders.view') && can('site.orders.create');
            };
            captureDraft();
            busy = true;
            message = '';
            render();
            _context17.p = 3;
            source = original;
            if (!navigator.onLine) {
              _context17.n = 9;
              break;
            }
            _context17.n = 4;
            return api('/orders/' + encodeURIComponent(id));
          case 4:
            response = _context17.v;
            _context17.n = 5;
            return response.json();
          case 5:
            _result2 = _context17.v;
            if (current()) {
              _context17.n = 6;
              break;
            }
            return _context17.a(2);
          case 6:
            if (response.ok) {
              _context17.n = 7;
              break;
            }
            throw Error(_result2.error || 'This order could not be loaded. Retry copying it.');
          case 7:
            if (!(((_result2$order = _result2.order) === null || _result2$order === void 0 ? void 0 : _result2$order.id) !== id)) {
              _context17.n = 8;
              break;
            }
            throw Error('The original order could not be verified. Refresh and try again.');
          case 8:
            source = _result2.order;
          case 9:
            if (current()) {
              _context17.n = 10;
              break;
            }
            return _context17.a(2);
          case 10:
            editing = orderDraft && draftOwner === owner && !(outbox.owner === owner && outbox.queue.some(function (packet) {
              return packet.idempotencyKey === orderDraft.id;
            })) ? orderDraft : null;
            candidate = editing || savedDraft(), fields = (candidate === null || candidate === void 0 ? void 0 : candidate.fields) || {};
            existing = listedDeviceDraft(candidate) || (candidate && (String(fields.orderType || '').trim() || fields.requestedDeliveryDate && fields.requestedDeliveryDate !== dateIso(new Date())) ? candidate : null);
            if (!existing) {
              _context17.n = 13;
              break;
            }
            if (navigator.onLine) {
              _context17.n = 11;
              break;
            }
            throw Error('Connect to save your current draft to your account before copying another order. You can also continue or discard that draft.');
          case 11:
            _context17.n = 12;
            return persistCloudDraft();
          case 12:
            if (current()) {
              _context17.n = 13;
              break;
            }
            return _context17.a(2);
          case 13:
            _draft = copiedOrderDraft(source, owner); // Persist the complete new draft before replacing any in-memory editing state.
            _context17.p = 14;
            deviceStorage.setItem(DRAFT_KEY + owner, JSON.stringify(_draft));
            _context17.n = 16;
            break;
          case 15:
            _context17.p = 15;
            _t18 = _context17.v;
            throw Error('The copy could not be saved on this device. Your current draft is kept. Free some storage and try again.');
          case 16:
            orderDraft = _draft;
            draftOwner = owner;
            selectedOrderFiles = [];
            discardDraftArmed = false;
            cloudDiscardId = '';
            deviceDiscardId = '';
            draftNotice = 'Draft saved on this device';
            view = 'new';
            opened = true;
            message = "Copied order #".concat(source.orderNumber, " into a new draft. Choose a new delivery date, check the contact and items, and attach current files before submitting.");
            if (existing) message += ' Your previous draft is saved to your account.';
            _context17.n = 18;
            break;
          case 17:
            _context17.p = 17;
            _t19 = _context17.v;
            if (current()) message = _t19.message;
          case 18:
            _context17.p = 18;
            if (version === sessionVersion && ((_session40 = session) === null || _session40 === void 0 ? void 0 : _session40.username) === owner) {
              busy = false;
              if (current() || opened) render();
            }
            return _context17.f(18);
          case 19:
            return _context17.a(2);
        }
      }, _callee16, null, [[14, 15], [3, 17, 18, 19]]);
    }));
    return _copyOrderToDraft.apply(this, arguments);
  }
  var TRASH_ICON = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6"/></svg>';
  function siteOrderContactDefaults() {
    var _profile, _profile2;
    return {
      siteContact: ((_profile = profile) === null || _profile === void 0 ? void 0 : _profile.displayName) || '',
      phone: ((_profile2 = profile) === null || _profile2 === void 0 ? void 0 : _profile2.phone) || ''
    };
  }
  function listedDeviceDraft() {
    var draft = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : savedDraft();
    if (!draft) return null;
    var fields = draft.fields || {},
      defaults = draft.contactDefaults || siteOrderContactDefaults();
    var edited = ['projectId', 'orderTypeOther', 'requestedDeliveryTime', 'locationNotes'].some(function (name) {
      return String(fields[name] || '').trim();
    }) || ['siteContact', 'phone'].some(function (name) {
      return String(fields[name] || '').trim() && fields[name] !== defaults[name];
    }) || (draft.items || []).some(function (item) {
      return String(item.description || '').trim();
    }) || (draft.attachments || []).length;
    return draft.explicitlySaved || draft.cloudUpdatedAt || edited ? draft : null;
  }
  function deleteDeviceDraft(_x7) {
    return _deleteDeviceDraft.apply(this, arguments);
  }
  function _deleteDeviceDraft() {
    _deleteDeviceDraft = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee17(id) {
      var draft, owner, version, _t20;
      return _regenerator().w(function (_context18) {
        while (1) switch (_context18.p = _context18.n) {
          case 0:
            if (!busy) {
              _context18.n = 1;
              break;
            }
            return _context18.a(2);
          case 1:
            draft = savedDraft();
            if (!(!draft || draft.id !== id)) {
              _context18.n = 2;
              break;
            }
            return _context18.a(2);
          case 2:
            if (!(deviceDiscardId !== id)) {
              _context18.n = 3;
              break;
            }
            deviceDiscardId = id;
            render();
            return _context18.a(2);
          case 3:
            owner = session.username, version = sessionVersion;
            _context18.p = 4;
            deviceStorage.removeItem(DRAFT_KEY + owner);
            _context18.n = 6;
            break;
          case 5:
            _context18.p = 5;
            _t20 = _context18.v;
            message = 'Could not delete this device draft. Try again.';
            render();
            return _context18.a(2);
          case 6:
            orderDraft = null;
            draftOwner = '';
            selectedOrderFiles = [];
            deviceDiscardId = '';
            message = 'Draft deleted.';
            render();
            _context18.n = 7;
            return attachmentDb('delete', draft.attachments || []).catch(function () {});
          case 7:
            if (!(version !== sessionVersion)) {
              _context18.n = 8;
              break;
            }
            return _context18.a(2);
          case 8:
            return _context18.a(2);
        }
      }, _callee17, null, [[4, 5]]);
    }));
    return _deleteDeviceDraft.apply(this, arguments);
  }
  function draftCount() {
    var ids = new Set(cloudDrafts.map(function (draft) {
        return draft.id;
      })),
      local = listedDeviceDraft();
    if (local) ids.add(local.id);
    return ids.size;
  }
  function cloudDraftView() {
    var _projects$find;
    var local = listedDeviceDraft(),
      deviceOnly = local && !cloudDrafts.some(function (draft) {
        return draft.id === local.id;
      });
    var savedAt = function savedAt(value) {
      return esc(new Date(value).toLocaleString('en-AU', {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'Australia/Brisbane'
      }));
    };
    return "<header class=\"site-drafts-header\"><div><h2>My drafts</h2><span>".concat(draftCount(), " saved</span></div><div class=\"actions\"><button data-orders>Back to orders</button><button class=\"primary\" data-new-empty>+ New order</button></div></header><p class=\"site-drafts-help\">Private drafts. Continue when you\u2019re ready to submit.</p>").concat(message ? "<div class=\"notice\">".concat(esc(message), "</div>") : '').concat(cloudDraftError ? "<div class=\"notice\">".concat(esc(cloudDraftError), " <button data-refresh-drafts>Retry</button></div>") : '', "<section class=\"site-drafts-list\">\n    ").concat(deviceOnly ? "<article class=\"card site-draft-card\"><div class=\"site-draft-top\"><span class=\"site-draft-type\">".concat(esc(local.fields.orderType || 'Other'), "</span><span class=\"site-draft-location\">On this device</span></div><h3>").concat(esc(local.projectName || ((_projects$find = projects.find(function (p) {
      return (p.id || p.name) === local.fields.projectId;
    })) === null || _projects$find === void 0 ? void 0 : _projects$find.name) || 'Untitled draft'), "</h3><p>Saved ").concat(savedAt(local.updatedAt), "</p><div class=\"actions\"><button class=\"primary\" data-new>Continue draft</button><button type=\"button\" class=\"site-draft-delete\" data-delete-device-draft=\"").concat(esc(local.id), "\" aria-label=\"Delete device draft\" title=\"Delete draft\" ").concat(busy ? 'disabled' : '', ">").concat(TRASH_ICON, "</button></div>").concat(deviceDiscardId === local.id ? "<div class=\"notice\">Delete this device draft and its files? <button data-delete-device-draft=\"".concat(esc(local.id), "\">Yes, delete</button><button data-keep-device-draft>Keep draft</button></div>") : '', " </article>") : '', "\n    ").concat(cloudDrafts.map(function (draft) {
      return "<article class=\"card site-draft-card\"><div class=\"site-draft-top\"><span class=\"site-draft-type\">".concat(esc(draft.orderType || 'Other'), "</span><span class=\"site-draft-location\">Account saved</span></div><h3>").concat(esc(draft.project || 'Untitled draft'), "</h3><p class=\"site-draft-summary\">").concat(draft.itemCount, " item").concat(draft.itemCount === 1 ? '' : 's', " \xB7 ").concat(draft.fileCount, " file").concat(draft.fileCount === 1 ? '' : 's', "</p><p class=\"site-draft-date\">Saved ").concat(savedAt(draft.updatedAt), "</p><div class=\"actions\"><button class=\"primary\" data-cloud-draft=\"").concat(esc(draft.id), "\" ").concat(busy ? 'disabled' : '', ">Continue draft</button><button class=\"site-draft-delete\" data-delete-cloud-draft=\"").concat(esc(draft.id), "\" ").concat(busy ? 'disabled' : '', " aria-label=\"Delete account draft\" title=\"Delete draft\">").concat(TRASH_ICON, "</button></div>").concat(cloudDiscardId === draft.id ? "<div class=\"notice\">Delete this draft and its files? <button data-delete-cloud-draft=\"".concat(esc(draft.id), "\">Yes, delete</button><button data-keep-cloud-draft>Keep draft</button></div>") : '', "</article>");
    }).join(''), "\n    ").concat(!deviceOnly && !cloudDrafts.length ? '<div class="card site-drafts-empty"><strong>No drafts yet</strong><p>Start an order and choose Save draft to finish it later.</p></div>' : '', "</section>");
  }
  function savedDraft() {
    if (!session) return null;
    var draft = read(DRAFT_KEY + session.username, null);
    if (!draft || draft.owner !== session.username) return null;
    if (outbox.owner === session.username && outbox.queue.some(function (packet) {
      return packet.idempotencyKey === draft.id;
    })) return null;
    return draft;
  }
  function writeDraft() {
    var _session4;
    if (!orderDraft || draftOwner !== ((_session4 = session) === null || _session4 === void 0 ? void 0 : _session4.username)) return false;
    try {
      deviceStorage.setItem(DRAFT_KEY + draftOwner, JSON.stringify(orderDraft));
      draftNotice = 'Draft saved on this device';
      return true;
    } catch (_unused) {
      draftNotice = 'Draft could not be saved. Keep this page open and free up device storage.';
      return false;
    }
  }
  function captureDraft() {
    var _session5, _form$dataset;
    var form = root.querySelector('[data-order]');
    if (!form || restoringDraft || !orderDraft || draftOwner !== ((_session5 = session) === null || _session5 === void 0 ? void 0 : _session5.username)) return;
    if ((_form$dataset = form.dataset) !== null && _form$dataset !== void 0 && _form$dataset.draftId && form.dataset.draftId !== orderDraft.id) return;
    orderDraft.fields = Object.fromEntries(draftFields.map(function (name) {
      var _form$querySelector;
      return [name, ((_form$querySelector = form.querySelector('[name="' + name + '"]')) === null || _form$querySelector === void 0 ? void 0 : _form$querySelector.value) || ''];
    }));
    orderDraft.items = _toConsumableArray(form.querySelectorAll('.item')).map(function (row) {
      return {
        quantity: row.querySelector('[name=quantity]').value,
        description: row.querySelector('[name=description]').value.toUpperCase()
      };
    });
    orderDraft.attachments = selectedOrderFiles.map(function (_ref) {
      var file = _ref.file,
        missing = _ref.missing,
        metadata = _objectWithoutProperties(_ref, _excluded);
      return metadata;
    });
    orderDraft.updatedAt = new Date().toISOString();
    writeDraft();
    var notice = root.querySelector('[data-draft-notice]');
    if (notice) notice.textContent = draftNotice;
  }
  function openDraft() {
    return _openDraft.apply(this, arguments);
  }
  function _openDraft() {
    _openDraft = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee19() {
      var owner, version, _session43, _draft2, _session42, _session41, _result3$profile, response, _result3, files, _t22;
      return _regenerator().w(function (_context20) {
        while (1) switch (_context20.p = _context20.n) {
          case 0:
            if (!busy) {
              _context20.n = 1;
              break;
            }
            return _context20.a(2);
          case 1:
            orderValidationId = '';
            owner = session.username, version = sessionVersion;
            busy = true;
            _context20.p = 2;
            _draft2 = orderDraft && draftOwner === owner ? orderDraft : savedDraft();
            if (!(!_draft2 && navigator.onLine)) {
              _context20.n = 9;
              break;
            }
            _context20.p = 3;
            _context20.n = 4;
            return api('/profile');
          case 4:
            response = _context20.v;
            _context20.n = 5;
            return response.json();
          case 5:
            _result3 = _context20.v;
            if (!(sessionVersion !== version || ((_session41 = session) === null || _session41 === void 0 ? void 0 : _session41.username) !== owner)) {
              _context20.n = 6;
              break;
            }
            return _context20.a(2);
          case 6:
            if (response.ok && ((_result3$profile = _result3.profile) === null || _result3$profile === void 0 ? void 0 : _result3$profile.username) === owner) profile = _result3.profile;
            _context20.n = 8;
            break;
          case 7:
            _context20.p = 7;
            _t22 = _context20.v;
          case 8:
            if (!(sessionVersion !== version || ((_session42 = session) === null || _session42 === void 0 ? void 0 : _session42.username) !== owner)) {
              _context20.n = 9;
              break;
            }
            return _context20.a(2);
          case 9:
            orderDraft = _draft2 || {
              id: crypto.randomUUID(),
              owner: owner,
              fields: {},
              contactDefaults: siteOrderContactDefaults(),
              items: [{
                quantity: '1',
                description: ''
              }],
              attachments: [],
              updatedAt: new Date().toISOString()
            };
            draftOwner = owner;
            _context20.n = 10;
            return Promise.all((orderDraft.attachments || []).map(/*#__PURE__*/function () {
              var _ref36 = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee18(metadata) {
                var file, _t21;
                return _regenerator().w(function (_context19) {
                  while (1) switch (_context19.p = _context19.n) {
                    case 0:
                      _context19.p = 0;
                      _context19.n = 1;
                      return attachmentDb('get', metadata.id);
                    case 1:
                      file = _context19.v;
                      return _context19.a(2, _objectSpread(_objectSpread({}, metadata), {}, {
                        file: file,
                        missing: !file
                      }));
                    case 2:
                      _context19.p = 2;
                      _t21 = _context19.v;
                      return _context19.a(2, _objectSpread(_objectSpread({}, metadata), {}, {
                        missing: true
                      }));
                  }
                }, _callee18, null, [[0, 2]]);
              }));
              return function (_x48) {
                return _ref36.apply(this, arguments);
              };
            }()));
          case 10:
            files = _context20.v;
            if (!(sessionVersion !== version || ((_session43 = session) === null || _session43 === void 0 ? void 0 : _session43.username) !== owner)) {
              _context20.n = 11;
              break;
            }
            return _context20.a(2);
          case 11:
            selectedOrderFiles = files;
            discardDraftArmed = false;
            view = 'new';
            message = files.some(function (file) {
              return file.missing;
            }) ? 'Some saved files are unavailable. Remove them and attach them again before submitting.' : '';
            draftNotice = _draft2 ? 'Restored draft from this device' : 'Your draft saves automatically on this device';
            busy = false;
            render();
            captureDraft();
          case 12:
            _context20.p = 12;
            busy = false;
            return _context20.f(12);
          case 13:
            return _context20.a(2);
        }
      }, _callee19, null, [[3, 7], [2,, 12, 13]]);
    }));
    return _openDraft.apply(this, arguments);
  }
  function restoreDraftForm() {
    var form = root.querySelector('[data-order]');
    if (!form) return;
    restoringDraft = true;
    try {
      var _orderDraft3;
      var _loop = function _loop() {
        var _Object$entries$_i = _slicedToArray(_Object$entries[_i], 2),
          name = _Object$entries$_i[0],
          value = _Object$entries$_i[1];
        var input = form.querySelector('[name="' + name + '"]');
        if (!input) return 1; // continue
        if (input.tagName === 'SELECT' && value && !_toConsumableArray(input.options).some(function (option) {
          return option.value === value;
        })) {
          var _orderDraft2;
          var option = document.createElement('option');
          option.value = value;
          option.textContent = (name === 'projectId' ? ((_orderDraft2 = orderDraft) === null || _orderDraft2 === void 0 ? void 0 : _orderDraft2.projectName) || value : value) + ' (unavailable — choose another)';
          option.disabled = true;
          input.appendChild(option);
        }
        input.value = value;
      };
      for (var _i = 0, _Object$entries = Object.entries(((_orderDraft = orderDraft) === null || _orderDraft === void 0 ? void 0 : _orderDraft.fields) || {}); _i < _Object$entries.length; _i++) {
        var _orderDraft;
        if (_loop()) continue;
      }
      var date = form.querySelector('[name=requestedDeliveryDate]'),
        label = form.querySelector('[data-date-picker] span');
      if (date && label) label.textContent = date.value ? formatDate(date.value) : 'Choose date';
      var _iterator = _createForOfIteratorHelper(((_orderDraft3 = orderDraft) === null || _orderDraft3 === void 0 ? void 0 : _orderDraft3.items) || [{
          quantity: '1',
          description: ''
        }]),
        _step;
      try {
        for (_iterator.s(); !(_step = _iterator.n()).done;) {
          var item = _step.value;
          var row = addItem();
          row.querySelector('[name=quantity]').value = item.quantity;
          row.querySelector('[name=description]').value = String(item.description || '').toUpperCase();
        }
      } catch (err) {
        _iterator.e(err);
      } finally {
        _iterator.f();
      }
      updateItemRequirements();
    } finally {
      restoringDraft = false;
    }
    form.addEventListener('input', captureDraft);
    form.addEventListener('change', captureDraft);
  }
  function discardDraft() {
    return _discardDraft.apply(this, arguments);
  }
  function _discardDraft() {
    _discardDraft = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee20() {
      var _orderDraft9;
      var owner, version, files, _t23, _t24;
      return _regenerator().w(function (_context21) {
        while (1) switch (_context21.p = _context21.n) {
          case 0:
            if (!busy) {
              _context21.n = 1;
              break;
            }
            return _context21.a(2);
          case 1:
            if (discardDraftArmed) {
              _context21.n = 2;
              break;
            }
            discardDraftArmed = true;
            render();
            return _context21.a(2);
          case 2:
            owner = draftOwner, version = sessionVersion, files = selectedOrderFiles;
            captureDraft();
            if (!((_orderDraft9 = orderDraft) !== null && _orderDraft9 !== void 0 && _orderDraft9.cloudUpdatedAt)) {
              _context21.n = 7;
              break;
            }
            _context21.p = 3;
            _context21.n = 4;
            return draftApi('/' + orderDraft.id + '/discard', {
              expectedUpdatedAt: orderDraft.cloudUpdatedAt
            });
          case 4:
            _context21.n = 5;
            return loadCloudDrafts();
          case 5:
            _context21.n = 7;
            break;
          case 6:
            _context21.p = 6;
            _t23 = _context21.v;
            message = _t23.message;
            render();
            return _context21.a(2);
          case 7:
            _context21.p = 7;
            deviceStorage.removeItem(DRAFT_KEY + owner);
            _context21.n = 9;
            break;
          case 8:
            _context21.p = 8;
            _t24 = _context21.v;
            draftNotice = 'Could not discard the saved draft. Try again.';
            render();
            return _context21.a(2);
          case 9:
            orderDraft = null;
            draftOwner = '';
            selectedOrderFiles = [];
            discardDraftArmed = false;
            view = 'orders';
            message = 'Draft discarded.';
            render();
            _context21.n = 10;
            return attachmentDb('delete', files).catch(function () {});
          case 10:
            return _context21.a(2);
        }
      }, _callee20, null, [[7, 8], [3, 6]]);
    }));
    return _discardDraft.apply(this, arguments);
  }
  function pendingOrders() {
    return outbox.owner === session.username ? outbox.queue.map(function (packet) {
      return _objectSpread(_objectSpread({}, packet.order), {}, {
        id: packet.localId,
        savedOrderId: packet.orderId || '',
        orderNumber: packet.orderId ? packet.order.orderNumber : 'Pending',
        status: packet.orderId ? 'uploading files' : 'waiting to sync',
        createdAt: packet.createdAt,
        attachments: packet.attachments || [],
        local: true
      });
    }) : [];
  }
  var submissionState = {},
    fileRecovery = {};
  var productionState = {},
    productionRequest = 0;
  var notificationOrderState = {},
    notificationOrderRequest = 0;
  var orderReturnView = 'orders',
    orderQuery = '',
    orderProject = '',
    orderRequester = '',
    orderDelivery = '',
    historyState = {};
  var notificationBusy = false,
    notificationError = '',
    notificationLoaded = false,
    notificationRequest = 0,
    clearNotificationsArmed = false;
  var orderAlerts = [],
    statusConflict = null,
    statusSaving = false,
    statusChoices = {};
  var isPanelOrder = function isPanelOrder(order) {
    return String(order.orderType || '').trim().toLowerCase() === 'panels';
  };
  var orderStatusLabel = function orderStatusLabel(status) {
    return {
      submitted: 'Submitted',
      approved: 'Approved',
      ordered: 'Ordered',
      in_stock: 'In stock',
      completed: 'Ready for dispatch',
      dispatched: 'Dispatched',
      cancelled: 'Cancelled'
    }[status] || String(status);
  };
  var BELL_ICON = '<svg aria-hidden="true" viewBox="0 0 24 24"><path fill="currentColor" d="M20 17.25c-1.35-1.45-2-3.13-2-5.25V9a6 6 0 0 0-12 0v3c0 2.12-.65 3.8-2 5.25-.58.63-.13 1.65.72 1.65h14.56c.85 0 1.3-1.02.72-1.65Z"/><path fill="currentColor" d="M9.6 20a2.6 2.6 0 0 0 4.8 0H9.6Z"/></svg>';
  function notificationBell() {
    var unread = orderAlerts.filter(function (item) {
      return !item.read;
    }).length;
    return "<button type=\"button\" class=\"site-notification-bell\" data-notifications aria-label=\"".concat(unread ? unread + ' unread notifications' : 'Notifications', "\" aria-pressed=\"").concat(view === 'notifications', "\"><span class=\"site-bell-icon\">").concat(BELL_ICON).concat(unread ? "<span class=\"site-bell-count\" aria-hidden=\"true\">".concat(unread > 99 ? '99+' : unread, "</span>") : '', "</span></button>");
  }
  function updateNotificationUI() {
    var bell = root.querySelector('[data-notifications]');
    if (bell) {
      bell.outerHTML = notificationBell();
      wireNotificationBell();
    }
    if (view === 'notifications') render();
  }
  function wireNotificationBell() {
    var _root$querySelector;
    (_root$querySelector = root.querySelector('[data-notifications]')) === null || _root$querySelector === void 0 || _root$querySelector.addEventListener('click', function () {
      captureDraft();
      captureReceipt();
      view = 'notifications';
      notificationError = '';
      clearNotificationsArmed = false;
      render();
      void pollOrderAlerts(true);
    });
  }
  function pollOrderAlerts() {
    return _pollOrderAlerts.apply(this, arguments);
  }
  function _pollOrderAlerts() {
    _pollOrderAlerts = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee21() {
      var showError,
        version,
        request,
        response,
        _result4,
        _args22 = arguments,
        _t25;
      return _regenerator().w(function (_context22) {
        while (1) switch (_context22.p = _context22.n) {
          case 0:
            showError = _args22.length > 0 && _args22[0] !== undefined ? _args22[0] : false;
            if (!(!session || document.hidden || notificationBusy)) {
              _context22.n = 1;
              break;
            }
            return _context22.a(2);
          case 1:
            version = sessionVersion, request = ++notificationRequest;
            _context22.p = 2;
            _context22.n = 3;
            return api('/notifications');
          case 3:
            response = _context22.v;
            _context22.n = 4;
            return response.json();
          case 4:
            _result4 = _context22.v;
            if (response.ok) {
              _context22.n = 5;
              break;
            }
            throw Error(_result4.error || 'Notifications could not be loaded.');
          case 5:
            if (!(version !== sessionVersion || request !== notificationRequest)) {
              _context22.n = 6;
              break;
            }
            return _context22.a(2);
          case 6:
            orderAlerts = _result4.notifications || [];
            notificationLoaded = true;
            notificationError = '';
            updateNotificationUI();
            _context22.n = 8;
            break;
          case 7:
            _context22.p = 7;
            _t25 = _context22.v;
            if (version === sessionVersion && request === notificationRequest && showError) {
              notificationError = _t25.message;
              updateNotificationUI();
            }
          case 8:
            return _context22.a(2);
        }
      }, _callee21, null, [[2, 7]]);
    }));
    return _pollOrderAlerts.apply(this, arguments);
  }
  function markNotifications(_x8) {
    return _markNotifications.apply(this, arguments);
  }
  function _markNotifications() {
    _markNotifications = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee22(id) {
      var version, response, _result5, _t26;
      return _regenerator().w(function (_context23) {
        while (1) switch (_context23.p = _context23.n) {
          case 0:
            if (!(notificationBusy || !session)) {
              _context23.n = 1;
              break;
            }
            return _context23.a(2, false);
          case 1:
            version = sessionVersion;
            notificationBusy = true;
            notificationRequest++;
            notificationError = '';
            render();
            _context23.p = 2;
            _context23.n = 3;
            return api('/notifications/read', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(id ? {
                id: id
              } : {})
            });
          case 3:
            response = _context23.v;
            _context23.n = 4;
            return response.json();
          case 4:
            _result5 = _context23.v;
            if (response.ok) {
              _context23.n = 5;
              break;
            }
            throw Error(_result5.error || 'Could not mark notifications read.');
          case 5:
            if (!(version !== sessionVersion)) {
              _context23.n = 6;
              break;
            }
            return _context23.a(2, false);
          case 6:
            orderAlerts = _result5.notifications || [];
            return _context23.a(2, true);
          case 7:
            _context23.p = 7;
            _t26 = _context23.v;
            if (version === sessionVersion) notificationError = _t26.message;
            return _context23.a(2, false);
          case 8:
            _context23.p = 8;
            if (version === sessionVersion) {
              notificationBusy = false;
              render();
            }
            return _context23.f(8);
          case 9:
            return _context23.a(2);
        }
      }, _callee22, null, [[2, 7, 8, 9]]);
    }));
    return _markNotifications.apply(this, arguments);
  }
  function clearNotifications() {
    return _clearNotifications.apply(this, arguments);
  }
  function _clearNotifications() {
    _clearNotifications = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee23() {
      var version, response, _result6, _t27;
      return _regenerator().w(function (_context24) {
        while (1) switch (_context24.p = _context24.n) {
          case 0:
            if (!(notificationBusy || !session)) {
              _context24.n = 1;
              break;
            }
            return _context24.a(2);
          case 1:
            if (clearNotificationsArmed) {
              _context24.n = 2;
              break;
            }
            clearNotificationsArmed = true;
            render();
            return _context24.a(2);
          case 2:
            version = sessionVersion;
            notificationBusy = true;
            notificationRequest++;
            render();
            _context24.p = 3;
            _context24.n = 4;
            return api('/notifications/clear', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: '{}'
            });
          case 4:
            response = _context24.v;
            _context24.n = 5;
            return response.json();
          case 5:
            _result6 = _context24.v;
            if (response.ok) {
              _context24.n = 6;
              break;
            }
            throw Error(_result6.error || 'Notifications could not be cleared.');
          case 6:
            if (!(version !== sessionVersion)) {
              _context24.n = 7;
              break;
            }
            return _context24.a(2);
          case 7:
            orderAlerts = _result6.notifications || [];
            clearNotificationsArmed = false;
            notificationError = '';
            _context24.n = 9;
            break;
          case 8:
            _context24.p = 8;
            _t27 = _context24.v;
            if (version === sessionVersion) notificationError = _t27.message;
          case 9:
            _context24.p = 9;
            if (version === sessionVersion) {
              notificationBusy = false;
              render();
            }
            return _context24.f(9);
          case 10:
            return _context24.a(2);
        }
      }, _callee23, null, [[3, 8, 9, 10]]);
    }));
    return _clearNotifications.apply(this, arguments);
  }
  function notificationTarget(item) {
    var link = item.link || item.kind;
    return link === 'orders' && can('site.orders.view') ? 'orders' : link === 'cnc' && can('site.cnc.view') ? 'cnc' : link === 'support' ? 'support' : link === 'settings' ? 'settings' : '';
  }
  function notificationOrderId(item) {
    return notificationTarget(item) === 'orders' && typeof item.orderId === 'string' && /^[a-zA-Z0-9-]{16,100}$/.test(item.orderId) ? item.orderId : '';
  }
  function openNotification(_x9) {
    return _openNotification.apply(this, arguments);
  }
  function _openNotification() {
    _openNotification = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee24(id) {
      var item, version, origin, orderId, target, _t28;
      return _regenerator().w(function (_context25) {
        while (1) switch (_context25.n) {
          case 0:
            item = orderAlerts.find(function (value) {
              return value.id === id;
            }), version = sessionVersion, origin = view;
            if (!(!item || notificationBusy)) {
              _context25.n = 1;
              break;
            }
            return _context25.a(2);
          case 1:
            _t28 = !item.read;
            if (!_t28) {
              _context25.n = 3;
              break;
            }
            _context25.n = 2;
            return markNotifications(id);
          case 2:
            _t28 = !_context25.v;
          case 3:
            if (!_t28) {
              _context25.n = 4;
              break;
            }
            return _context25.a(2);
          case 4:
            if (!(version !== sessionVersion || view !== origin)) {
              _context25.n = 5;
              break;
            }
            return _context25.a(2);
          case 5:
            orderId = notificationOrderId(item);
            if (!orderId) {
              _context25.n = 7;
              break;
            }
            orderReturnView = 'notifications';
            selectedOrderId = orderId;
            view = 'order';
            message = '';
            historyState = {};
            productionState = {};
            _context25.n = 6;
            return loadNotificationOrder(orderId);
          case 6:
            return _context25.a(2);
          case 7:
            target = notificationTarget(item);
            if (target) {
              view = target;
              message = '';
              if (target === 'support') supportSelected = '';
              render();
            }
          case 8:
            return _context25.a(2);
        }
      }, _callee24);
    }));
    return _openNotification.apply(this, arguments);
  }
  function loadNotificationOrder(_x0) {
    return _loadNotificationOrder.apply(this, arguments);
  }
  function _loadNotificationOrder() {
    _loadNotificationOrder = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee25(id) {
      var version, request, current, _result7$order, response, _result7, _t29;
      return _regenerator().w(function (_context26) {
        while (1) switch (_context26.p = _context26.n) {
          case 0:
            if (!(!session || !can('site.orders.view'))) {
              _context26.n = 1;
              break;
            }
            return _context26.a(2);
          case 1:
            version = sessionVersion, request = ++notificationOrderRequest;
            current = function current() {
              return version === sessionVersion && request === notificationOrderRequest && view === 'order' && selectedOrderId === id;
            };
            notificationOrderState = {
              id: id,
              loading: true
            };
            render();
            _context26.p = 2;
            _context26.n = 3;
            return api('/orders/' + encodeURIComponent(id));
          case 3:
            response = _context26.v;
            _context26.n = 4;
            return response.json();
          case 4:
            _result7 = _context26.v;
            if (current()) {
              _context26.n = 5;
              break;
            }
            return _context26.a(2);
          case 5:
            if (!(response.status === 404)) {
              _context26.n = 6;
              break;
            }
            throw Error('This order is no longer available. Return to notifications or refresh and try again.');
          case 6:
            if (response.ok) {
              _context26.n = 7;
              break;
            }
            throw Error(_result7.error || 'This order could not be loaded.');
          case 7:
            if (!(((_result7$order = _result7.order) === null || _result7$order === void 0 ? void 0 : _result7$order.id) !== id)) {
              _context26.n = 8;
              break;
            }
            throw Error('This order could not be loaded.');
          case 8:
            orders = [_result7.order].concat(_toConsumableArray(orders.filter(function (order) {
              return order.id !== id;
            })));
            notificationOrderState = {
              id: id
            };
            render();
            void loadOrderHistory(id);
            void loadProductionProgress(id);
            _context26.n = 10;
            break;
          case 9:
            _context26.p = 9;
            _t29 = _context26.v;
            if (current()) {
              notificationOrderState = {
                id: id,
                error: _t29.message || 'This order could not be loaded.'
              };
              render();
            }
          case 10:
            return _context26.a(2);
        }
      }, _callee25, null, [[2, 9]]);
    }));
    return _loadNotificationOrder.apply(this, arguments);
  }
  function wireOrderAlerts() {
    var _root$querySelector2, _root$querySelector3, _root$querySelector4, _root$querySelector5;
    wireNotificationBell();
    (_root$querySelector2 = root.querySelector('[data-refresh-notifications]')) === null || _root$querySelector2 === void 0 || _root$querySelector2.addEventListener('click', function () {
      void pollOrderAlerts(true);
    });
    (_root$querySelector3 = root.querySelector('[data-read-all-alerts]')) === null || _root$querySelector3 === void 0 || _root$querySelector3.addEventListener('click', function () {
      void markNotifications();
    });
    (_root$querySelector4 = root.querySelector('[data-clear-notifications]')) === null || _root$querySelector4 === void 0 || _root$querySelector4.addEventListener('click', clearNotifications);
    (_root$querySelector5 = root.querySelector('[data-keep-notifications]')) === null || _root$querySelector5 === void 0 || _root$querySelector5.addEventListener('click', function () {
      clearNotificationsArmed = false;
      render();
    });
    root.querySelectorAll('[data-open-notification]').forEach(function (button) {
      return button.onclick = function () {
        return openNotification(button.dataset.openNotification);
      };
    });
  }
  function orderAlertsView() {
    var unread = orderAlerts.filter(function (item) {
      return !item.read;
    }).length;
    return "<section class=\"site-notifications\"><header class=\"site-notifications-header\"><div class=\"site-notifications-heading\"><span class=\"site-notifications-heading-icon\">".concat(BELL_ICON, "</span><div><h2>Notifications</h2><p>Order updates, delivery changes and important account activity</p></div></div></header><div class=\"site-notifications-tools\"><span>").concat(unread ? unread + ' unread' : "You’re up to date", "</span><div class=\"actions\">").concat(unread ? "<button data-read-all-alerts ".concat(notificationBusy ? 'disabled' : '', ">Mark all as read</button>") : '').concat(orderAlerts.length ? "<button class=\"site-notifications-clear\" data-clear-notifications ".concat(notificationBusy ? 'disabled' : '', ">").concat(clearNotificationsArmed ? 'Yes, clear all' : 'Clear', "</button>") : '', "</div></div>").concat(notificationError ? "<div class=\"notice\" role=\"alert\">".concat(esc(notificationError), " <button data-refresh-notifications>Retry</button></div>") : '').concat(clearNotificationsArmed ? "<div class=\"notice\" role=\"alert\">Permanently remove all notifications from your account? This cannot be undone. <button data-keep-notifications>Keep notifications</button></div>" : '', "<div class=\"site-notifications-list\">").concat(orderAlerts.map(function (item) {
      return "<button type=\"button\" class=\"site-notification-card ".concat(item.read ? 'is-read' : 'is-unread', " ").concat(item.priority === 'urgent' ? 'is-urgent' : item.priority === 'important' ? 'is-important' : '', "\" data-open-notification=\"").concat(esc(item.id), "\" ").concat(notificationBusy ? 'disabled' : '', "><span class=\"site-notification-title\"><strong>").concat(esc(item.title), "</strong>").concat(!item.read ? '<span class="site-unread-dot" aria-label="Unread"></span>' : '', "</span><span class=\"site-notification-message\">").concat(esc(item.message), "</span>").concat(notificationOrderId(item) ? '<span class="site-notification-message">Open order details →</span>' : '', "<time>").concat(esc(new Date(item.createdAt).toLocaleString('en-AU', {
        timeZone: 'Australia/Brisbane'
      })), "</time></button>");
    }).join('') || "<div class=\"card empty ".concat(!notificationLoaded && !notificationError ? 'site-notifications-loading' : '', "\">").concat(notificationLoaded ? 'No notifications yet.' : notificationError ? 'Connect and retry to load notifications.' : 'Loading notifications…', "</div>"), "</div></section>");
  }
  function statusConflictView() {
    if (!statusConflict) return '';
    var _statusConflict = statusConflict,
      order = _statusConflict.order,
      status = _statusConflict.status;
    return "<section class=\"card\" role=\"alert\"><h3>Order changed</h3><p>#".concat(esc(order.orderNumber), " was updated by ").concat(esc(order.updatedBy || 'another user'), ". Current status: <strong>").concat(esc(order.status), "</strong>. Your choice: <strong>").concat(esc(status), "</strong>.</p>").concat(deliverySummary(order), "<p>Your status change has not been saved.</p>").concat(['completed', 'dispatched'].includes(order.status) ? '<p>Ready or dispatched order status is locked here. Use Dispatch to send a ready order.</p>' : '<button data-retry-status>Apply my status to this version</button>', "<button data-cancel-status>Keep latest status</button></section>");
  }
  function changeOrderStatus(_x1, _x10) {
    return _changeOrderStatus.apply(this, arguments);
  }
  function _changeOrderStatus() {
    _changeOrderStatus = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee26(order, status) {
      var version, response, _result8, _t30;
      return _regenerator().w(function (_context27) {
        while (1) switch (_context27.p = _context27.n) {
          case 0:
            if (!(statusSaving || isPanelOrder(order) || ['completed', 'dispatched'].includes(order.status) || status === order.status)) {
              _context27.n = 1;
              break;
            }
            return _context27.a(2);
          case 1:
            statusSaving = true;
            root.querySelectorAll('[data-status],[data-apply-status],[data-retry-status]').forEach(function (control) {
              return control.disabled = true;
            });
            version = sessionVersion;
            _context27.p = 2;
            _context27.n = 3;
            return api('/orders/' + order.id + '/status', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                status: status,
                expectedUpdatedAt: order.updatedAt || order.createdAt || ''
              })
            });
          case 3:
            response = _context27.v;
            _context27.n = 4;
            return response.json();
          case 4:
            _result8 = _context27.v;
            if (!(version !== sessionVersion)) {
              _context27.n = 5;
              break;
            }
            return _context27.a(2);
          case 5:
            if (!(response.status === 409 && _result8.code === 'ORDER_CONFLICT')) {
              _context27.n = 6;
              break;
            }
            statusConflict = {
              order: _result8.order,
              status: status
            };
            render();
            return _context27.a(2);
          case 6:
            if (response.ok) {
              _context27.n = 7;
              break;
            }
            throw Error(_result8.error || 'Status update failed');
          case 7:
            statusConflict = null;
            delete statusChoices[order.id];
            message = status === 'completed' ? 'Order marked ready for dispatch.' : 'Order status updated.';
            _context27.n = 8;
            return refresh();
          case 8:
            _context27.n = 10;
            break;
          case 9:
            _context27.p = 9;
            _t30 = _context27.v;
            if (version === sessionVersion) message = _t30.message;
          case 10:
            _context27.p = 10;
            if (version === sessionVersion) {
              statusSaving = false;
              render();
            }
            return _context27.f(10);
          case 11:
            return _context27.a(2);
        }
      }, _callee26, null, [[2, 9, 10, 11]]);
    }));
    return _changeOrderStatus.apply(this, arguments);
  }
  function orderDay() {
    var date = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : new Date();
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Australia/Brisbane',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(date);
  }
  function deliveryInfo(order) {
    var today = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : orderDay();
    var confirmed = !!order.scheduledDeliveryDate,
      date = order.scheduledDeliveryDate || order.requestedDeliveryDate || '',
      active = !order.local && ['submitted', 'approved', 'ordered', 'in_stock', 'completed'].includes(order.status);
    return {
      date: date,
      confirmed: confirmed,
      overdue: active && /^\d{4}-\d{2}-\d{2}$/.test(date) && date < today
    };
  }
  function matchesOrder(order) {
    var today = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : orderDay();
    var query = orderQuery.trim().toLowerCase(),
      info = deliveryInfo(order, today),
      day = new Date(today + 'T12:00:00Z'),
      end = new Date(day);
    end.setUTCDate(day.getUTCDate() + (7 - day.getUTCDay()) % 7);
    return (!query || [order.orderNumber, order.project, order.siteContact, order.requestedBy].concat(_toConsumableArray((order.items || []).map(function (item) {
      return item.description;
    }))).join(' ').toLowerCase().includes(query)) && (!orderProject || String(order.projectId || order.project) === orderProject) && (!orderRequester || (order.requestedBy || (order.local ? session.username : '')) === orderRequester) && (!orderDelivery || (orderDelivery === 'overdue' ? info.overdue : orderDelivery === 'week' ? !order.local && !['dispatched', 'cancelled'].includes(order.status) && info.date >= today && info.date <= end.toISOString().slice(0, 10) : !order.scheduledDeliveryDate));
  }
  var attentionFilter = 'all',
    attentionRefreshing = false,
    attentionError = '';
  var ATTENTION_FILTERS = [['all', 'All attention'], ['sync', 'Uploads / sync'], ['issues', 'Delivery issues'], ['overdue', 'Overdue'], ['unconfirmed', 'Unconfirmed']];
  function orderAttentionEntries() {
    var _session6;
    var today = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : orderDay();
    var entries = new Map(orders.map(function (order) {
      return [order.id, {
        order: order,
        pending: null
      }];
    }));
    if (outbox.owner === ((_session6 = session) === null || _session6 === void 0 ? void 0 : _session6.username)) {
      var _iterator2 = _createForOfIteratorHelper(outbox.queue),
        _step2;
      try {
        for (_iterator2.s(); !(_step2 = _iterator2.n()).done;) {
          var packet = _step2.value;
          var saved = packet.orderId && entries.get(packet.orderId);
          if (saved) {
            saved.pending = packet;
            continue;
          }
          entries.set(packet.localId, {
            order: _objectSpread(_objectSpread({}, packet.order), {}, {
              id: packet.localId,
              savedOrderId: packet.orderId || '',
              orderNumber: packet.orderId ? packet.order.orderNumber : 'Pending',
              status: packet.orderId ? 'uploading files' : 'waiting to sync',
              createdAt: packet.createdAt,
              attachments: packet.attachments || [],
              local: true
            }),
            pending: packet
          });
        }
      } catch (err) {
        _iterator2.e(err);
      } finally {
        _iterator2.f();
      }
    }
    return _toConsumableArray(entries.values()).map(function (entry) {
      var order = entry.order,
        pending = entry.pending,
        reasons = [],
        delivery = deliveryInfo(order, today);
      if (pending) reasons.push({
        kind: 'sync',
        label: pending.orderId ? 'Submission not finished' : 'Waiting to submit',
        detail: pending.orderId ? 'The order is saved; its uploads or sync still need to finish.' : 'This request is saved on this device and has not reached the office yet.',
        priority: 0
      });
      var issues = (order.deliveryIssues || []).filter(function (issue) {
        return issue.status !== 'resolved';
      });
      if (issues.length) reasons.push({
        kind: 'issues',
        label: issues.length + ' unresolved delivery issue' + (issues.length === 1 ? '' : 's'),
        detail: 'Open the order to review damaged or missing items and replacement progress.',
        priority: 1
      });
      if (delivery.overdue) reasons.push({
        kind: 'overdue',
        label: delivery.confirmed ? 'Confirmed delivery overdue' : 'Requested date passed',
        detail: (delivery.confirmed ? 'Confirmed' : 'Requested') + ' delivery: ' + formatDate(delivery.date),
        priority: 2
      });
      if (!order.local && ['submitted', 'approved', 'ordered', 'in_stock', 'completed'].includes(order.status) && !order.scheduledDeliveryDate) reasons.push({
        kind: 'unconfirmed',
        label: 'Delivery not confirmed',
        detail: order.requestedDeliveryDate ? 'Requested: ' + formatDate(order.requestedDeliveryDate) : 'No requested delivery date was provided.',
        priority: 3
      });
      return _objectSpread(_objectSpread({}, entry), {}, {
        reasons: reasons,
        priority: reasons.length ? Math.min.apply(Math, _toConsumableArray(reasons.map(function (reason) {
          return reason.priority;
        }))) : 4,
        deliveryDate: delivery.date || '9999-12-31'
      });
    }).filter(function (entry) {
      return entry.reasons.length;
    }).sort(function (a, b) {
      return a.priority - b.priority || a.deliveryDate.localeCompare(b.deliveryDate) || String(a.order.createdAt || '').localeCompare(String(b.order.createdAt || '')) || String(a.order.id).localeCompare(String(b.order.id));
    });
  }
  function refreshAttention() {
    return _refreshAttention.apply(this, arguments);
  }
  function _refreshAttention() {
    _refreshAttention = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee27() {
      var version, response, _result9, _t31;
      return _regenerator().w(function (_context28) {
        while (1) switch (_context28.p = _context28.n) {
          case 0:
            if (!(attentionRefreshing || !session)) {
              _context28.n = 1;
              break;
            }
            return _context28.a(2);
          case 1:
            version = sessionVersion;
            attentionRefreshing = true;
            attentionError = '';
            render();
            _context28.p = 2;
            _context28.n = 3;
            return api('/orders');
          case 3:
            response = _context28.v;
            _context28.n = 4;
            return response.json();
          case 4:
            _result9 = _context28.v;
            if (!(version !== sessionVersion)) {
              _context28.n = 5;
              break;
            }
            return _context28.a(2);
          case 5:
            if (response.ok) {
              _context28.n = 6;
              break;
            }
            throw Error(_result9.error || 'Orders could not be refreshed.');
          case 6:
            if (Array.isArray(_result9.orders)) {
              _context28.n = 7;
              break;
            }
            throw Error('Orders could not be refreshed.');
          case 7:
            orders = _result9.orders;
            _context28.n = 9;
            break;
          case 8:
            _context28.p = 8;
            _t31 = _context28.v;
            if (version === sessionVersion) attentionError = (_t31.message || 'Orders could not be refreshed.') + ' Showing the last loaded information.';
          case 9:
            _context28.p = 9;
            if (version === sessionVersion) {
              attentionRefreshing = false;
              if (view === 'order-attention') render();
            }
            return _context28.f(9);
          case 10:
            return _context28.a(2);
        }
      }, _callee27, null, [[2, 8, 9, 10]]);
    }));
    return _refreshAttention.apply(this, arguments);
  }
  function orderAttentionView() {
    var entries = orderAttentionEntries(),
      shown = entries.filter(function (entry) {
        return attentionFilter === 'all' || entry.reasons.some(function (reason) {
          return reason.kind === attentionFilter;
        });
      });
    var filters = ATTENTION_FILTERS.map(function (_ref2) {
      var _ref3 = _slicedToArray(_ref2, 2),
        kind = _ref3[0],
        label = _ref3[1];
      var count = kind === 'all' ? entries.length : entries.filter(function (entry) {
        return entry.reasons.some(function (reason) {
          return reason.kind === kind;
        });
      }).length;
      return '<button type="button" data-attention-filter="' + kind + '" aria-pressed="' + (attentionFilter === kind) + '" class="' + (attentionFilter === kind ? 'active' : '') + '"><span>' + label + '</span><b>' + count + '</b></button>';
    }).join('');
    return "<div class=\"toolbar site-attention-heading\"><div><h2>Needs attention</h2><small>".concat(entries.length, " order").concat(entries.length === 1 ? '' : 's', " need").concat(entries.length === 1 ? 's' : '', " attention</small></div><div class=\"actions\"><button type=\"button\" data-attention-back>Back to orders</button><button type=\"button\" data-refresh-attention ").concat(attentionRefreshing ? 'disabled' : '', ">").concat(attentionRefreshing ? 'Refreshing…' : 'Refresh', "</button></div></div>").concat(message ? "<div class=\"notice\" role=\"status\">".concat(esc(message), "</div>") : '').concat(attentionError ? "<div class=\"notice\" role=\"alert\">".concat(esc(attentionError), "</div>") : '').concat(submissionQueueView(), "<p class=\"site-attention-help\">Orders can appear under more than one reason. Delivery dates use Brisbane time.</p><div class=\"site-attention-filters\" aria-label=\"Filter orders needing attention\">").concat(filters, "</div><p class=\"site-order-count\" role=\"status\">").concat(shown.length, " matching order").concat(shown.length === 1 ? '' : 's', "</p><section class=\"card site-order-results\">").concat(shown.map(function (_ref4) {
      var order = _ref4.order,
        reasons = _ref4.reasons,
        pending = _ref4.pending;
      return "<article class=\"order site-order-tile site-attention-tile\"><div class=\"site-order-identity\"><strong>#".concat(esc(order.orderNumber), " \xB7 ").concat(esc(order.project || 'Project not set'), "</strong><br><small>").concat(esc(orderStatusLabel(order.status))).concat(order.requestedBy ? ' · ' + esc(order.requestedBy) : '', "</small><ul class=\"site-attention-reasons\">").concat(reasons.map(function (reason) {
        return "<li class=\"site-attention-reason is-".concat(reason.kind, "\"><strong>").concat(esc(reason.label), "</strong><small>").concat(esc(reason.detail), "</small></li>");
      }).join(''), "</ul></div><div class=\"actions\"><button type=\"button\" data-order-details=\"").concat(esc(order.id), "\">View order</button>").concat(pending ? "<button type=\"button\" data-attention-sync ".concat(busy || !navigator.onLine ? 'disabled' : '', ">").concat(busy ? 'Syncing…' : 'Retry sync', "</button>").concat(!navigator.onLine ? '<small>Connect to finish syncing.</small>' : '') : '', "</div></article>");
    }).join('') || "<div class=\"empty\"><strong>".concat(entries.length ? 'No orders in this category' : 'No orders need attention in the loaded information', "</strong><p>").concat(entries.length ? 'Choose another reason to see other orders.' : 'Refresh to check for new updates.', "</p></div>"), "</section>");
  }
  function orderDates(order) {
    return "<div class=\"site-order-dates\"><div><small>Requested delivery</small><strong>".concat(esc(order.requestedDeliveryDate ? formatDate(order.requestedDeliveryDate) : 'Not set'), "</strong></div><div class=\"site-order-scheduled-delivery\"><small>Scheduled delivery</small><strong>").concat(esc(order.scheduledDeliveryDate ? formatDate(order.scheduledDeliveryDate) : 'Not scheduled'), "</strong>").concat(order.scheduledDeliveryDate && order.scheduledDeliveryTime ? "<small>".concat(esc(order.scheduledDeliveryTime), "</small>") : '', "</div><div class=\"site-order-readiness\"><small>").concat(order.status === 'dispatched' ? 'Dispatched' : 'Ready since', "</small><strong>").concat(esc(['completed', 'dispatched'].includes(order.status) ? (order.status === 'dispatched' ? order.dispatchedAt : order.completedAt) ? new Date(order.status === 'dispatched' ? order.dispatchedAt : order.completedAt).toLocaleDateString('en-AU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'Australia/Brisbane'
    }) : 'Date unavailable' : 'Not marked ready'), "</strong></div></div>");
  }
  function deliverySummary(order) {
    var info = deliveryInfo(order);
    return "<div><small>".concat(info.date ? "".concat(info.confirmed ? 'Confirmed' : 'Requested', " delivery: ").concat(esc(formatDate(info.date))) : 'Delivery date not provided').concat(info.overdue ? " <strong style=\"color:#b91c1c\">\xB7 ".concat(info.confirmed ? 'Overdue' : 'Requested date passed', "</strong>") : '', "</small></div>");
  }
  function orderSearchControls(all) {
    var projects = new Map(all.map(function (order) {
        return [String(order.projectId || order.project), order.project];
      })),
      requesters = _toConsumableArray(new Set(all.map(function (order) {
        return order.requestedBy || (order.local ? session.username : '');
      }).filter(Boolean))).sort();
    return "<section class=\"card\"><label>Search orders<input type=\"search\" data-order-search placeholder=\"Order number, project or item\" value=\"".concat(esc(orderQuery), "\"></label><div class=\"grid\"><label>Project<select data-order-project><option value=\"\">All projects</option>").concat(_toConsumableArray(projects).sort(function (a, b) {
      return String(a[1]).localeCompare(String(b[1]));
    }).map(function (_ref5) {
      var _ref6 = _slicedToArray(_ref5, 2),
        id = _ref6[0],
        name = _ref6[1];
      return "<option value=\"".concat(esc(id), "\" ").concat(orderProject === id ? 'selected' : '', ">").concat(esc(name), "</option>");
    }).join(''), "</select></label><label>Requested by<select data-order-requester><option value=\"\">Everyone</option>").concat(requesters.map(function (name) {
      return "<option value=\"".concat(esc(name), "\" ").concat(orderRequester === name ? 'selected' : '', ">").concat(esc(name), "</option>");
    }).join(''), "</select></label><label>Delivery<select data-order-delivery>").concat([['', 'Any delivery'], ['week', 'Due this week'], ['overdue', 'Overdue'], ['unconfirmed', 'Not confirmed']].map(function (_ref7) {
      var _ref8 = _slicedToArray(_ref7, 2),
        id = _ref8[0],
        name = _ref8[1];
      return "<option value=\"".concat(id, "\" ").concat(orderDelivery === id ? 'selected' : '', ">").concat(name, "</option>");
    }).join(''), "</select></label></div><div class=\"actions\"><button data-my-orders>My orders</button><button data-due-week>Due this week</button><button data-overdue>Overdue</button><button data-clear-order-filters>Clear filters</button></div><small>Delivery dates use Brisbane time. Confirmed dates take priority; otherwise requested dates apply.</small></section>");
  }
  var COMMENT_DRAFT_KEY = 'panelstock:site-orders:comment:v1:';
  var commentStates = {},
    commentDrafts = {},
    commentRequest = 0,
    commentVisibleId = '';
  var commentCanWrite = function commentCanWrite(order) {
    var _session7, _session8, _session9, _session0;
    return !!((_session7 = session) !== null && _session7 !== void 0 && _session7.isAdmin || ((_session8 = session) === null || _session8 === void 0 || (_session8 = _session8.taskAccess) === null || _session8 === void 0 ? void 0 : _session8['site.orders.manage']) === true || order.requestedBy === ((_session9 = session) === null || _session9 === void 0 ? void 0 : _session9.username) && ((_session0 = session) === null || _session0 === void 0 || (_session0 = _session0.taskAccess) === null || _session0 === void 0 ? void 0 : _session0['site.orders.create']) === true);
  };
  var commentKey = function commentKey(id) {
    return COMMENT_DRAFT_KEY + session.username + ':' + id;
  };
  function commentDraft(id) {
    if (!commentDrafts[id]) {
      var saved;
      try {
        saved = JSON.parse(deviceStorage.getItem(commentKey(id)) || 'null');
      } catch (_unused2) {}
      commentDrafts[id] = saved && typeof saved.text === 'string' && saved.text.length <= 2000 && ['comment', 'clarification'].includes(saved.kind) && typeof saved.id === 'string' && typeof saved.replyTo === 'string' ? saved : {
        id: crypto.randomUUID(),
        text: '',
        kind: 'comment',
        replyTo: ''
      };
    }
    return commentDrafts[id];
  }
  function persistComment(id) {
    try {
      deviceStorage.setItem(commentKey(id), JSON.stringify(commentDraft(id)));
      return true;
    } catch (_unused3) {
      commentStates[id] = _objectSpread(_objectSpread({}, commentStates[id]), {}, {
        error: 'Could not save this comment on your device. Keep this page open and free some storage before sending.'
      });
      return false;
    }
  }
  function captureComment() {
    if (!session) return;
    var form = root.querySelector('[data-comment-form]');
    if (!form) return;
    var id = form.dataset.commentForm,
      draft = commentDraft(id),
      text = form.querySelector('[name=commentText]').value,
      kind = draft.replyTo ? 'comment' : form.querySelector('[name=commentKind]').value;
    if (draft.text !== text || draft.kind !== kind) {
      draft.id = crypto.randomUUID();
      draft.text = text;
      draft.kind = kind;
      if (!persistComment(id)) {
        var section = root.querySelector('[data-order-discussion]');
        if ((section === null || section === void 0 ? void 0 : section.dataset.orderDiscussion) === id) section.querySelector('[data-comment-notice]').textContent = commentStates[id].error;
      }
    }
  }
  function commentList(order) {
    var state = commentStates[order.id] || {},
      comments = state.comments;
    if (!comments) return "<p>".concat(state.loading ? 'Loading discussion…' : 'Discussion has not been loaded.', "</p>");
    var entry = function entry(comment) {
      var reply = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : false;
      return "<article class=\"site-comment ".concat(reply ? 'site-comment-reply' : '', "\"><div><strong>").concat(esc(reply ? 'Reply' : comment.kind === 'clarification' ? 'Clarification question' : 'Comment'), "</strong> <small>\xB7 ").concat(esc(comment.author), " \xB7 ").concat(esc(new Date(comment.createdAt).toLocaleString('en-AU', {
        timeZone: 'Australia/Brisbane'
      })), " (Brisbane)</small></div><p>").concat(esc(comment.text), "</p>").concat(!reply && commentCanWrite(order) && state.canComment !== false ? "<button type=\"button\" data-comment-reply=\"".concat(esc(comment.id), "\">Reply</button>") : '', "</article>");
    };
    return comments.filter(function (comment) {
      return !comment.replyTo;
    }).map(function (comment) {
      return entry(comment) + comments.filter(function (reply) {
        return reply.replyTo === comment.id;
      }).map(function (reply) {
        return entry(reply, true);
      }).join('');
    }).join('') || '<p>No comments yet.</p>';
  }
  function orderDiscussion(order) {
    if (order.local) return '<section class="card site-discussion"><h3>Comments and clarifications</h3><p>Finish syncing this order to open its discussion.</p></section>';
    var state = commentStates[order.id] || {},
      draft = commentDraft(order.id);
    return "<section class=\"card site-discussion\" data-order-discussion=\"".concat(esc(order.id), "\"><div class=\"toolbar\"><h3>Comments and clarifications</h3><button type=\"button\" data-refresh-comments ").concat(state.loading || state.saving ? 'disabled' : '', ">Refresh discussion</button></div><p>Discuss this order here. Comments do not change the submitted items or delivery dates.</p><div data-comment-notice role=\"status\">").concat(esc(state.error || state.notice || ''), "</div><div data-comment-list>").concat(commentList(order), "</div>").concat(commentCanWrite(order) ? "<form data-comment-form=\"".concat(esc(order.id), "\"><div data-comment-reply-label></div><label class=\"site-comment-kind\">Post type<select name=\"commentKind\"><option value=\"comment\" ").concat(draft.kind === 'comment' ? 'selected' : '', ">Comment</option><option value=\"clarification\" ").concat(draft.kind === 'clarification' ? 'selected' : '', ">Clarification question</option></select></label><label>Your message<textarea placeholder=\"Add a comment or ask a question\u2026\" name=\"commentText\" rows=\"4\" maxlength=\"2000\" required>").concat(esc(draft.text), "</textarea></label><div class=\"actions\"><button class=\"primary\" type=\"submit\" ").concat(state.saving || !navigator.onLine ? 'disabled' : '', ">").concat(state.saving ? 'Sending…' : 'Send message', "</button><button type=\"button\" data-cancel-comment-reply ").concat(draft.replyTo ? '' : 'hidden', ">Cancel reply</button></div><small>Your unfinished message is saved on this device. Connect to send it.</small></form>") : '<p>You can read this discussion. Only the requester and order managers can post.</p>', "</section>");
  }
  function updateCommentUI(id) {
    if (view !== 'order' || selectedOrderId !== id || !session) return;
    var section = root.querySelector('[data-order-discussion]');
    if (!section || section.dataset.orderDiscussion !== id) return;
    var order = orders.find(function (order) {
      return order.id === id;
    });
    if (!order) return;
    var state = commentStates[id] || {},
      draft = commentDraft(id),
      form = section.querySelector('[data-comment-form]');
    section.querySelector('[data-comment-list]').innerHTML = commentList(order);
    section.querySelector('[data-comment-notice]').textContent = state.error || state.notice || '';
    section.querySelector('[data-refresh-comments]').disabled = !!(state.loading || state.saving);
    if (form) {
      var denied = state.canComment === false || !commentCanWrite(order),
        kind = form.querySelector('[name=commentKind]');
      kind.value = draft.kind;
      kind.disabled = !!(draft.replyTo || state.saving || denied);
      form.querySelector('[name=commentText]').disabled = !!(state.saving || denied);
      var button = form.querySelector('[type=submit]');
      button.disabled = !!(state.saving || denied || !navigator.onLine);
      button.textContent = state.saving ? 'Sending…' : 'Send message';
      form.querySelector('[data-cancel-comment-reply]').hidden = !draft.replyTo;
      form.querySelector('[data-cancel-comment-reply]').disabled = !!state.saving;
      var parent = (state.comments || []).find(function (comment) {
        return comment.id === draft.replyTo;
      });
      form.querySelector('[data-comment-reply-label]').textContent = draft.replyTo ? 'Replying to ' + (parent ? parent.author + ': ' + parent.text.slice(0, 120) : 'the saved comment') + '.' : '';
      if (denied) section.querySelector('[data-comment-notice]').textContent = 'Your access allows reading this discussion only. Your unfinished message is kept on this device.';
    }
    wireCommentReplies(section, id);
  }
  function wireCommentReplies(section, id) {
    section.querySelectorAll('[data-comment-reply]').forEach(function (button) {
      return button.onclick = function () {
        var _commentStates$id, _section$querySelecto;
        if ((_commentStates$id = commentStates[id]) !== null && _commentStates$id !== void 0 && _commentStates$id.saving) return;
        captureComment();
        var draft = commentDraft(id);
        draft.replyTo = button.dataset.commentReply;
        draft.kind = 'comment';
        draft.id = crypto.randomUUID();
        persistComment(id);
        updateCommentUI(id);
        (_section$querySelecto = section.querySelector('[name=commentText]')) === null || _section$querySelecto === void 0 || _section$querySelecto.focus();
      };
    });
  }
  function loadOrderComments(_x11) {
    return _loadOrderComments.apply(this, arguments);
  }
  function _loadOrderComments() {
    _loadOrderComments = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee28(id) {
      var _commentStates$id3;
      var version, request, _commentStates$id4, response, _result0, _commentStates$id5, _t32;
      return _regenerator().w(function (_context29) {
        while (1) switch (_context29.p = _context29.n) {
          case 0:
            if (!(!session || (_commentStates$id3 = commentStates[id]) !== null && _commentStates$id3 !== void 0 && _commentStates$id3.saving)) {
              _context29.n = 1;
              break;
            }
            return _context29.a(2);
          case 1:
            version = sessionVersion, request = ++commentRequest;
            commentStates[id] = _objectSpread(_objectSpread({}, commentStates[id]), {}, {
              request: request,
              loading: true,
              error: ''
            });
            updateCommentUI(id);
            _context29.p = 2;
            _context29.n = 3;
            return api('/orders/' + encodeURIComponent(id) + '/comments');
          case 3:
            response = _context29.v;
            _context29.n = 4;
            return response.json();
          case 4:
            _result0 = _context29.v;
            if (response.ok) {
              _context29.n = 5;
              break;
            }
            throw Error(_result0.error || 'Discussion could not be loaded.');
          case 5:
            if (!(version !== sessionVersion || request !== ((_commentStates$id4 = commentStates[id]) === null || _commentStates$id4 === void 0 ? void 0 : _commentStates$id4.request))) {
              _context29.n = 6;
              break;
            }
            return _context29.a(2);
          case 6:
            if (!(_result0.orderId !== id || !Array.isArray(_result0.comments))) {
              _context29.n = 7;
              break;
            }
            throw Error('Discussion could not be verified. Refresh to try again.');
          case 7:
            commentStates[id] = _objectSpread(_objectSpread({}, commentStates[id]), {}, {
              comments: _result0.comments,
              canComment: _result0.canComment,
              loading: false
            });
            _context29.n = 10;
            break;
          case 8:
            _context29.p = 8;
            _t32 = _context29.v;
            if (!(version !== sessionVersion || request !== ((_commentStates$id5 = commentStates[id]) === null || _commentStates$id5 === void 0 ? void 0 : _commentStates$id5.request))) {
              _context29.n = 9;
              break;
            }
            return _context29.a(2);
          case 9:
            commentStates[id] = _objectSpread(_objectSpread({}, commentStates[id]), {}, {
              loading: false,
              error: _t32.message
            });
          case 10:
            updateCommentUI(id);
          case 11:
            return _context29.a(2);
        }
      }, _callee28, null, [[2, 8]]);
    }));
    return _loadOrderComments.apply(this, arguments);
  }
  function sendOrderComment(_x12) {
    return _sendOrderComment.apply(this, arguments);
  }
  function _sendOrderComment() {
    _sendOrderComment = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee29(event) {
      var _commentStates$id6, _commentStates$id7;
      var id, order, draft, version, payload, request, response, _result1, form, _t33;
      return _regenerator().w(function (_context30) {
        while (1) switch (_context30.p = _context30.n) {
          case 0:
            event.preventDefault();
            if (session) {
              _context30.n = 1;
              break;
            }
            return _context30.a(2);
          case 1:
            id = event.currentTarget.dataset.commentForm, order = orders.find(function (order) {
              return order.id === id;
            });
            if (!(!order || !commentCanWrite(order) || ((_commentStates$id6 = commentStates[id]) === null || _commentStates$id6 === void 0 ? void 0 : _commentStates$id6.canComment) === false || (_commentStates$id7 = commentStates[id]) !== null && _commentStates$id7 !== void 0 && _commentStates$id7.saving)) {
              _context30.n = 2;
              break;
            }
            return _context30.a(2);
          case 2:
            captureComment();
            draft = commentDraft(id);
            if (draft.text.trim()) {
              _context30.n = 3;
              break;
            }
            return _context30.a(2);
          case 3:
            if (navigator.onLine) {
              _context30.n = 4;
              break;
            }
            commentStates[id] = _objectSpread(_objectSpread({}, commentStates[id]), {}, {
              error: 'Connect to send your saved message.'
            });
            updateCommentUI(id);
            return _context30.a(2);
          case 4:
            if (persistComment(id)) {
              _context30.n = 5;
              break;
            }
            updateCommentUI(id);
            return _context30.a(2);
          case 5:
            version = sessionVersion, payload = _objectSpread({}, draft), request = ++commentRequest;
            commentStates[id] = _objectSpread(_objectSpread({}, commentStates[id]), {}, {
              request: request,
              saving: true,
              loading: false,
              error: '',
              notice: ''
            });
            updateCommentUI(id);
            _context30.p = 6;
            _context30.n = 7;
            return api('/orders/' + encodeURIComponent(id) + '/comments', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(payload)
            });
          case 7:
            response = _context30.v;
            _context30.n = 8;
            return response.json();
          case 8:
            _result1 = _context30.v;
            if (response.ok) {
              _context30.n = 9;
              break;
            }
            throw Error(_result1.error || 'Message could not be sent. Your text is saved; retry when connected.');
          case 9:
            if (!(version !== sessionVersion)) {
              _context30.n = 10;
              break;
            }
            return _context30.a(2);
          case 10:
            if (!(_result1.orderId !== id || !Array.isArray(_result1.comments) || !_result1.comments.some(function (comment) {
              return comment.id === payload.id && comment.author === session.username && comment.text === payload.text.trim() && comment.kind === payload.kind && comment.replyTo === payload.replyTo;
            }))) {
              _context30.n = 11;
              break;
            }
            throw Error('Message confirmation could not be verified. Your text is saved; retry to check it.');
          case 11:
            commentStates[id] = {
              comments: _result1.comments,
              canComment: _result1.canComment,
              saving: false,
              notice: 'Message sent.'
            };
            commentDrafts[id] = {
              id: crypto.randomUUID(),
              text: '',
              kind: 'comment',
              replyTo: ''
            };
            try {
              deviceStorage.removeItem(commentKey(id));
            } catch (_unused13) {
              persistComment(id);
            }
            form = root.querySelector('[data-comment-form]');
            if ((form === null || form === void 0 ? void 0 : form.dataset.commentForm) === id) form.querySelector('[name=commentText]').value = '';
            _context30.n = 14;
            break;
          case 12:
            _context30.p = 12;
            _t33 = _context30.v;
            if (!(version !== sessionVersion)) {
              _context30.n = 13;
              break;
            }
            return _context30.a(2);
          case 13:
            commentStates[id] = _objectSpread(_objectSpread({}, commentStates[id]), {}, {
              saving: false,
              error: _t33.message
            });
          case 14:
            updateCommentUI(id);
          case 15:
            return _context30.a(2);
        }
      }, _callee29, null, [[6, 12]]);
    }));
    return _sendOrderComment.apply(this, arguments);
  }
  function wireOrderComments() {
    var section = root.querySelector('[data-order-discussion]');
    if (!section) return;
    var id = section.dataset.orderDiscussion,
      entered = commentVisibleId !== id,
      form = section.querySelector('[data-comment-form]');
    commentVisibleId = id;
    if (form) {
      form.onsubmit = sendOrderComment;
      form.addEventListener('input', captureComment);
      form.addEventListener('change', captureComment);
      form.querySelector('[data-cancel-comment-reply]').onclick = function () {
        var _commentStates$id2;
        if ((_commentStates$id2 = commentStates[id]) !== null && _commentStates$id2 !== void 0 && _commentStates$id2.saving) return;
        captureComment();
        var draft = commentDraft(id);
        draft.replyTo = '';
        draft.id = crypto.randomUUID();
        persistComment(id);
        updateCommentUI(id);
      };
    }
    section.querySelector('[data-refresh-comments]').onclick = function () {
      void loadOrderComments(id);
    };
    updateCommentUI(id);
    if (entered || !commentStates[id]) void loadOrderComments(id);
  }
  function loadOrderHistory(_x13) {
    return _loadOrderHistory.apply(this, arguments);
  }
  function _loadOrderHistory() {
    _loadOrderHistory = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee30(id) {
      var version, response, _result10, _t34;
      return _regenerator().w(function (_context31) {
        while (1) switch (_context31.p = _context31.n) {
          case 0:
            version = sessionVersion;
            historyState = {
              id: id,
              loading: true
            };
            render();
            _context31.p = 1;
            _context31.n = 2;
            return api('/orders/' + encodeURIComponent(id) + '/history');
          case 2:
            response = _context31.v;
            _context31.n = 3;
            return response.json();
          case 3:
            _result10 = _context31.v;
            if (response.ok) {
              _context31.n = 4;
              break;
            }
            throw Error(_result10.error || 'History could not be loaded.');
          case 4:
            if (!(version !== sessionVersion || selectedOrderId !== id)) {
              _context31.n = 5;
              break;
            }
            return _context31.a(2);
          case 5:
            historyState = {
              id: id,
              events: _result10.events || []
            };
            _context31.n = 8;
            break;
          case 6:
            _context31.p = 6;
            _t34 = _context31.v;
            if (!(version !== sessionVersion || selectedOrderId !== id)) {
              _context31.n = 7;
              break;
            }
            return _context31.a(2);
          case 7:
            historyState = {
              id: id,
              error: _t34.message
            };
          case 8:
            if (view === 'order') render();
          case 9:
            return _context31.a(2);
        }
      }, _callee30, null, [[1, 6]]);
    }));
    return _loadOrderHistory.apply(this, arguments);
  }
  function orderTimeline(order) {
    if (order.local) return '<section class="card site-order-history"><h3>Order history</h3><p>Saved on this device; waiting to finish syncing.</p></section>';
    var state = historyState.id === order.id ? historyState : {};
    return "<section class=\"card site-order-history\"><h3>Order history</h3>".concat(state.loading ? '<p>Loading history…</p>' : state.error ? "<p>".concat(esc(state.error), "</p><button data-history-retry>Retry history</button>") : state.events ? "<ol class=\"site-order-timeline\">".concat(state.events.map(function (event) {
      return "<li><strong>".concat(esc(event.label), "</strong>").concat(event.status ? " \xB7 ".concat(esc(event.status)) : '').concat(event.fileName ? " \xB7 ".concat(esc(event.fileName)) : '', "<br><small>").concat(esc(new Date(event.at).toLocaleString('en-AU', {
        timeZone: 'Australia/Brisbane'
      })), " (Brisbane) \xB7 ").concat(esc(event.actor || 'Unknown user'), "</small></li>");
    }).join(''), "</ol><small>Recorded order events. Older changes may not have a detailed audit entry.</small>") : '<button data-history-retry>Load history</button>', "</section>");
  }
  var gateStageFields = [['drawn', 'Drawn'], ['fabricatedQa', 'Fabricated/QA'], ['readyForDispatch', 'Ready for Dispatch']];
  var isGateOrder = function isGateOrder(order) {
    return String(order.orderType || '').trim().toLowerCase() === 'gate';
  };
  var gateStageValues = function gateStageValues(order) {
    return Object.fromEntries(gateStageFields.map(function (_ref9) {
      var _order$manualProducti;
      var _ref0 = _slicedToArray(_ref9, 1),
        key = _ref0[0];
      return [key, ((_order$manualProducti = order.manualProduction) === null || _order$manualProducti === void 0 || (_order$manualProducti = _order$manualProducti.stages) === null || _order$manualProducti === void 0 ? void 0 : _order$manualProducti[key]) || (key === 'readyForDispatch' && ['completed', 'dispatched'].includes(order.status) ? 'complete' : 'pending')];
    }));
  };
  var gateEditor = null,
    gateSaving = false;
  function captureGateProgress() {
    var _gateEditor, _session1;
    var form = root.querySelector('[data-gate-progress]');
    if (!form || ((_gateEditor = gateEditor) === null || _gateEditor === void 0 ? void 0 : _gateEditor.owner) !== ((_session1 = session) === null || _session1 === void 0 ? void 0 : _session1.username)) return;
    gateEditor.stages.drawn = form.querySelector('[name=drawn]').value;
  }
  function gateProductionEditorView(order) {
    var _gateEditor2, _order$manualProducti2;
    if (order.local || !isGateOrder(order) || !can('site.orders.manage') || ['dispatched', 'cancelled'].includes(order.status)) return '';
    if (((_gateEditor2 = gateEditor) === null || _gateEditor2 === void 0 ? void 0 : _gateEditor2.id) !== order.id) gateEditor = {
      id: order.id,
      owner: session.username,
      expectedUpdatedAt: order.updatedAt || order.createdAt || '',
      stages: gateStageValues(order),
      error: '',
      conflict: null
    };
    var draft = gateEditor;
    return "<section class=\"card site-order-history\"><h3>Update Gate production</h3><p>Mark Drawn complete to send each Gate item to the QA Centre. QA approval updates Fabricated/QA and Ready for Dispatch automatically. Other tracker stages show N/A. Resetting Drawn withdraws the current QA entries and readiness.</p>".concat(((_order$manualProducti2 = order.manualProduction) === null || _order$manualProducti2 === void 0 ? void 0 : _order$manualProducti2.stages.drawn) === 'complete' && order.manualProduction.qaWorkflowVersion !== 1 ? '<p>Save Drawn to send this previously recorded Gate to QA.</p>' : '', "<form data-gate-progress><div class=\"grid\">").concat(gateStageFields.map(function (_ref1) {
      var _ref10 = _slicedToArray(_ref1, 2),
        key = _ref10[0],
        label = _ref10[1];
      return "<label>".concat(label, "<select name=\"").concat(key, "\" aria-label=\"").concat(label, "\" ").concat(gateSaving || key !== 'drawn' ? 'disabled' : '', ">").concat([['pending', 'Pending'], ['complete', 'Complete']].map(function (_ref11) {
        var _ref12 = _slicedToArray(_ref11, 2),
          value = _ref12[0],
          text = _ref12[1];
        return "<option value=\"".concat(value, "\" ").concat(draft.stages[key] === value ? 'selected' : '', ">").concat(text, "</option>");
      }).join(''), "</select></label>");
    }).join(''), "</div>").concat(draft.error ? "<p role=\"alert\" class=\"notice\">".concat(esc(draft.error), "</p>") : '').concat(draft.conflict ? "<div class=\"notice\"><p>The order changed. Latest recorded progress: ".concat(gateStageFields.map(function (_ref13) {
      var _ref14 = _slicedToArray(_ref13, 2),
        key = _ref14[0],
        label = _ref14[1];
      return esc(label) + ': ' + (gateStageValues(draft.conflict)[key] === 'complete' ? 'Complete' : 'Pending');
    }).join(' · '), ". Your entries are retained.</p><div class=\"actions\"><button type=\"button\" data-gate-latest>Use latest progress</button><button type=\"button\" data-gate-keep>Keep my changes</button></div></div>") : '', "<button type=\"submit\" class=\"primary\" ").concat(gateSaving || draft.conflict ? 'disabled' : '', ">").concat(gateSaving ? 'Saving…' : 'Save production progress', "</button></form></section>");
  }
  function saveGateProgress(_x14) {
    return _saveGateProgress.apply(this, arguments);
  }
  function _saveGateProgress() {
    _saveGateProgress = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee31(event) {
      var draft, version, _result11$order$manua, response, _result11, _root$querySelector66, _t35;
      return _regenerator().w(function (_context32) {
        while (1) switch (_context32.p = _context32.n) {
          case 0:
            event.preventDefault();
            if (!(gateSaving || !gateEditor || gateEditor.conflict || !can('site.orders.manage'))) {
              _context32.n = 1;
              break;
            }
            return _context32.a(2);
          case 1:
            captureGateProgress();
            draft = gateEditor, version = sessionVersion;
            gateSaving = true;
            draft.error = '';
            render();
            _context32.p = 2;
            _context32.n = 3;
            return api('/orders/' + encodeURIComponent(draft.id) + '/progress', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                expectedUpdatedAt: draft.expectedUpdatedAt,
                stages: {
                  drawn: draft.stages.drawn
                }
              })
            });
          case 3:
            response = _context32.v;
            _context32.n = 4;
            return response.json();
          case 4:
            _result11 = _context32.v;
            if (!(version !== sessionVersion)) {
              _context32.n = 5;
              break;
            }
            return _context32.a(2);
          case 5:
            if (!(response.status === 409 && _result11.code === 'ORDER_CONFLICT')) {
              _context32.n = 6;
              break;
            }
            orders = orders.map(function (order) {
              return order.id === draft.id ? _objectSpread(_objectSpread({}, order), _result11.order) : order;
            });
            draft.conflict = _result11.order;
            draft.error = 'Review the latest order before saving again.';
            return _context32.a(2);
          case 6:
            if (response.ok) {
              _context32.n = 7;
              break;
            }
            throw Error(_result11.error || 'Production progress could not be saved.');
          case 7:
            orders = orders.map(function (order) {
              return order.id === draft.id ? _objectSpread(_objectSpread({}, order), _result11.order) : order;
            });
            if (gateEditor === draft) {
              (_root$querySelector66 = root.querySelector('[data-gate-progress]')) === null || _root$querySelector66 === void 0 || _root$querySelector66.remove();
              gateEditor = _objectSpread(_objectSpread({}, draft), {}, {
                expectedUpdatedAt: _result11.order.updatedAt,
                stages: gateStageValues(_result11.order),
                error: '',
                conflict: null
              });
            }
            message = _result11.unchanged ? 'Production progress is unchanged.' : ((_result11$order$manua = _result11.order.manualProduction) === null || _result11$order$manua === void 0 ? void 0 : _result11$order$manua.stages.drawn) === 'complete' ? 'Gate sent to the QA Centre.' : 'Drawn reset. Mark it complete to send the updated Gate for QA.';
            if (view === 'order' && selectedOrderId === draft.id) {
              void loadProductionProgress(draft.id);
              void loadOrderHistory(draft.id);
            }
            _context32.n = 9;
            break;
          case 8:
            _context32.p = 8;
            _t35 = _context32.v;
            if (version === sessionVersion && gateEditor === draft) draft.error = _t35.message;
          case 9:
            _context32.p = 9;
            if (version === sessionVersion) {
              gateSaving = false;
              render();
            }
            return _context32.f(9);
          case 10:
            return _context32.a(2);
        }
      }, _callee31, null, [[2, 8, 9, 10]]);
    }));
    return _saveGateProgress.apply(this, arguments);
  }
  function wireGateProgress() {
    var _root$querySelector6, _root$querySelector7;
    var form = root.querySelector('[data-gate-progress]');
    if (!form) return;
    form.onsubmit = saveGateProgress;
    form.addEventListener('change', captureGateProgress);
    (_root$querySelector6 = root.querySelector('[data-gate-latest]')) === null || _root$querySelector6 === void 0 || _root$querySelector6.addEventListener('click', function () {
      var latest = gateEditor.conflict;
      form.remove();
      gateEditor = _objectSpread(_objectSpread({}, gateEditor), {}, {
        expectedUpdatedAt: latest.updatedAt || latest.createdAt || '',
        stages: gateStageValues(latest),
        error: '',
        conflict: null
      });
      render();
    });
    (_root$querySelector7 = root.querySelector('[data-gate-keep]')) === null || _root$querySelector7 === void 0 || _root$querySelector7.addEventListener('click', function () {
      captureGateProgress();
      var drawn = gateEditor.stages.drawn;
      gateEditor.stages = _objectSpread(_objectSpread({}, gateStageValues(gateEditor.conflict)), {}, {
        drawn: drawn
      });
      gateEditor.expectedUpdatedAt = gateEditor.conflict.updatedAt || gateEditor.conflict.createdAt || '';
      gateEditor.conflict = null;
      gateEditor.error = '';
      render();
    });
  }
  var panelStageFields = [['drawn', 'Drawn']];
  var panelStageValues = function panelStageValues(order) {
    var _order$manualDrawing, _order$drawingProgres;
    return {
      drawn: (typeof ((_order$manualDrawing = order.manualDrawing) === null || _order$manualDrawing === void 0 ? void 0 : _order$manualDrawing.drawn) === 'boolean' ? order.manualDrawing.drawn : (_order$drawingProgres = order.drawingProgress) === null || _order$drawingProgres === void 0 ? void 0 : _order$drawingProgres.drawn) === true ? 'complete' : 'pending'
    };
  };
  var panelDrawingEditor = null,
    panelDrawingSaving = false;
  function capturePanelDrawing() {
    var _panelDrawingEditor, _session10;
    var form = root.querySelector('[data-panel-drawing-progress]');
    if (!form || ((_panelDrawingEditor = panelDrawingEditor) === null || _panelDrawingEditor === void 0 ? void 0 : _panelDrawingEditor.owner) !== ((_session10 = session) === null || _session10 === void 0 ? void 0 : _session10.username)) return;
    panelDrawingEditor.stages.drawn = form.querySelector('[name=drawn]').value;
  }
  function panelDrawingEditorView(order) {
    var _panelDrawingEditor2;
    if (order.local || !isPanelOrder(order) || !can('site.orders.manage') || ['dispatched', 'cancelled'].includes(order.status)) return '';
    if (((_panelDrawingEditor2 = panelDrawingEditor) === null || _panelDrawingEditor2 === void 0 ? void 0 : _panelDrawingEditor2.id) !== order.id) panelDrawingEditor = {
      id: order.id,
      owner: session.username,
      expectedUpdatedAt: order.updatedAt || order.createdAt || '',
      stages: panelStageValues(order),
      error: '',
      conflict: null
    };
    var draft = panelDrawingEditor;
    return "<section class=\"card site-order-history\"><h3>Update panel drawing status</h3><p>Mark Drawn complete when this order\u2019s drawings have been checked. CNC and QA progress update from workshop records.</p><form data-panel-drawing-progress><div class=\"grid\">".concat(panelStageFields.map(function (_ref15) {
      var _ref16 = _slicedToArray(_ref15, 2),
        key = _ref16[0],
        label = _ref16[1];
      return "<label>".concat(label, "<select name=\"").concat(key, "\" aria-label=\"").concat(label, "\" ").concat(panelDrawingSaving || key !== 'drawn' ? 'disabled' : '', ">").concat([['pending', 'Pending'], ['complete', 'Complete']].map(function (_ref17) {
        var _ref18 = _slicedToArray(_ref17, 2),
          value = _ref18[0],
          text = _ref18[1];
        return "<option value=\"".concat(value, "\" ").concat(draft.stages[key] === value ? 'selected' : '', ">").concat(text, "</option>");
      }).join(''), "</select></label>");
    }).join(''), "</div>").concat(draft.error ? "<p role=\"alert\" class=\"notice\">".concat(esc(draft.error), "</p>") : '').concat(draft.conflict ? "<div class=\"notice\"><p>The order changed. Latest recorded progress: ".concat(panelStageFields.map(function (_ref19) {
      var _ref20 = _slicedToArray(_ref19, 2),
        key = _ref20[0],
        label = _ref20[1];
      return esc(label) + ': ' + (panelStageValues(draft.conflict)[key] === 'complete' ? 'Complete' : 'Pending');
    }).join(' · '), ". Your entries are retained.</p><div class=\"actions\"><button type=\"button\" data-panel-drawing-latest>Use latest progress</button><button type=\"button\" data-panel-drawing-keep>Keep my changes</button></div></div>") : '', "<button type=\"submit\" class=\"primary\" ").concat(panelDrawingSaving || draft.conflict ? 'disabled' : '', ">").concat(panelDrawingSaving ? 'Saving…' : 'Save drawing status', "</button></form></section>");
  }
  function savePanelDrawing(_x15) {
    return _savePanelDrawing.apply(this, arguments);
  }
  function _savePanelDrawing() {
    _savePanelDrawing = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee32(event) {
      var draft, version, _result12$order$manua, response, _result12, _root$querySelector67, _t36;
      return _regenerator().w(function (_context33) {
        while (1) switch (_context33.p = _context33.n) {
          case 0:
            event.preventDefault();
            if (!(panelDrawingSaving || !panelDrawingEditor || panelDrawingEditor.conflict || !can('site.orders.manage'))) {
              _context33.n = 1;
              break;
            }
            return _context33.a(2);
          case 1:
            capturePanelDrawing();
            draft = panelDrawingEditor, version = sessionVersion;
            panelDrawingSaving = true;
            draft.error = '';
            render();
            _context33.p = 2;
            _context33.n = 3;
            return api('/orders/' + encodeURIComponent(draft.id) + '/drawing', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                expectedUpdatedAt: draft.expectedUpdatedAt,
                drawn: draft.stages.drawn === 'complete'
              })
            });
          case 3:
            response = _context33.v;
            _context33.n = 4;
            return response.json();
          case 4:
            _result12 = _context33.v;
            if (!(version !== sessionVersion)) {
              _context33.n = 5;
              break;
            }
            return _context33.a(2);
          case 5:
            if (!(response.status === 409 && _result12.code === 'ORDER_CONFLICT')) {
              _context33.n = 6;
              break;
            }
            orders = orders.map(function (order) {
              return order.id === draft.id ? _objectSpread(_objectSpread({}, order), _result12.order) : order;
            });
            draft.conflict = _result12.order;
            draft.error = 'Review the latest order before saving again.';
            return _context33.a(2);
          case 6:
            if (response.ok) {
              _context33.n = 7;
              break;
            }
            throw Error(_result12.error || 'Drawing status could not be saved.');
          case 7:
            orders = orders.map(function (order) {
              return order.id === draft.id ? _objectSpread(_objectSpread({}, order), _result12.order) : order;
            });
            if (panelDrawingEditor === draft) {
              (_root$querySelector67 = root.querySelector('[data-panel-drawing-progress]')) === null || _root$querySelector67 === void 0 || _root$querySelector67.remove();
              panelDrawingEditor = _objectSpread(_objectSpread({}, draft), {}, {
                expectedUpdatedAt: _result12.order.updatedAt,
                stages: panelStageValues(_result12.order),
                error: '',
                conflict: null
              });
            }
            message = _result12.unchanged ? 'Drawing status is unchanged.' : (_result12$order$manua = _result12.order.manualDrawing) !== null && _result12$order$manua !== void 0 && _result12$order$manua.drawn ? 'Panel order marked Drawn.' : 'Panel order Drawn reset to Pending.';
            if (view === 'order' && selectedOrderId === draft.id) {
              void loadProductionProgress(draft.id);
              void loadOrderHistory(draft.id);
            }
            _context33.n = 9;
            break;
          case 8:
            _context33.p = 8;
            _t36 = _context33.v;
            if (version === sessionVersion && panelDrawingEditor === draft) draft.error = _t36.message;
          case 9:
            _context33.p = 9;
            if (version === sessionVersion) {
              panelDrawingSaving = false;
              render();
            }
            return _context33.f(9);
          case 10:
            return _context33.a(2);
        }
      }, _callee32, null, [[2, 8, 9, 10]]);
    }));
    return _savePanelDrawing.apply(this, arguments);
  }
  function wirePanelDrawing() {
    var _root$querySelector8, _root$querySelector9;
    var form = root.querySelector('[data-panel-drawing-progress]');
    if (!form) return;
    form.onsubmit = savePanelDrawing;
    form.addEventListener('change', capturePanelDrawing);
    (_root$querySelector8 = root.querySelector('[data-panel-drawing-latest]')) === null || _root$querySelector8 === void 0 || _root$querySelector8.addEventListener('click', function () {
      var latest = panelDrawingEditor.conflict;
      form.remove();
      panelDrawingEditor = _objectSpread(_objectSpread({}, panelDrawingEditor), {}, {
        expectedUpdatedAt: latest.updatedAt || latest.createdAt || '',
        stages: panelStageValues(latest),
        error: '',
        conflict: null
      });
      render();
    });
    (_root$querySelector9 = root.querySelector('[data-panel-drawing-keep]')) === null || _root$querySelector9 === void 0 || _root$querySelector9.addEventListener('click', function () {
      capturePanelDrawing();
      var drawn = panelDrawingEditor.stages.drawn;
      panelDrawingEditor.stages = _objectSpread(_objectSpread({}, panelStageValues(panelDrawingEditor.conflict)), {}, {
        drawn: drawn
      });
      panelDrawingEditor.expectedUpdatedAt = panelDrawingEditor.conflict.updatedAt || panelDrawingEditor.conflict.createdAt || '';
      panelDrawingEditor.conflict = null;
      panelDrawingEditor.error = '';
      render();
    });
  }
  function loadProductionProgress(_x16) {
    return _loadProductionProgress.apply(this, arguments);
  }
  function _loadProductionProgress() {
    _loadProductionProgress = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee33(id) {
      var version, request, _result13$progress, response, _result13, _t37;
      return _regenerator().w(function (_context34) {
        while (1) switch (_context34.p = _context34.n) {
          case 0:
            version = sessionVersion, request = ++productionRequest;
            productionState = {
              id: id,
              loading: true
            };
            render();
            _context34.p = 1;
            _context34.n = 2;
            return api('/orders/' + encodeURIComponent(id) + '/progress');
          case 2:
            response = _context34.v;
            _context34.n = 3;
            return response.json();
          case 3:
            _result13 = _context34.v;
            if (response.ok) {
              _context34.n = 4;
              break;
            }
            throw Error(_result13.error || 'Production progress could not be loaded.');
          case 4:
            if (!(version !== sessionVersion || request !== productionRequest || selectedOrderId !== id)) {
              _context34.n = 5;
              break;
            }
            return _context34.a(2);
          case 5:
            if (!(((_result13$progress = _result13.progress) === null || _result13$progress === void 0 ? void 0 : _result13$progress.orderId) !== id || !Array.isArray(_result13.progress.stages))) {
              _context34.n = 6;
              break;
            }
            throw Error('Production progress is unavailable.');
          case 6:
            productionState = {
              id: id,
              progress: _result13.progress
            };
            _context34.n = 9;
            break;
          case 7:
            _context34.p = 7;
            _t37 = _context34.v;
            if (!(version !== sessionVersion || request !== productionRequest || selectedOrderId !== id)) {
              _context34.n = 8;
              break;
            }
            return _context34.a(2);
          case 8:
            productionState = {
              id: id,
              error: _t37.message || 'Production progress could not be loaded.'
            };
          case 9:
            if (view === 'order') render();
          case 10:
            return _context34.a(2);
        }
      }, _callee33, null, [[1, 7]]);
    }));
    return _loadProductionProgress.apply(this, arguments);
  }
  function orderProductionView(order) {
    if (order.local) return '';
    var state = productionState.id === order.id ? productionState : {};
    var heading = '<div class="site-production-heading"><h3>Production progress</h3><button type="button" data-refresh-production ' + (state.loading ? 'disabled' : '') + '>Refresh progress</button></div>';
    if (state.loading) return '<section class="card site-production">' + heading + '<p role="status">Loading production progress…</p></section>';
    if (!state.progress) return '<section class="card site-production">' + heading + '<p ' + (state.error ? 'role="alert"' : '') + '>' + esc(state.error || 'Refresh to load production progress.') + '</p></section>';
    var progress = state.progress,
      labels = {
        complete: 'Complete',
        pending: 'Pending',
        not_applicable: 'Not applicable'
      };
    return '<section class="card site-production">' + heading + (progress.cancelled ? '<p class="notice">This order is cancelled. Production stages show the recorded work; it is not ready for dispatch.</p>' : '') + '<ol class="site-production-stages">' + progress.stages.map(function (stage) {
      var state = Object.prototype.hasOwnProperty.call(labels, stage.state) ? stage.state : 'pending';
      return '<li class="site-production-stage is-' + state + '"><span aria-hidden="true">' + (state === 'complete' ? '✓' : state === 'not_applicable' ? '—' : '○') + '</span><div><strong>' + esc(stage.label) + '</strong><small>' + labels[state] + '</small></div></li>';
    }).join('') + '</ol>' + (progress.notes ? '<p class="site-production-notes">' + esc(progress.notes) + '</p>' : '') + '<p class="site-production-help">' + (isGateOrder(order) ? 'Mark Drawn to send Gates to QA. Fabricated/QA and readiness update after QA approval. Other stages are not applicable.' : isPanelOrder(order) ? 'Drawn can be marked manually. Other progress updates from workshop records.' : 'Progress updates from the workshop records. Pending stages may still be in progress.') + '</p></section>';
  }
  function mountDeliveryPad(canvas) {
    var _ref21 = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {},
      _ref21$value = _ref21.value,
      value = _ref21$value === void 0 ? '' : _ref21$value,
      _ref21$onChange = _ref21.onChange,
      onChange = _ref21$onChange === void 0 ? function () {} : _ref21$onChange,
      _ref21$disabled = _ref21.disabled,
      disabled = _ref21$disabled === void 0 ? function () {
        return false;
      } : _ref21$disabled;
    var ctx = canvas.getContext('2d');
    canvas.width = 900;
    canvas.height = 300;
    var pointer = null,
      last = null,
      ink = false,
      dirty = false,
      active = true,
      revision = 0;
    var blank = function blank() {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 900, 300);
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    };
    function setValue(image) {
      var token = ++revision;
      blank();
      ink = false;
      if ((image === null || image === void 0 ? void 0 : image.length) > 150000 || !/^data:image\/png;base64,/.test(image || '')) return;
      var restored = new Image();
      restored.onload = function () {
        if (active && token === revision) {
          ctx.drawImage(restored, 0, 0, 900, 300);
          ink = true;
        }
      };
      restored.src = image;
    }
    var point = function point(event) {
      var rect = canvas.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(900, (event.clientX - rect.left) * 900 / rect.width)),
        y: Math.max(0, Math.min(300, (event.clientY - rect.top) * 300 / rect.height))
      };
    };
    var down = function down(event) {
      var _canvas$setPointerCap;
      if (disabled() || event.button > 0 || pointer !== null) return;
      event.preventDefault();
      revision++;
      pointer = event.pointerId;
      last = point(event);
      dirty = false;
      if (typeof pointer === 'number') (_canvas$setPointerCap = canvas.setPointerCapture) === null || _canvas$setPointerCap === void 0 || _canvas$setPointerCap.call(canvas, pointer);
    };
    var move = function move(event) {
      if (event.pointerId !== pointer || disabled()) return;
      event.preventDefault();
      var next = point(event);
      if (Math.hypot(next.x - last.x, next.y - last.y) < 2) return;
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(next.x, next.y);
      ctx.stroke();
      last = next;
      ink = true;
      dirty = true;
    };
    var end = function end(event) {
      if (event.pointerId !== pointer) return;
      var blocked = disabled();
      if (!blocked && event.type !== 'pointercancel') move(event);
      try {
        var _canvas$releasePointe;
        if (typeof pointer === 'number') (_canvas$releasePointe = canvas.releasePointerCapture) === null || _canvas$releasePointe === void 0 || _canvas$releasePointe.call(canvas, pointer);
      } catch (_unused4) {}
      pointer = null;
      last = null;
      if (!blocked && dirty && ink) onChange(canvas.toDataURL('image/png'));
    };
    var cleanup = [];
    var listen = function listen(node, event, handler, options) {
      node.addEventListener(event, handler, options);
      cleanup.push(function () {
        return node.removeEventListener(event, handler, options);
      });
    };
    if (window.PointerEvent) {
      for (var _i2 = 0, _Object$entries2 = Object.entries({
          pointerdown: down,
          pointermove: move,
          pointerup: end,
          pointercancel: end
        }); _i2 < _Object$entries2.length; _i2++) {
        var _Object$entries2$_i = _slicedToArray(_Object$entries2[_i2], 2),
          event = _Object$entries2$_i[0],
          handler = _Object$entries2$_i[1];
        listen(canvas, event, handler);
      }
    } else {
      var mouse = function mouse(event) {
        return {
          button: event.button,
          pointerId: 'mouse',
          clientX: event.clientX,
          clientY: event.clientY,
          preventDefault: function preventDefault() {
            return event.preventDefault();
          }
        };
      };
      listen(canvas, 'mousedown', function (event) {
        return down(mouse(event));
      });
      listen(window, 'mousemove', function (event) {
        return move(mouse(event));
      });
      listen(window, 'mouseup', function (event) {
        return end(mouse(event));
      });
      var touches = function touches(event, fn) {
        for (var _i3 = 0, _Array$from = Array.from(event.changedTouches || []); _i3 < _Array$from.length; _i3++) {
          var touch = _Array$from[_i3];
          fn({
            type: event.type === 'touchcancel' ? 'pointercancel' : event.type,
            button: 0,
            pointerId: 'touch' + touch.identifier,
            clientX: touch.clientX,
            clientY: touch.clientY,
            preventDefault: function preventDefault() {
              return event.preventDefault();
            }
          });
        }
      };
      listen(canvas, 'touchstart', function (event) {
        return touches(event, down);
      }, {
        passive: false
      });
      listen(canvas, 'touchmove', function (event) {
        return touches(event, move);
      }, {
        passive: false
      });
      listen(canvas, 'touchend', function (event) {
        return touches(event, end);
      }, {
        passive: false
      });
      listen(canvas, 'touchcancel', function (event) {
        return touches(event, end);
      }, {
        passive: false
      });
    }
    setValue(value);
    return {
      setValue: setValue,
      clear: function clear() {
        var notify = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : true;
        revision++;
        pointer = null;
        last = null;
        ink = false;
        blank();
        if (notify) onChange('');
      },
      destroy: function destroy() {
        active = false;
        revision++;
        for (var _i4 = 0, _cleanup = cleanup; _i4 < _cleanup.length; _i4++) {
          var stop = _cleanup[_i4];
          stop();
        }
      }
    };
  }
  var receiptDraft = null,
    receiptConflict = null,
    receiptSaving = false,
    receiptPad = null,
    deliveryQuery = '',
    receiptPhotoBusy = false,
    receiptPhotoPreviewUrl = '';
  var receiptAllowed = function receiptAllowed(order) {
    var _session11, _session12;
    return ((_session11 = session) === null || _session11 === void 0 ? void 0 : _session11.isAdmin) || can('site.orders.manage') || can('site.orders.create') && order.requestedBy === ((_session12 = session) === null || _session12 === void 0 ? void 0 : _session12.username);
  };
  function receiptKey(id) {
    return 'panelstock:receipt:' + session.username + ':' + id;
  }
  function receiptTotals(order) {
    return (order.items || []).map(function (item, index) {
      var accepted = (order.receipts || []).reduce(function (sum, receipt) {
        var _receipt$lines$find;
        return sum + (((_receipt$lines$find = receipt.lines.find(function (line) {
          return line.index === index;
        })) === null || _receipt$lines$find === void 0 ? void 0 : _receipt$lines$find.accepted) || 0);
      }, 0);
      return _objectSpread(_objectSpread({}, item), {}, {
        index: index,
        accepted: accepted,
        outstanding: Math.max(0, Number(item.quantity) - accepted)
      });
    });
  }
  var canReceiveOrder = function canReceiveOrder(order) {
    return !order.local && order.status === 'dispatched' && receiptAllowed(order) && receiptTotals(order).some(function (line) {
      return line.outstanding > 0;
    });
  };
  function persistReceipt() {
    try {
      deviceStorage.setItem(receiptKey(receiptDraft.orderId), JSON.stringify(receiptDraft));
      return true;
    } catch (_unused5) {
      return false;
    }
  }
  function receiptBodyLines(draft) {
    if (draft.mode === 'site-checklist') return draft.lines.map(function (line) {
      var accepted = line.arrived ? Number(line.accepted) : 0;
      return {
        index: line.index,
        arrived: !!line.arrived,
        accepted: accepted,
        damaged: 0,
        missing: Math.max(0, Number(line.outstanding) - accepted)
      };
    });
    return draft.lines.map(function (line) {
      return {
        index: line.index,
        arrived: !!line.arrived,
        accepted: line.arrived ? Number(line.accepted) : 0,
        damaged: line.arrived ? Number(line.damaged) : 0,
        missing: Number(line.missing),
        replacementIssueId: line.replacementIssueId || ''
      };
    }).filter(function (line) {
      return line.accepted || line.damaged || line.missing;
    });
  }
  function receiptContent(draft) {
    var _draft$acknowledgemen, _draft$deliveryPhoto;
    return JSON.stringify([receiptBodyLines(draft), String(draft.notes || '').trim(), (draft.attachmentIds || []).slice().sort(), String(((_draft$acknowledgemen = draft.acknowledgement) === null || _draft$acknowledgemen === void 0 ? void 0 : _draft$acknowledgemen.name) || '').trim(), ((_draft$deliveryPhoto = draft.deliveryPhoto) === null || _draft$deliveryPhoto === void 0 ? void 0 : _draft$deliveryPhoto.id) || '']);
  }
  function captureReceipt() {
    var _session13, _form$querySelector2;
    var form = root.querySelector('[data-receipt-form]');
    if (!form || !receiptDraft || receiptDraft.owner !== ((_session13 = session) === null || _session13 === void 0 ? void 0 : _session13.username)) return;
    var before = receiptContent(receiptDraft);
    receiptDraft.lines = receiptDraft.mode === 'site-checklist' ? _toConsumableArray(form.querySelectorAll('[data-receipt-line]')).map(function (row) {
      return {
        index: Number(row.dataset.receiptLine),
        outstanding: Number(row.dataset.outstanding),
        arrived: !!row.querySelector('[name=arrived]').checked,
        accepted: row.querySelector('[name=accepted]').value
      };
    }) : _toConsumableArray(form.querySelectorAll('[data-receipt-line]')).map(function (row) {
      var _row$querySelector, _row$querySelector2;
      return {
        index: Number(row.dataset.receiptLine),
        arrived: !!((_row$querySelector = row.querySelector('[name=arrived]')) !== null && _row$querySelector !== void 0 && _row$querySelector.checked),
        accepted: row.querySelector('[name=accepted]').value,
        damaged: row.querySelector('[name=damaged]').value,
        missing: row.querySelector('[name=missing]').value,
        replacementIssueId: ((_row$querySelector2 = row.querySelector('[name=replacementIssueId]')) === null || _row$querySelector2 === void 0 ? void 0 : _row$querySelector2.value) || '',
        manual: row.dataset.manual === 'true'
      };
    });
    receiptDraft.notes = form.querySelector('[name=receiptNotes]').value;
    receiptDraft.attachmentIds = receiptDraft.mode === 'site-checklist' ? [] : _toConsumableArray(form.querySelectorAll('[data-receipt-file]:checked')).map(function (input) {
      return input.value;
    });
    receiptDraft.acknowledgement = _objectSpread(_objectSpread({}, receiptDraft.acknowledgement), {}, {
      name: ((_form$querySelector2 = form.querySelector('[name=recipientName]')) === null || _form$querySelector2 === void 0 ? void 0 : _form$querySelector2.value) || ''
    });
    if (before !== receiptContent(receiptDraft) && receiptDraft.acknowledgement.image) {
      var _receiptPad;
      receiptDraft.acknowledgement.image = '';
      (_receiptPad = receiptPad) === null || _receiptPad === void 0 || _receiptPad.clear(false);
      var hint = root.querySelector('[data-signature-hint]');
      if (hint) hint.textContent = 'Delivery details changed. Please sign again.';
    }
    persistReceipt();
  }
  function ensureReceiptDraft(order) {
    var _receiptDraft, _saved, _saved2, _profile3, _receiptDraft2, _profile4;
    if (((_receiptDraft = receiptDraft) === null || _receiptDraft === void 0 ? void 0 : _receiptDraft.orderId) === order.id && receiptDraft.owner === session.username) return;
    receiptConflict = null;
    var saved;
    try {
      saved = JSON.parse(deviceStorage.getItem(receiptKey(order.id)) || 'null');
    } catch (_unused6) {}
    var valid = ((_saved = saved) === null || _saved === void 0 ? void 0 : _saved.owner) === session.username && saved.orderId === order.id && !(order.receipts || []).some(function (receipt) {
      return receipt.id === saved.id;
    });
    if (((_saved2 = saved) === null || _saved2 === void 0 ? void 0 : _saved2.owner) === session.username && !valid && (order.receipts || []).some(function (receipt) {
      return receipt.id === saved.id;
    }) && saved.deliveryPhoto) void attachmentDb('delete', [{
      id: saved.deliveryPhoto.storageId || saved.deliveryPhoto.id
    }]).catch(function () {});
    receiptDraft = valid ? saved : {
      owner: session.username,
      orderId: order.id,
      id: crypto.randomUUID(),
      mode: mobileHost ? 'legacy' : 'site-checklist',
      expectedUpdatedAt: order.updatedAt || order.createdAt || '',
      lines: [],
      notes: '',
      attachmentIds: [],
      acknowledgement: {
        name: ((_profile3 = profile) === null || _profile3 === void 0 ? void 0 : _profile3.displayName) || session.username || '',
        image: ''
      }
    };
    (_receiptDraft2 = receiptDraft).acknowledgement || (_receiptDraft2.acknowledgement = {
      name: ((_profile4 = profile) === null || _profile4 === void 0 ? void 0 : _profile4.displayName) || session.username || '',
      image: ''
    });
    if (!mobileHost && receiptDraft.mode !== 'site-checklist') {
      receiptDraft.mode = 'site-checklist';
      receiptDraft.attachmentIds = [];
      receiptDraft.acknowledgement.image = '';
    }
    var _iterator3 = _createForOfIteratorHelper(receiptTotals(order).filter(function (line) {
        return line.outstanding > 0;
      })),
      _step3;
    try {
      var _loop2 = function _loop2() {
        var line = _step3.value;
        var prior = receiptDraft.lines.find(function (row) {
          return row.index === line.index;
        });
        if (prior) {
          prior.outstanding = line.outstanding;
          if (prior.arrived === undefined) {
            prior.arrived = Number(prior.accepted) + Number(prior.damaged || 0) > 0;
            if (!prior.arrived) prior.accepted = line.outstanding;
          }
          if (receiptDraft.mode === 'site-checklist' && !prior.arrived) prior.accepted = line.outstanding;
        } else receiptDraft.lines.push({
          index: line.index,
          outstanding: line.outstanding,
          arrived: false,
          accepted: line.outstanding,
          damaged: 0,
          missing: 0,
          replacementIssueId: '',
          manual: false
        });
      };
      for (_iterator3.s(); !(_step3 = _iterator3.n()).done;) {
        _loop2();
      }
    } catch (err) {
      _iterator3.e(err);
    } finally {
      _iterator3.f();
    }
  }
  function siteReceiptForm(order) {
    var draft = receiptDraft,
      locked = receiptSaving || receiptPhotoBusy,
      lines = receiptTotals(order).filter(function (line) {
        return line.outstanding > 0;
      });
    return "<form data-receipt-form novalidate class=\"delivery-receipt-form site-receipt-checklist\">\n      <section class=\"site-receipt-section site-receipt-stock\" aria-labelledby=\"receipt-items-heading\">\n        <div class=\"site-receipt-section-heading\"><h3 id=\"receipt-items-heading\">Items received</h3><span>".concat(lines.length, " ").concat(lines.length === 1 ? 'item' : 'items', "</span></div>\n        <p class=\"site-receipt-help\">Tick the items that arrived and confirm quantities. Unticked items and short quantities are recorded as missing.</p>\n        <div class=\"site-receipt-items\">").concat(lines.map(function (line) {
      var row = draft.lines.find(function (row) {
        return row.index === line.index;
      });
      return "<div class=\"site-receipt-item\" data-receipt-line=\"".concat(line.index, "\" data-outstanding=\"").concat(line.outstanding, "\">\n          <div class=\"site-receipt-item-name\"><span class=\"site-receipt-description\">").concat(esc(line.description), "</span><small>").concat(esc(line.outstanding), " outstanding</small></div>\n          <div class=\"site-receipt-item-controls\"><label class=\"site-receipt-quantity\">Qty received<input aria-label=\"Quantity accepted: ").concat(esc(line.description), "\" name=\"accepted\" type=\"number\" inputmode=\"decimal\" min=\"0\" max=\"").concat(line.outstanding, "\" step=\"any\" value=\"").concat(esc(row.accepted), "\" required ").concat(!row.arrived || locked ? 'disabled' : '', "></label><label class=\"site-receipt-arrived\"><input name=\"arrived\" type=\"checkbox\" aria-label=\"Item arrived: ").concat(esc(line.description), "\" ").concat(row.arrived ? 'checked' : '', " ").concat(locked ? 'disabled' : '', ">Received</label></div>\n        </div>");
    }).join(''), "</div>\n      </section>\n      <section class=\"site-receipt-section site-receipt-details\" aria-labelledby=\"receipt-details-heading\">\n        <h3 id=\"receipt-details-heading\">Delivery details <span class=\"site-receipt-optional\">Optional</span></h3>\n        <label>Delivery notes<textarea name=\"receiptNotes\" rows=\"2\" maxlength=\"1000\" placeholder=\"Add any delivery details\u2026\" ").concat(locked ? 'disabled' : '', ">").concat(esc(draft.notes), "</textarea></label>\n        <fieldset class=\"site-receipt-photo\"><legend>Delivery photo</legend><div class=\"actions\"><label class=\"order-upload-button\">Take photo<input data-receipt-photo type=\"file\" accept=\"image/*\" capture=\"environment\" aria-label=\"Take delivery photo\" ").concat(locked ? 'disabled' : '', "></label><label class=\"order-upload-button\">Choose photo<input data-receipt-photo type=\"file\" accept=\"image/*\" aria-label=\"Choose delivery photo\" ").concat(locked ? 'disabled' : '', "></label></div>").concat(receiptPhotoBusy ? '<p role="status">Preparing delivery photo…</p>' : '').concat(draft.deliveryPhoto ? "<p>".concat(esc(draft.deliveryPhoto.name), "</p><img data-receipt-photo-preview alt=\"Selected delivery photo\"><button type=\"button\" data-remove-receipt-photo ").concat(locked ? 'disabled' : '', ">Remove photo</button>") : '', "</fieldset>\n      </section>\n      <section class=\"delivery-ack site-receipt-section\" aria-labelledby=\"receipt-ack-heading\">\n        <h3 id=\"receipt-ack-heading\">Recipient acknowledgement</h3><p class=\"site-receipt-help\">I acknowledge the quantities received and the items recorded as missing above.</p>\n        <label><span>Recipient name <span class=\"site-required\" aria-hidden=\"true\">*</span></span><input name=\"recipientName\" required maxlength=\"120\" autocomplete=\"name\" value=\"").concat(esc(draft.acknowledgement.name), "\" ").concat(locked ? 'disabled' : '', "></label>\n        <div class=\"site-receipt-signature-heading\"><span>Recipient signature <span class=\"site-required\" aria-hidden=\"true\">*</span></span><button type=\"button\" data-clear-receipt-signature ").concat(locked ? 'disabled' : '', ">Clear signature</button></div>\n        <canvas data-receipt-signature tabindex=\"0\" aria-label=\"Recipient signature\" aria-describedby=\"receipt-signature-hint\" class=\"delivery-signature\"></canvas><p id=\"receipt-signature-hint\" data-signature-hint>Complete the delivery details before signing.</p>\n      </section>\n      <div class=\"site-receipt-submit\"><p role=\"alert\" data-receipt-error>").concat(esc(draft.error || ''), "</p>").concat(receiptConflict ? '<div class="notice">This order changed. Review the latest outstanding quantities and sign again.<button type="button" data-review-receipt>Review latest totals</button></div>' : '', "<button class=\"primary\" type=\"submit\" ").concat(locked || receiptConflict ? 'disabled' : '', ">").concat(receiptSaving ? 'Saving…' : 'Confirm delivery', "</button></div>\n    </form>");
  }
  function clearReceiptSignature() {
    var _receiptPad2;
    if (!receiptDraft) return;
    receiptDraft.acknowledgement.image = '';
    (_receiptPad2 = receiptPad) === null || _receiptPad2 === void 0 || _receiptPad2.clear(false);
  }
  function deliveryPhotoFile(_x17) {
    return _deliveryPhotoFile.apply(this, arguments);
  }
  function _deliveryPhotoFile() {
    _deliveryPhotoFile = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee34(file) {
      var source, picture, canvas, scale, _i7, _arr3, quality, data, bytes;
      return _regenerator().w(function (_context35) {
        while (1) switch (_context35.n) {
          case 0:
            if (!(!file || !String(file.type || '').startsWith('image/'))) {
              _context35.n = 1;
              break;
            }
            throw Error('Choose a photo.');
          case 1:
            if (!(file.size > 20 * 1024 * 1024)) {
              _context35.n = 2;
              break;
            }
            throw Error('Choose a photo up to 20 MB.');
          case 2:
            _context35.n = 3;
            return new Promise(function (resolve, reject) {
              var reader = new FileReader();
              reader.onload = function () {
                return resolve(reader.result);
              };
              reader.onerror = function () {
                return reject(Error('Delivery photo could not be read.'));
              };
              reader.readAsDataURL(file);
            });
          case 3:
            source = _context35.v;
            _context35.n = 4;
            return new Promise(function (resolve, reject) {
              var image = new Image();
              image.onload = function () {
                return resolve(image);
              };
              image.onerror = function () {
                return reject(Error('This photo could not be opened. Choose another JPEG or PNG photo.'));
              };
              image.src = source;
            });
          case 4:
            picture = _context35.v;
            if (!(!picture.naturalWidth || !picture.naturalHeight)) {
              _context35.n = 5;
              break;
            }
            throw Error('Choose a valid photo.');
          case 5:
            canvas = document.createElement('canvas'), scale = Math.min(1, 1600 / Math.max(picture.naturalWidth, picture.naturalHeight));
            canvas.width = Math.max(1, Math.round(picture.naturalWidth * scale));
            canvas.height = Math.max(1, Math.round(picture.naturalHeight * scale));
            canvas.getContext('2d').drawImage(picture, 0, 0, canvas.width, canvas.height);
            _i7 = 0, _arr3 = [.85, .7, .55, .4];
          case 6:
            if (!(_i7 < _arr3.length)) {
              _context35.n = 8;
              break;
            }
            quality = _arr3[_i7];
            data = canvas.toDataURL('image/jpeg', quality).split(',')[1], bytes = Uint8Array.from(atob(data), function (c) {
              return c.charCodeAt(0);
            });
            if (!(bytes.length <= 1024 * 1024)) {
              _context35.n = 7;
              break;
            }
            return _context35.a(2, new Blob([bytes], {
              type: 'image/jpeg'
            }));
          case 7:
            _i7++;
            _context35.n = 6;
            break;
          case 8:
            throw Error('Choose a smaller delivery photo.');
          case 9:
            return _context35.a(2);
        }
      }, _callee34);
    }));
    return _deliveryPhotoFile.apply(this, arguments);
  }
  function chooseReceiptPhoto(_x18) {
    return _chooseReceiptPhoto.apply(this, arguments);
  }
  function _chooseReceiptPhoto() {
    _chooseReceiptPhoto = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee35(event) {
      var _event$target$files4;
      var file, draft, owner, version, previous, stored, saved, id, _session44, _session45, blob, _session46, _session47, _t38;
      return _regenerator().w(function (_context36) {
        while (1) switch (_context36.p = _context36.n) {
          case 0:
            if (!(receiptSaving || receiptPhotoBusy)) {
              _context36.n = 1;
              break;
            }
            return _context36.a(2);
          case 1:
            file = (_event$target$files4 = event.target.files) === null || _event$target$files4 === void 0 ? void 0 : _event$target$files4[0];
            if (file) {
              _context36.n = 2;
              break;
            }
            return _context36.a(2);
          case 2:
            captureReceipt();
            draft = receiptDraft, owner = session.username, version = sessionVersion, previous = draft.deliveryPhoto;
            stored = false, saved = false, id = crypto.randomUUID();
            receiptPhotoBusy = true;
            render();
            _context36.p = 3;
            _context36.n = 4;
            return deliveryPhotoFile(file);
          case 4:
            blob = _context36.v;
            if (!(version !== sessionVersion || ((_session44 = session) === null || _session44 === void 0 ? void 0 : _session44.username) !== owner || receiptDraft !== draft)) {
              _context36.n = 5;
              break;
            }
            return _context36.a(2);
          case 5:
            _context36.n = 6;
            return attachmentDb('put', [{
              id: id,
              file: blob
            }]);
          case 6:
            stored = true;
            if (!(version !== sessionVersion || ((_session45 = session) === null || _session45 === void 0 ? void 0 : _session45.username) !== owner || receiptDraft !== draft)) {
              _context36.n = 7;
              break;
            }
            return _context36.a(2);
          case 7:
            draft.deliveryPhoto = {
              id: id,
              storageId: id,
              name: (String(file.name || 'Delivery photo').replace(/\.[^.]+$/, '').replace(/[\u0000-\u001f\u007f\\/]/g, '_').slice(0, 190) || 'Delivery photo') + '.jpg',
              size: blob.size
            };
            clearReceiptSignature();
            if (persistReceipt()) {
              _context36.n = 8;
              break;
            }
            draft.deliveryPhoto = previous;
            throw Error('Could not save this delivery photo on the device. Try again.');
          case 8:
            saved = true;
            draft.error = '';
            if (previous) void attachmentDb('delete', [{
              id: previous.storageId || previous.id
            }]).catch(function () {});
            _context36.n = 10;
            break;
          case 9:
            _context36.p = 9;
            _t38 = _context36.v;
            if (version === sessionVersion && ((_session46 = session) === null || _session46 === void 0 ? void 0 : _session46.username) === owner && receiptDraft === draft) draft.error = _t38.message;
          case 10:
            _context36.p = 10;
            if (!(stored && !saved)) {
              _context36.n = 11;
              break;
            }
            _context36.n = 11;
            return attachmentDb('delete', [{
              id: id
            }]).catch(function () {});
          case 11:
            if (version === sessionVersion && ((_session47 = session) === null || _session47 === void 0 ? void 0 : _session47.username) === owner) {
              receiptPhotoBusy = false;
              render();
            }
            return _context36.f(10);
          case 12:
            return _context36.a(2);
        }
      }, _callee35, null, [[3, 9, 10, 12]]);
    }));
    return _chooseReceiptPhoto.apply(this, arguments);
  }
  function removeReceiptPhoto() {
    return _removeReceiptPhoto.apply(this, arguments);
  }
  function _removeReceiptPhoto() {
    _removeReceiptPhoto = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee36() {
      var _receiptDraft4;
      var previous;
      return _regenerator().w(function (_context37) {
        while (1) switch (_context37.n) {
          case 0:
            if (!(receiptSaving || receiptPhotoBusy || !((_receiptDraft4 = receiptDraft) !== null && _receiptDraft4 !== void 0 && _receiptDraft4.deliveryPhoto))) {
              _context37.n = 1;
              break;
            }
            return _context37.a(2);
          case 1:
            captureReceipt();
            previous = receiptDraft.deliveryPhoto;
            delete receiptDraft.deliveryPhoto;
            clearReceiptSignature();
            if (!persistReceipt()) {
              receiptDraft.deliveryPhoto = previous;
              receiptDraft.error = 'Could not remove the saved delivery photo. Try again.';
            } else void attachmentDb('delete', [{
              id: previous.storageId || previous.id
            }]).catch(function () {});
            render();
          case 2:
            return _context37.a(2);
        }
      }, _callee36);
    }));
    return _removeReceiptPhoto.apply(this, arguments);
  }
  function mountReceiptPhotoPreview(form) {
    var _receiptDraft3, _session14;
    var photo = (_receiptDraft3 = receiptDraft) === null || _receiptDraft3 === void 0 ? void 0 : _receiptDraft3.deliveryPhoto,
      owner = (_session14 = session) === null || _session14 === void 0 ? void 0 : _session14.username,
      version = sessionVersion,
      target = form.querySelector('[data-receipt-photo-preview]');
    if (!photo || !target) return;
    attachmentDb('get', photo.storageId || photo.id).then(function (file) {
      var _session15;
      if (!file || version !== sessionVersion || ((_session15 = session) === null || _session15 === void 0 ? void 0 : _session15.username) !== owner || !target.isConnected) return;
      receiptPhotoPreviewUrl = URL.createObjectURL(file);
      target.src = receiptPhotoPreviewUrl;
    }).catch(function () {});
  }
  function receiptForm(order) {
    ensureReceiptDraft(order);
    if (!mobileHost) return siteReceiptForm(order);
    var draft = receiptDraft;
    return "<form data-receipt-form novalidate class=\"delivery-receipt-form\"><p>Check each item that arrived, confirm its quantity, then ask the recipient to sign. Quantities start at the amount still outstanding.</p>".concat(receiptTotals(order).map(function (line) {
      if (!line.outstanding) return "<article class=\"delivery-line\"><strong>".concat(esc(line.description), "</strong><p>Ordered ").concat(esc(line.quantity), " \xB7 Received in full</p></article>");
      var row = draft.lines.find(function (row) {
        return row.index === line.index;
      });
      return "<fieldset class=\"delivery-line\" data-receipt-line=\"".concat(line.index, "\" data-manual=\"").concat(!!row.manual, "\" data-outstanding=\"").concat(line.outstanding, "\"><legend>").concat(esc(line.description), "</legend><p>Ordered ").concat(esc(line.quantity), " \xB7 Previously accepted ").concat(esc(line.accepted), " \xB7 Outstanding ").concat(esc(line.outstanding), "</p><label class=\"delivery-arrived\"><input name=\"arrived\" type=\"checkbox\" ").concat(row.arrived ? 'checked' : '', " ").concat(receiptSaving ? 'disabled' : '', "> Item arrived</label><label>Quantity accepted<input aria-label=\"Quantity accepted: ").concat(esc(line.description), "\" name=\"accepted\" type=\"number\" min=\"0\" max=\"").concat(line.outstanding, "\" step=\"any\" value=\"").concat(esc(row.accepted), "\" required ").concat(!row.arrived || receiptSaving ? 'disabled' : '', "></label><details><summary>Missing, damaged or replacement items</summary><div class=\"grid\"><label>Damaged<input name=\"damaged\" type=\"number\" min=\"0\" max=\"").concat(line.outstanding, "\" step=\"any\" value=\"").concat(esc(row.damaged || 0), "\" ").concat(!row.arrived || receiptSaving ? 'disabled' : '', "></label><label>Missing<input name=\"missing\" type=\"number\" min=\"0\" max=\"").concat(line.outstanding, "\" step=\"any\" value=\"").concat(esc(row.missing || 0), "\" ").concat(receiptSaving ? 'disabled' : '', "></label></div><label>Replacement for<select name=\"replacementIssueId\" ").concat(receiptSaving ? 'disabled' : '', "><option value=\"\">Normal delivery</option>").concat((order.deliveryIssues || []).filter(function (issue) {
        return issue.index === line.index && issue.status !== 'resolved' && issue.remaining > 0;
      }).map(function (issue) {
        return "<option value=\"".concat(esc(issue.id), "\" ").concat(row.replacementIssueId === issue.id ? 'selected' : '', ">").concat(esc(issue.description), " \xB7 ").concat(esc(issue.remaining), " awaiting replacement</option>");
      }).join(''), "</select></label></details></fieldset>");
    }).join(''), "<label>Delivery notes<textarea name=\"receiptNotes\" rows=\"3\" maxlength=\"1000\" ").concat(receiptSaving ? 'disabled' : '', ">").concat(esc(draft.notes), "</textarea></label>").concat((order.attachments || []).length ? "<fieldset><legend>Delivery evidence</legend>".concat(order.attachments.map(function (file) {
      return "<label class=\"delivery-arrived\"><input data-receipt-file type=\"checkbox\" value=\"".concat(esc(file.id), "\" ").concat(draft.attachmentIds.includes(file.id) ? 'checked' : '', " ").concat(receiptSaving ? 'disabled' : '', ">").concat(esc(file.name), "</label>");
    }).join(''), "</fieldset>") : '', "<section class=\"delivery-ack\"><h3>Recipient acknowledgement</h3><p>I acknowledge the delivery quantities and notes recorded above, including any missing or damaged items.</p><label><span>Recipient name <span class=\"site-required\" aria-hidden=\"true\">*</span></span><input name=\"recipientName\" required maxlength=\"120\" value=\"").concat(esc(draft.acknowledgement.name), "\" ").concat(receiptSaving ? 'disabled' : '', "></label><label><span>Recipient signature <span class=\"site-required\" aria-hidden=\"true\">*</span></span></label><canvas data-receipt-signature tabindex=\"0\" aria-label=\"Recipient signature\" class=\"delivery-signature\"></canvas><button type=\"button\" data-clear-receipt-signature ").concat(receiptSaving ? 'disabled' : '', ">Clear signature</button><p data-signature-hint>Complete the delivery details before signing.</p></section><p role=\"alert\" data-receipt-error>").concat(esc(draft.error || ''), "</p>").concat(receiptConflict ? '<div class="notice">This order changed. Review the latest outstanding quantities and sign again.<button type="button" data-review-receipt>Review latest totals</button></div>' : '', "<button class=\"primary\" type=\"submit\" ").concat(receiptSaving || receiptConflict ? 'disabled' : '', ">").concat(receiptSaving ? 'Saving…' : 'Confirm delivery', "</button></form>");
  }
  function receiptPhotoLink(orderId, receiptId, photo) {
    return photo ? "<div><button type=\"button\" data-delivery-photo=\"".concat(esc(photo.id), "\" data-photo-order=\"").concat(esc(orderId), "\" data-photo-receipt=\"").concat(esc(receiptId), "\">View delivery photo</button><div data-delivery-photo-view></div></div>") : '';
  }
  function wireReceiptPhotos() {
    root.querySelectorAll('[data-delivery-photo]').forEach(function (button) {
      return button.onclick = /*#__PURE__*/_asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee() {
        var owner, version, _session16, response, result, target, _t;
        return _regenerator().w(function (_context) {
          while (1) switch (_context.p = _context.n) {
            case 0:
              owner = session.username, version = sessionVersion;
              button.disabled = true;
              _context.p = 1;
              _context.n = 2;
              return api('/orders/' + encodeURIComponent(button.dataset.photoOrder) + '/receipts/' + encodeURIComponent(button.dataset.photoReceipt) + '/photos/' + encodeURIComponent(button.dataset.deliveryPhoto));
            case 2:
              response = _context.v;
              _context.n = 3;
              return response.json();
            case 3:
              result = _context.v;
              if (!(version !== sessionVersion || ((_session16 = session) === null || _session16 === void 0 ? void 0 : _session16.username) !== owner || !button.isConnected)) {
                _context.n = 4;
                break;
              }
              return _context.a(2);
            case 4:
              if (response.ok) {
                _context.n = 5;
                break;
              }
              throw Error(result.error || 'Delivery photo could not be loaded');
            case 5:
              target = button.parentElement.querySelector('[data-delivery-photo-view]');
              target.innerHTML = "<img class=\"site-delivery-evidence\" src=\"data:".concat(esc(result.photo.contentType), ";base64,").concat(esc(result.photo.data), "\" alt=\"Delivery photo\">");
              _context.n = 7;
              break;
            case 6:
              _context.p = 6;
              _t = _context.v;
              if (version === sessionVersion && button.isConnected) button.parentElement.querySelector('[data-delivery-photo-view]').textContent = _t.message;
            case 7:
              _context.p = 7;
              if (button.isConnected) button.disabled = false;
              return _context.f(7);
            case 8:
              return _context.a(2);
          }
        }, _callee, null, [[1, 6, 7, 8]]);
      }));
    });
  }
  function deliveryReceipts(order) {
    if (order.local) return '';
    var history = (order.receipts || []).map(function (receipt) {
      return "<article class=\"site-receipt-history\"><strong>".concat(esc(new Date(receipt.at).toLocaleString('en-AU')), " \xB7 ").concat(esc(receipt.by), "</strong>").concat(receipt.lines.filter(function (line) {
        return line.accepted || line.damaged || line.missing;
      }).map(function (line) {
        return "<p>".concat(esc(line.description), ": ").concat(esc(line.accepted), " accepted \xB7 ").concat(esc(line.damaged), " damaged \xB7 ").concat(esc(line.missing), " missing</p>");
      }).join(''), "<p style=\"white-space:pre-wrap\">").concat(esc(receipt.notes), "</p>").concat(!mobileHost && receiptAllowed(order) ? receiptPhotoLink(order.id, receipt.id, receipt.deliveryPhoto) : '').concat(receipt.acknowledgement ? "<p>Acknowledged by ".concat(esc(receipt.acknowledgement.name), "</p>").concat(receiptAllowed(order) ? "<button type=\"button\" data-view-receipt-signature=\"".concat(esc(receipt.id), "\" data-signature-order=\"").concat(esc(order.id), "\">View signed acknowledgement</button>") : '') : '<p>No signature recorded on this earlier receipt.</p>').concat((receipt.amendments || []).map(function (amendment) {
        return "<details><summary>Corrected by ".concat(esc(amendment.by), " \xB7 ").concat(esc(new Date(amendment.at).toLocaleString('en-AU')), "</summary><p>").concat(esc(amendment.reason), "</p>").concat(amendment.after.map(function (line) {
          var old = amendment.before.find(function (item) {
            return item.index === line.index;
          });
          return "<p>".concat(esc(line.description), ": accepted ").concat(esc(old.accepted), " \u2192 ").concat(esc(line.accepted), ", damaged ").concat(esc(old.damaged), " \u2192 ").concat(esc(line.damaged), ", missing ").concat(esc(old.missing), " \u2192 ").concat(esc(line.missing), "</p>");
        }).join(''), "</details>");
      }).join('')).concat((receipt.attachmentIds || []).map(function (id) {
        var file = (order.attachments || []).find(function (file) {
          return file.id === id;
        });
        return file ? "<button type=\"button\" data-order-file=\"".concat(esc(file.id), "\" data-file-order=\"").concat(esc(order.id), "\">").concat(esc(file.name), "</button>") : '';
      }).join(''), "<div data-signed-receipt=\"").concat(esc(receipt.id), "\"></div></article>");
    }).join('');
    return "<section class=\"card site-delivery\"><h3>Delivery receipts</h3><div class=\"site-receipt-totals\">".concat(receiptTotals(order).map(function (line) {
      return "<p><strong>".concat(esc(line.description), "</strong>: ").concat(esc(line.accepted), " / ").concat(esc(line.quantity), " accepted \xB7 ").concat(esc(line.outstanding), " outstanding</p>");
    }).join(''), "</div><div class=\"site-delivery-issues\"><h4>Delivery issues</h4>").concat((order.deliveryIssues || []).map(function (issue) {
      return "<p>".concat(esc(issue.description), " \xB7 ").concat(esc(issue.status.replace(/_/g, ' ')), " \xB7 ").concat(esc(issue.remaining), " replacements outstanding</p>");
    }).join('') || '<p>No delivery issues reported.</p>', "</div>").concat(history || '<p>No deliveries recorded yet.</p>', "</section>");
  }
  function canUseReceive() {
    var _session17;
    return can('site.orders.view') && (((_session17 = session) === null || _session17 === void 0 ? void 0 : _session17.isAdmin) || can('site.orders.manage') || can('site.orders.create'));
  }
  function orderListTabs(current) {
    if (!mobileHost && current === 'receive') return '';
    return "<nav class=\"site-order-scopes\" aria-label=\"Order lists\"><button type=\"button\" data-order-scope=\"all\" ".concat(current === 'all' ? 'aria-current="page"' : '', ">All Orders</button><button type=\"button\" data-order-scope=\"mine\" ").concat(current === 'mine' ? 'aria-current="page"' : '', ">My Orders</button>").concat(mobileHost && canUseReceive() ? "<button type=\"button\" data-order-scope=\"receive\" ".concat(current === 'receive' ? 'aria-current="page"' : '', ">Receive</button>") : '', "</nav>");
  }
  function receiveOrderList(shown) {
    if (mobileHost) return "<section class=\"delivery-order-list\">".concat(shown.map(function (order) {
      return "<article class=\"delivery-order-row\"><div><h3>#".concat(esc(order.orderNumber), " \xB7 ").concat(esc(order.project), "</h3><p>").concat(esc(order.orderType), " \xB7 ").concat(esc(receiptTotals(order).filter(function (line) {
        return line.outstanding > 0;
      }).length), " items outstanding</p></div><button type=\"button\" class=\"primary\" data-record-delivery=\"").concat(esc(order.id), "\">Record delivery</button></article>");
    }).join('') || '<p class="card">No dispatched orders awaiting confirmation match this list.</p>', "</section>");
    return "<div class=\"site-receive-list\"><table class=\"site-receive-table\" aria-label=\"Dispatched orders awaiting receipt\"><thead><tr><th scope=\"col\">Order / Project</th><th scope=\"col\">Items</th><th scope=\"col\">Action</th></tr></thead><tbody>".concat(shown.map(function (order) {
      return "<tr><td><strong>#".concat(esc(order.orderNumber), "</strong><span>").concat(esc(order.project), "</span></td><td>").concat(esc(receiptTotals(order).filter(function (line) {
        return line.outstanding > 0;
      }).length), "</td><td><button type=\"button\" class=\"primary\" data-record-delivery=\"").concat(esc(order.id), "\" aria-label=\"Receive order ").concat(esc(order.orderNumber), "\">Receive</button></td></tr>");
    }).join(''), "</tbody></table>").concat(shown.length ? '' : '<p class="site-receive-empty">No dispatched orders awaiting confirmation match this list.</p>', "</div>");
  }
  function deliveryWorkspace() {
    var order = orders.find(function (order) {
      return order.id === selectedOrderId;
    });
    if (selectedOrderId && order) return "<div class=\"toolbar".concat(mobileHost ? '' : ' site-delivery-heading', "\"><div><h2>Record delivery</h2><p>Order #").concat(esc(order.orderNumber), " \xB7 ").concat(esc(order.project), "</p></div><button type=\"button\" data-delivery-back>Back</button></div>").concat(message ? "<p class=\"notice\">".concat(esc(message), "</p>") : '').concat(orderListTabs('receive'), "<section class=\"card").concat(mobileHost ? '' : ' site-delivery-card', "\">").concat(canReceiveOrder(order) ? receiptForm(order) : '<p>Only dispatched orders with outstanding items can be received.</p>', "</section>");
    var eligible = orders.filter(canReceiveOrder),
      query = deliveryQuery.trim().toLowerCase(),
      shown = eligible.filter(function (order) {
        return [order.orderNumber, order.project].concat(_toConsumableArray(order.items.map(function (item) {
          return item.description;
        }))).join(' ').toLowerCase().includes(query);
      });
    return "<div class=\"toolbar\"><div><h2>Receive</h2><p>Dispatched orders awaiting delivery confirmation</p></div>".concat(mobileHost ? '<button type="button" data-delivery-back>Back to orders</button>' : '', "</div>").concat(message ? "<p class=\"notice\">".concat(esc(message), "</p>") : '').concat(orderListTabs('receive'), "<label>Find an order<input type=\"search\" data-delivery-search value=\"").concat(esc(deliveryQuery), "\" placeholder=\"Order number, project or item\"></label>").concat(receiveOrderList(shown));
  }
  function saveReceipt(_x19) {
    return _saveReceipt.apply(this, arguments);
  }
  function _saveReceipt() {
    _saveReceipt = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee37(event) {
      var version, owner, draft, form, invalid, details, _form$querySelector6, canvas, _iterator9, _step9, control, _session48, _session49, body, file, response, _result14, _session50, _session51, _t39, _t40, _t41, _t42;
      return _regenerator().w(function (_context38) {
        while (1) switch (_context38.p = _context38.n) {
          case 0:
            event.preventDefault();
            if (!(receiptSaving || receiptPhotoBusy)) {
              _context38.n = 1;
              break;
            }
            return _context38.a(2);
          case 1:
            captureReceipt();
            version = sessionVersion, owner = session.username, draft = receiptDraft, form = event.currentTarget;
            form.classList.add('delivery-validation-attempted');
            draft.error = '';
            invalid = form.querySelector('input:invalid,textarea:invalid');
            if (!invalid) {
              _context38.n = 2;
              break;
            }
            invalid.setAttribute('aria-invalid', 'true');
            details = invalid.closest('details');
            if (details) details.open = true;
            invalid.scrollIntoView({
              block: 'center'
            });
            invalid.focus();
            return _context38.a(2);
          case 2:
            if (!draft.lines.some(function (line) {
              return line.arrived && Number(line.accepted) + Number(line.damaged || 0) <= 0;
            })) {
              _context38.n = 3;
              break;
            }
            draft.error = 'Enter a quantity for each item confirmed as arrived.';
            form.querySelector('[data-receipt-error]').textContent = draft.error;
            return _context38.a(2);
          case 3:
            if (receiptBodyLines(draft).length) {
              _context38.n = 4;
              break;
            }
            draft.error = 'Confirm an item arrived or enter a missing quantity.';
            form.querySelector('[data-receipt-error]').textContent = draft.error;
            (_form$querySelector6 = form.querySelector('[name=arrived]')) === null || _form$querySelector6 === void 0 || _form$querySelector6.focus();
            return _context38.a(2);
          case 4:
            if (draft.acknowledgement.image) {
              _context38.n = 5;
              break;
            }
            draft.error = 'Draw the recipient signature before saving.';
            form.querySelector('[data-receipt-error]').textContent = draft.error;
            canvas = form.querySelector('[data-receipt-signature]');
            canvas.setAttribute('aria-invalid', 'true');
            canvas.scrollIntoView({
              block: 'center'
            });
            canvas.focus();
            return _context38.a(2);
          case 5:
            receiptSaving = true;
            _iterator9 = _createForOfIteratorHelper(form.querySelectorAll('input,select,textarea,button'));
            try {
              for (_iterator9.s(); !(_step9 = _iterator9.n()).done;) {
                control = _step9.value;
                control.disabled = true;
              }
            } catch (err) {
              _iterator9.e(err);
            } finally {
              _iterator9.f();
            }
            _context38.p = 6;
            body = _objectSpread(_objectSpread({}, draft), {}, {
              lines: receiptBodyLines(draft)
            });
            if (!draft.deliveryPhoto) {
              _context38.n = 10;
              break;
            }
            _context38.n = 7;
            return attachmentDb('get', draft.deliveryPhoto.storageId || draft.deliveryPhoto.id);
          case 7:
            file = _context38.v;
            if (file) {
              _context38.n = 8;
              break;
            }
            throw Error('The delivery photo is unavailable on this device. Attach it again or remove it.');
          case 8:
            _t39 = draft.deliveryPhoto.id;
            _t40 = draft.deliveryPhoto.name;
            _context38.n = 9;
            return attachmentData(file);
          case 9:
            _t41 = _context38.v;
            body.deliveryPhoto = {
              id: _t39,
              name: _t40,
              data: _t41
            };
          case 10:
            if (!(version !== sessionVersion || ((_session48 = session) === null || _session48 === void 0 ? void 0 : _session48.username) !== owner)) {
              _context38.n = 11;
              break;
            }
            return _context38.a(2);
          case 11:
            _context38.n = 12;
            return api('/orders/' + draft.orderId + '/receipts', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(body)
            });
          case 12:
            response = _context38.v;
            _context38.n = 13;
            return response.json();
          case 13:
            _result14 = _context38.v;
            if (!(version !== sessionVersion || ((_session49 = session) === null || _session49 === void 0 ? void 0 : _session49.username) !== owner)) {
              _context38.n = 14;
              break;
            }
            return _context38.a(2);
          case 14:
            if (!(response.status === 409 && _result14.code === 'ORDER_CONFLICT')) {
              _context38.n = 15;
              break;
            }
            receiptConflict = _result14.order;
            return _context38.a(2);
          case 15:
            if (response.ok) {
              _context38.n = 16;
              break;
            }
            throw Error(_result14.error || 'Delivery could not be recorded.');
          case 16:
            orders = orders.map(function (order) {
              return order.id === _result14.order.id ? _result14.order : order;
            });
            try {
              deviceStorage.removeItem(receiptKey(draft.orderId));
            } catch (_unused14) {}
            if (draft.deliveryPhoto) void attachmentDb('delete', [{
              id: draft.deliveryPhoto.storageId || draft.deliveryPhoto.id
            }]).catch(function () {});
            form.remove();
            receiptDraft = null;
            receiptConflict = null;
            selectedOrderId = '';
            message = 'Delivery recorded. Order managers have been notified.';
            _context38.n = 18;
            break;
          case 17:
            _context38.p = 17;
            _t42 = _context38.v;
            if (version === sessionVersion && ((_session50 = session) === null || _session50 === void 0 ? void 0 : _session50.username) === owner) draft.error = _t42.message;
          case 18:
            _context38.p = 18;
            if (version === sessionVersion && ((_session51 = session) === null || _session51 === void 0 ? void 0 : _session51.username) === owner) {
              receiptSaving = false;
              render();
            }
            return _context38.f(18);
          case 19:
            return _context38.a(2);
        }
      }, _callee37, null, [[6, 17, 18, 19]]);
    }));
    return _saveReceipt.apply(this, arguments);
  }
  function wireReceipts() {
    var _root$querySelector0, _root$querySelector1, _root$querySelector10;
    (_root$querySelector0 = root.querySelector('[data-receive]')) === null || _root$querySelector0 === void 0 || _root$querySelector0.addEventListener('click', function () {
      captureReceipt();
      captureDraft();
      selectedOrderId = '';
      view = 'deliveries';
      message = '';
      render();
    });
    root.querySelectorAll('[data-order-scope]').forEach(function (button) {
      return button.onclick = function () {
        captureReceipt();
        var scope = button.dataset.orderScope;
        selectedOrderId = '';
        if (scope === 'receive') view = 'deliveries';else {
          orderScope = scope;
          view = 'orders';
        }
        message = '';
        render();
      };
    });
    root.querySelectorAll('[data-record-delivery]').forEach(function (button) {
      return button.onclick = function () {
        captureReceipt();
        selectedOrderId = button.dataset.recordDelivery;
        view = 'deliveries';
        message = '';
        render();
      };
    });
    (_root$querySelector1 = root.querySelector('[data-delivery-back]')) === null || _root$querySelector1 === void 0 || _root$querySelector1.addEventListener('click', function () {
      captureReceipt();
      if (selectedOrderId) selectedOrderId = '';else view = 'orders';
      message = '';
      render();
    });
    (_root$querySelector10 = root.querySelector('[data-delivery-search]')) === null || _root$querySelector10 === void 0 || _root$querySelector10.addEventListener('input', function (event) {
      deliveryQuery = event.target.value;
      var caret = event.target.selectionStart;
      render();
      var input = root.querySelector('[data-delivery-search]');
      input === null || input === void 0 || input.focus();
      try {
        input === null || input === void 0 || input.setSelectionRange(caret, caret);
      } catch (_unused7) {}
    });
    var form = root.querySelector('[data-receipt-form]');
    if (form) {
      var _form$querySelector3, _root$querySelector11, _root$querySelector12;
      var draft = receiptDraft,
        owner = session.username,
        version = sessionVersion;
      form.onsubmit = saveReceipt;
      mountReceiptPhotoPreview(form);
      form.querySelectorAll('[data-receipt-photo]').forEach(function (input) {
        return input.onchange = chooseReceiptPhoto;
      });
      (_form$querySelector3 = form.querySelector('[data-remove-receipt-photo]')) === null || _form$querySelector3 === void 0 || _form$querySelector3.addEventListener('click', removeReceiptPhoto);
      receiptPad = mountDeliveryPad(form.querySelector('[data-receipt-signature]'), {
        value: draft.acknowledgement.image,
        disabled: function disabled() {
          var _session18;
          return receiptSaving || receiptPhotoBusy || version !== sessionVersion || ((_session18 = session) === null || _session18 === void 0 ? void 0 : _session18.username) !== owner;
        },
        onChange: function onChange(image) {
          var _session19;
          if (version !== sessionVersion || ((_session19 = session) === null || _session19 === void 0 ? void 0 : _session19.username) !== owner || receiptDraft !== draft) return;
          draft.acknowledgement.image = image;
          draft.error = '';
          form.querySelector('[data-receipt-error]').textContent = '';
          form.querySelector('[data-signature-hint]').textContent = image ? 'Signature recorded.' : 'Complete the delivery details before signing.';
          form.querySelector('[data-receipt-signature]').removeAttribute('aria-invalid');
          persistReceipt();
        }
      });
      form.addEventListener('input', function (event) {
        var _event$target$validit;
        if ((_event$target$validit = event.target.validity) !== null && _event$target$validit !== void 0 && _event$target$validit.valid) event.target.removeAttribute('aria-invalid');
        var row = event.target.closest('[data-receipt-line]');
        if (row && event.target.name === 'accepted') row.dataset.manual = 'true';
        if (row && ['damaged', 'missing'].includes(event.target.name) && row.dataset.manual !== 'true' && row.querySelector('[name=arrived]').checked) row.querySelector('[name=accepted]').value = Math.max(0, Number(row.dataset.outstanding) - Number(row.querySelector('[name=damaged]').value) - Number(row.querySelector('[name=missing]').value));
        captureReceipt();
      });
      form.addEventListener('change', function (event) {
        var row = event.target.closest('[data-receipt-line]');
        if (row && event.target.name === 'arrived') {
          var checked = event.target.checked;
          row.querySelector('[name=accepted]').disabled = !checked;
          if (!checked && receiptDraft.mode === 'site-checklist') row.querySelector('[name=accepted]').value = row.dataset.outstanding;
          if (row.querySelector('[name=damaged]')) row.querySelector('[name=damaged]').disabled = !checked;
        }
        captureReceipt();
      });
      (_root$querySelector11 = root.querySelector('[data-clear-receipt-signature]')) === null || _root$querySelector11 === void 0 || _root$querySelector11.addEventListener('click', function () {
        return receiptPad.clear();
      });
      (_root$querySelector12 = root.querySelector('[data-review-receipt]')) === null || _root$querySelector12 === void 0 || _root$querySelector12.addEventListener('click', function () {
        captureReceipt();
        orders = orders.map(function (order) {
          return order.id === receiptConflict.id ? receiptConflict : order;
        });
        receiptDraft.expectedUpdatedAt = receiptConflict.updatedAt || receiptConflict.createdAt || '';
        receiptDraft.lines = receiptTotals(receiptConflict).filter(function (line) {
          return line.outstanding > 0;
        }).map(function (line) {
          return _objectSpread(_objectSpread({}, receiptDraft.lines.find(function (row) {
            return row.index === line.index;
          }) || {
            arrived: false,
            accepted: line.outstanding,
            damaged: 0,
            missing: 0,
            replacementIssueId: ''
          }), {}, {
            index: line.index,
            outstanding: line.outstanding
          });
        });
        receiptDraft.acknowledgement.image = '';
        receiptConflict = null;
        form.remove();
        render();
      });
    }
    wireReceiptPhotos();
    root.querySelectorAll('[data-view-receipt-signature]').forEach(function (button) {
      return button.onclick = /*#__PURE__*/_asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee2() {
        var owner, version, _session20, response, result, ack, target, _t2;
        return _regenerator().w(function (_context2) {
          while (1) switch (_context2.p = _context2.n) {
            case 0:
              owner = session.username, version = sessionVersion;
              button.disabled = true;
              _context2.p = 1;
              _context2.n = 2;
              return api('/orders/' + encodeURIComponent(button.dataset.signatureOrder) + '/receipts/' + encodeURIComponent(button.dataset.viewReceiptSignature) + '/signature');
            case 2:
              response = _context2.v;
              _context2.n = 3;
              return response.json();
            case 3:
              result = _context2.v;
              if (!(version !== sessionVersion || ((_session20 = session) === null || _session20 === void 0 ? void 0 : _session20.username) !== owner || !button.isConnected)) {
                _context2.n = 4;
                break;
              }
              return _context2.a(2);
            case 4:
              if (response.ok) {
                _context2.n = 5;
                break;
              }
              throw Error(result.error || 'Signed delivery could not be loaded');
            case 5:
              ack = result.acknowledgement, target = button.parentElement.querySelector('[data-signed-receipt]');
              target.innerHTML = "<section class=\"delivery-signed\"><h4>Signed delivery acknowledgement</h4><p>Order #".concat(esc(ack.orderNumber), " \xB7 ").concat(esc(ack.project), "</p><p>").concat(esc(ack.name), " \xB7 ").concat(esc(new Date(ack.at).toLocaleString('en-AU')), "</p><p>This signature acknowledges the original delivery record. Later corrections are listed separately.</p>").concat(ack.lines.map(function (line) {
                return "<p>".concat(esc(line.description), ": ").concat(esc(line.accepted), " accepted \xB7 ").concat(esc(line.damaged), " damaged \xB7 ").concat(esc(line.missing), " missing</p>");
              }).join(''), "<p>").concat(esc(ack.notes), "</p><img src=\"").concat(esc(ack.image), "\" alt=\"Signature of ").concat(esc(ack.name), "\">").concat(!mobileHost ? receiptPhotoLink(ack.orderId, ack.receiptId, ack.deliveryPhoto) : '', "</section>");
              wireReceiptPhotos();
              _context2.n = 7;
              break;
            case 6:
              _context2.p = 6;
              _t2 = _context2.v;
              if (version === sessionVersion && button.isConnected) button.parentElement.querySelector('[data-signed-receipt]').textContent = _t2.message;
            case 7:
              _context2.p = 7;
              if (button.isConnected) button.disabled = false;
              return _context2.f(7);
            case 8:
              return _context2.a(2);
          }
        }, _callee2, null, [[1, 6, 7, 8]]);
      }));
    });
  }
  var orderTypeEditor = null,
    orderTypeSaving = false;
  var canCorrectOrderType = function canCorrectOrderType(order) {
    var _session21;
    return ((_session21 = session) === null || _session21 === void 0 ? void 0 : _session21.isAdmin) && !order.local && isPanelOrder(order) && !['completed', 'dispatched', 'cancelled'].includes(order.status);
  };
  function captureOrderTypeCorrection() {
    var _session22, _form$querySelector4;
    var form = root.querySelector('[data-order-type-correction]');
    if (!form || !orderTypeEditor || orderTypeEditor.owner !== ((_session22 = session) === null || _session22 === void 0 ? void 0 : _session22.username)) return;
    orderTypeEditor.type = form.querySelector('[name=correctOrderType]').value;
    orderTypeEditor.other = ((_form$querySelector4 = form.querySelector('[name=correctOrderTypeOther]')) === null || _form$querySelector4 === void 0 ? void 0 : _form$querySelector4.value) || '';
  }
  function orderTypeCorrectionView(order) {
    var _orderTypeEditor;
    if (!canCorrectOrderType(order)) return '';
    if (((_orderTypeEditor = orderTypeEditor) === null || _orderTypeEditor === void 0 ? void 0 : _orderTypeEditor.id) !== order.id) return "<section class=\"card\"><button type=\"button\" data-correct-order-type=\"".concat(esc(order.id), "\">Change order type</button></section>");
    var draft = orderTypeEditor;
    return "<section class=\"card\"><h3>Change order type</h3><p>Correct an order created as Panels. Order details are kept. Orders with linked drawings or factory production must be reviewed before changing type.</p><form data-order-type-correction><label>Correct order type <span class=\"site-required\" aria-hidden=\"true\">*</span><select name=\"correctOrderType\" required ".concat(orderTypeSaving ? 'disabled' : '', "><option value=\"\">Select the correct order type</option>").concat(orderTypes.filter(function (type) {
      return type.toLowerCase() !== 'panels';
    }).map(function (type) {
      return "<option value=\"".concat(esc(type), "\" ").concat(draft.type === type ? 'selected' : '', ">").concat(esc(type), "</option>");
    }).join(''), "</select></label>").concat(draft.type === 'Other' ? "<label>Please specify (optional)<input name=\"correctOrderTypeOther\" maxlength=\"80\" value=\"".concat(esc(draft.other), "\" ").concat(orderTypeSaving ? 'disabled' : '', "></label>") : '').concat(draft.error ? "<p class=\"notice\" role=\"alert\">".concat(esc(draft.error), "</p>") : '').concat(draft.conflict ? "<p>Latest order type: ".concat(esc(draft.conflict.orderType), " \xB7 ").concat(esc(orderStatusLabel(draft.conflict.status)), "</p><button type=\"button\" data-order-type-latest>Reload latest order</button>") : '', "<div class=\"actions\"><button type=\"button\" data-order-type-cancel ").concat(orderTypeSaving ? 'disabled' : '', ">Cancel</button><button class=\"primary\" type=\"submit\" ").concat(orderTypeSaving || draft.conflict ? 'disabled' : '', ">").concat(orderTypeSaving ? 'Saving…' : 'Save order type', "</button></div></form></section>");
  }
  function saveOrderTypeCorrection(_x20) {
    return _saveOrderTypeCorrection.apply(this, arguments);
  }
  function _saveOrderTypeCorrection() {
    _saveOrderTypeCorrection = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee38(event) {
      var draft, version, owner, _session52, response, _result15, _session53, _session54, _t43;
      return _regenerator().w(function (_context39) {
        while (1) switch (_context39.p = _context39.n) {
          case 0:
            event.preventDefault();
            if (!(orderTypeSaving || !orderTypeEditor || orderTypeEditor.conflict)) {
              _context39.n = 1;
              break;
            }
            return _context39.a(2);
          case 1:
            captureOrderTypeCorrection();
            draft = orderTypeEditor, version = sessionVersion, owner = session.username;
            orderTypeSaving = true;
            draft.error = '';
            render();
            _context39.p = 2;
            _context39.n = 3;
            return api('/orders/' + encodeURIComponent(draft.id) + '/type', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                orderType: draft.type,
                orderTypeOther: draft.other,
                expectedUpdatedAt: draft.expectedUpdatedAt
              })
            });
          case 3:
            response = _context39.v;
            _context39.n = 4;
            return response.json();
          case 4:
            _result15 = _context39.v;
            if (!(version !== sessionVersion || ((_session52 = session) === null || _session52 === void 0 ? void 0 : _session52.username) !== owner || orderTypeEditor !== draft)) {
              _context39.n = 5;
              break;
            }
            return _context39.a(2);
          case 5:
            if (!(response.status === 409 && _result15.code === 'ORDER_CONFLICT')) {
              _context39.n = 6;
              break;
            }
            draft.conflict = _result15.order;
            draft.error = 'The order changed. Reload the latest order before trying again.';
            return _context39.a(2);
          case 6:
            if (response.ok) {
              _context39.n = 7;
              break;
            }
            throw Error(_result15.error || 'Order type could not be corrected.');
          case 7:
            orders = orders.map(function (order) {
              return order.id === draft.id ? _objectSpread(_objectSpread({}, order), _result15.order) : order;
            });
            orderTypeEditor = null;
            message = 'Order type corrected to ' + _result15.order.orderType + '.';
            productionState = {};
            if (view === 'order' && selectedOrderId === draft.id) {
              void loadOrderHistory(draft.id);
              void loadProductionProgress(draft.id);
            }
            _context39.n = 9;
            break;
          case 8:
            _context39.p = 8;
            _t43 = _context39.v;
            if (version === sessionVersion && ((_session53 = session) === null || _session53 === void 0 ? void 0 : _session53.username) === owner && orderTypeEditor === draft) draft.error = _t43.message;
          case 9:
            _context39.p = 9;
            if (version === sessionVersion && ((_session54 = session) === null || _session54 === void 0 ? void 0 : _session54.username) === owner) {
              orderTypeSaving = false;
              render();
            }
            return _context39.f(9);
          case 10:
            return _context39.a(2);
        }
      }, _callee38, null, [[2, 8, 9, 10]]);
    }));
    return _saveOrderTypeCorrection.apply(this, arguments);
  }
  function wireOrderTypeCorrection() {
    var _root$querySelector14, _root$querySelector15;
    root.querySelectorAll('[data-correct-order-type]').forEach(function (button) {
      return button.onclick = function () {
        var _root$querySelector13;
        if (orderTypeSaving) return;
        var order = orders.find(function (order) {
          return order.id === button.dataset.correctOrderType;
        });
        if (!order || !canCorrectOrderType(order)) return;
        orderTypeEditor = {
          id: order.id,
          owner: session.username,
          expectedUpdatedAt: order.updatedAt || order.createdAt || '',
          type: '',
          other: '',
          error: '',
          conflict: null
        };
        render();
        (_root$querySelector13 = root.querySelector('[name=correctOrderType]')) === null || _root$querySelector13 === void 0 || _root$querySelector13.focus();
      };
    });
    var form = root.querySelector('[data-order-type-correction]');
    if (!form) return;
    form.onsubmit = saveOrderTypeCorrection;
    form.addEventListener('input', captureOrderTypeCorrection);
    form.addEventListener('change', function (event) {
      captureOrderTypeCorrection();
      if (event.target.name === 'correctOrderType') render();
    });
    (_root$querySelector14 = root.querySelector('[data-order-type-cancel]')) === null || _root$querySelector14 === void 0 || _root$querySelector14.addEventListener('click', function () {
      orderTypeEditor = null;
      render();
    });
    (_root$querySelector15 = root.querySelector('[data-order-type-latest]')) === null || _root$querySelector15 === void 0 || _root$querySelector15.addEventListener('click', function () {
      var latest = orderTypeEditor.conflict;
      orders = orders.map(function (order) {
        return order.id === latest.id ? _objectSpread(_objectSpread({}, order), latest) : order;
      });
      orderTypeEditor = null;
      message = 'Latest order loaded. Review its details before correcting the type.';
      render();
    });
  }
  var deliveryEditor = null,
    deliverySaving = false;
  function captureOrderDelivery() {
    var _session23;
    var form = root.querySelector('[data-order-delivery]');
    if (!form || !deliveryEditor || deliveryEditor.owner !== ((_session23 = session) === null || _session23 === void 0 ? void 0 : _session23.username)) return;
    deliveryEditor.date = form.querySelector('[name=scheduledDeliveryDate]').value;
    deliveryEditor.time = deliveryEditor.date ? form.querySelector('[name=scheduledDeliveryTime]').value : '';
  }
  function orderDeliveryView(order) {
    var _session24, _deliveryEditor;
    if (!((_session24 = session) !== null && _session24 !== void 0 && _session24.isAdmin) || order.local || ['dispatched', 'cancelled'].includes(order.status)) return '';
    if (((_deliveryEditor = deliveryEditor) === null || _deliveryEditor === void 0 ? void 0 : _deliveryEditor.id) !== order.id) deliveryEditor = {
      id: order.id,
      owner: session.username,
      expectedUpdatedAt: order.updatedAt || order.createdAt || '',
      date: order.scheduledDeliveryDate || '',
      time: order.scheduledDeliveryTime || '',
      error: '',
      conflict: null
    };
    var draft = deliveryEditor,
      conflict = draft.conflict;
    return "<section class=\"card site-order-history\"><h3>Scheduled delivery</h3><p>Confirm the factory delivery date. The requested delivery date stays unchanged.</p><form data-order-delivery><div class=\"grid\"><label>Scheduled delivery date<input type=\"hidden\" name=\"scheduledDeliveryDate\" value=\"".concat(esc(draft.date), "\"><button type=\"button\" class=\"date-trigger\" data-delivery-picker ").concat(deliverySaving ? 'disabled' : '', "><span>").concat(esc(draft.date ? formatDate(draft.date) : 'Choose a date'), "</span><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><rect x=\"3\" y=\"5\" width=\"18\" height=\"16\" rx=\"2\"></rect><path d=\"M16 3v4M8 3v4M3 10h18\"></path></svg></button></label><label>Scheduled delivery time (optional)<input type=\"time\" name=\"scheduledDeliveryTime\" value=\"").concat(esc(draft.time), "\" ").concat(deliverySaving || !draft.date ? 'disabled' : '', "></label></div>").concat(draft.error ? "<p class=\"notice\" role=\"alert\">".concat(esc(draft.error), "</p>") : '').concat(conflict ? "<div class=\"notice\"><p>The order changed. Latest schedule: ".concat(esc(conflict.scheduledDeliveryDate ? formatDate(conflict.scheduledDeliveryDate) + (conflict.scheduledDeliveryTime ? ' · ' + conflict.scheduledDeliveryTime : '') : 'Not scheduled'), ". Review before saving.</p><div class=\"actions\"><button type=\"button\" data-delivery-latest>Use latest schedule</button><button type=\"button\" data-delivery-keep>Keep my date</button></div></div>") : '', "<div class=\"actions\"><button type=\"submit\" class=\"primary\" ").concat(deliverySaving || conflict ? 'disabled' : '', ">").concat(deliverySaving ? 'Saving…' : 'Save schedule', "</button>").concat(order.scheduledDeliveryDate ? "<button type=\"button\" data-delivery-clear ".concat(deliverySaving || conflict ? 'disabled' : '', ">Clear schedule</button>") : '', "</div></form></section>");
  }
  function saveOrderDelivery(_x21) {
    return _saveOrderDelivery.apply(this, arguments);
  }
  function _saveOrderDelivery() {
    _saveOrderDelivery = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee39(event) {
      var _session55;
      var clear,
        form,
        draft,
        version,
        _session56,
        response,
        _result16,
        _root$querySelector68,
        _args40 = arguments,
        _t44;
      return _regenerator().w(function (_context40) {
        while (1) switch (_context40.p = _context40.n) {
          case 0:
            clear = _args40.length > 1 && _args40[1] !== undefined ? _args40[1] : false;
            event === null || event === void 0 || event.preventDefault();
            if (!(deliverySaving || !((_session55 = session) !== null && _session55 !== void 0 && _session55.isAdmin) || !deliveryEditor || deliveryEditor.conflict)) {
              _context40.n = 1;
              break;
            }
            return _context40.a(2);
          case 1:
            if (clear) {
              form = root.querySelector('[data-order-delivery]');
              form.querySelector('[name=scheduledDeliveryDate]').value = '';
              form.querySelector('[name=scheduledDeliveryTime]').value = '';
            }
            captureOrderDelivery();
            draft = deliveryEditor, version = sessionVersion;
            deliverySaving = true;
            draft.error = '';
            message = '';
            render();
            _context40.p = 2;
            _context40.n = 3;
            return api('/orders/' + encodeURIComponent(draft.id) + '/delivery', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                expectedUpdatedAt: draft.expectedUpdatedAt,
                scheduledDeliveryDate: draft.date,
                scheduledDeliveryTime: draft.time
              })
            });
          case 3:
            response = _context40.v;
            _context40.n = 4;
            return response.json();
          case 4:
            _result16 = _context40.v;
            if (!(version !== sessionVersion || !((_session56 = session) !== null && _session56 !== void 0 && _session56.isAdmin))) {
              _context40.n = 5;
              break;
            }
            return _context40.a(2);
          case 5:
            if (!(response.status === 409 && _result16.code === 'ORDER_CONFLICT')) {
              _context40.n = 6;
              break;
            }
            orders = orders.map(function (order) {
              return order.id === draft.id ? _objectSpread(_objectSpread({}, order), _result16.order) : order;
            });
            draft.conflict = _result16.order;
            draft.error = 'The order changed. Review the latest schedule.';
            if (['dispatched', 'cancelled'].includes(_result16.order.status)) message = 'The order changed and can no longer be rescheduled.';
            return _context40.a(2);
          case 6:
            if (response.ok) {
              _context40.n = 7;
              break;
            }
            throw Error(_result16.error || 'Delivery schedule could not be saved.');
          case 7:
            orders = orders.map(function (order) {
              return order.id === draft.id ? _objectSpread(_objectSpread({}, order), _result16.order) : order;
            });
            // Remove the old form before rendering the saved values so capture cannot restore them.
            if (deliveryEditor === draft) {
              (_root$querySelector68 = root.querySelector('[data-order-delivery]')) === null || _root$querySelector68 === void 0 || _root$querySelector68.remove();
              deliveryEditor = _objectSpread(_objectSpread({}, draft), {}, {
                expectedUpdatedAt: _result16.order.updatedAt || _result16.order.createdAt || '',
                date: _result16.order.scheduledDeliveryDate || '',
                time: _result16.order.scheduledDeliveryTime || '',
                error: '',
                conflict: null
              });
            }
            message = _result16.unchanged ? 'Delivery schedule is unchanged.' : _result16.order.scheduledDeliveryDate ? 'Delivery scheduled.' : 'Delivery schedule cleared.';
            if (view === 'order' && selectedOrderId === draft.id) void loadOrderHistory(draft.id);
            _context40.n = 9;
            break;
          case 8:
            _context40.p = 8;
            _t44 = _context40.v;
            if (version === sessionVersion && deliveryEditor === draft) draft.error = _t44.message;
          case 9:
            _context40.p = 9;
            if (version === sessionVersion) {
              deliverySaving = false;
              render();
            }
            return _context40.f(9);
          case 10:
            return _context40.a(2);
        }
      }, _callee39, null, [[2, 8, 9, 10]]);
    }));
    return _saveOrderDelivery.apply(this, arguments);
  }
  function wireOrderDelivery() {
    var _root$querySelector16, _root$querySelector17, _root$querySelector18, _root$querySelector19;
    var form = root.querySelector('[data-order-delivery]');
    if (!form) return;
    (_root$querySelector16 = root.querySelector('[data-delivery-picker]')) === null || _root$querySelector16 === void 0 || _root$querySelector16.addEventListener('click', function (event) {
      return openDatePicker(form.querySelector('[name=scheduledDeliveryDate]'), event.currentTarget, function () {
        captureOrderDelivery();
        render();
      });
    });
    form.onsubmit = saveOrderDelivery;
    form.addEventListener('input', captureOrderDelivery);
    form.addEventListener('change', function () {
      captureOrderDelivery();
      render();
    });
    (_root$querySelector17 = root.querySelector('[data-delivery-clear]')) === null || _root$querySelector17 === void 0 || _root$querySelector17.addEventListener('click', function (event) {
      return saveOrderDelivery(event, true);
    });
    (_root$querySelector18 = root.querySelector('[data-delivery-latest]')) === null || _root$querySelector18 === void 0 || _root$querySelector18.addEventListener('click', function () {
      var latest = deliveryEditor.conflict;
      form.remove();
      deliveryEditor = _objectSpread(_objectSpread({}, deliveryEditor), {}, {
        expectedUpdatedAt: latest.updatedAt || latest.createdAt || '',
        date: latest.scheduledDeliveryDate || '',
        time: latest.scheduledDeliveryTime || '',
        error: '',
        conflict: null
      });
      render();
    });
    (_root$querySelector19 = root.querySelector('[data-delivery-keep]')) === null || _root$querySelector19 === void 0 || _root$querySelector19.addEventListener('click', function () {
      captureOrderDelivery();
      deliveryEditor.expectedUpdatedAt = deliveryEditor.conflict.updatedAt || deliveryEditor.conflict.createdAt || '';
      deliveryEditor.conflict = null;
      deliveryEditor.error = '';
      render();
    });
  }
  function orderDetails() {
    var _order$items2;
    var backLabel = orderReturnView === 'notifications' ? 'Back to notifications' : orderReturnView === 'order-attention' ? 'Back to needs attention' : orderReturnView === 'order-search' ? 'Back to search results' : orderScope === 'mine' ? 'Back to My Orders' : 'Back to All Orders';
    if (orderReturnView === 'notifications' && notificationOrderState.id === selectedOrderId && (notificationOrderState.loading || notificationOrderState.error)) return "<div class=\"toolbar\"><h2>".concat(notificationOrderState.loading ? 'Opening order…' : 'Order unavailable', "</h2><button data-order-results>").concat(backLabel, "</button></div>").concat(notificationOrderState.loading ? '<p role="status">Loading the latest order information…</p>' : "<div class=\"notice\" role=\"alert\">".concat(esc(notificationOrderState.error), " <button data-retry-notification-order>Retry</button></div>"));
    var order = [].concat(_toConsumableArray(pendingOrders()), _toConsumableArray(orders)).find(function (order) {
      return order.id === selectedOrderId;
    });
    if (!order) return "<div class=\"toolbar\"><h2>Order unavailable</h2><button data-order-results>".concat(backLabel, "</button></div><p>Refresh the order list and try again.</p>");
    var field = function field(label, value) {
      return "<div class=\"site-order-field\"><small>".concat(esc(label), "</small><div>").concat(esc(value || 'Not provided'), "</div></div>");
    };
    var delivery = function delivery(date, time) {
      return date ? formatDate(date) + (time ? ' · ' + time : '') : 'Not confirmed';
    };
    return "<div class=\"toolbar site-order-detail-heading\"><div><small class=\"site-order-eyebrow\">Order request</small><h2 style=\"margin:0\">Order #".concat(esc(order.orderNumber), "</h2><p class=\"site-order-project\">").concat(esc(order.project), " <span class=\"site-order-status\">").concat(esc(orderStatusLabel(order.status)), "</span></p></div><button data-order-results>").concat(backLabel, "</button></div>").concat(message ? "<div class=\"notice\">".concat(esc(message), "</div>") : '', "<div class=\"site-order-detail-grid\"><section class=\"card site-order-information\"><h3>Order information</h3><div class=\"grid site-order-fields\">").concat(field('Order type', order.orderType === 'Other' && order.orderTypeOther ? 'Other: ' + order.orderTypeOther : order.orderType)).concat(field('Requested by', order.requestedBy || session.username)).concat(field('Site contact', order.siteContact)).concat(field('Phone', order.phone)).concat(field('Requested delivery', delivery(order.requestedDeliveryDate, order.requestedDeliveryTime))).concat(field('Confirmed delivery', delivery(order.scheduledDeliveryDate, order.scheduledDeliveryTime)), "<div class=\"wide\">").concat(field('Location / notes', order.locationNotes), "</div></div><div class=\"site-order-delivery-note\">").concat(deliverySummary(order), "</div></section><section class=\"card site-order-items\"><h3>Items <span class=\"site-section-count\">").concat(((_order$items2 = order.items) === null || _order$items2 === void 0 ? void 0 : _order$items2.length) || 0, "</span></h3><div class=\"site-order-item-list\">").concat((order.items || []).map(function (item) {
      return "<div class=\"site-order-item\"><strong>".concat(esc(item.quantity), " \xD7</strong><span>").concat(esc(item.description), "</span></div>");
    }).join(''), "</div>").concat(order.local ? "<p>".concat(order.savedOrderId ? 'The order is saved to your account. Waiting files remain on this device until uploaded.' : 'This request is saved on this device and has not reached the office yet.', "</p>") : orderAttachmentControls(order)).concat(!order.local ? "<div class=\"actions site-order-file-actions\"><button data-export=\"pdf\" data-order-id=\"".concat(esc(order.id), "\">PDF</button><button data-export=\"xlsx\" data-order-id=\"").concat(esc(order.id), "\">Excel</button>").concat(can('site.orders.create') ? "<button type=\"button\" data-copy-order=\"".concat(esc(order.id), "\" ").concat(busy ? 'disabled' : '', ">").concat(busy ? "Please wait\u2026" : 'Copy to new draft', "</button>") : '', "</div>") : '', "<div data-submission-order>").concat(submissionOrderContent(), "</div></section>").concat(orderTypeCorrectionView(order)).concat(orderDeliveryView(order)).concat(orderProductionView(order)).concat(gateProductionEditorView(order)).concat(panelDrawingEditorView(order)).concat(deliveryReceipts(order)).concat(orderDiscussion(order)).concat(orderTimeline(order), "</div>");
  }
  function attachmentDb(action, files) {
    if (action !== 'get' && !files.length) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var request = indexedDB.open('panelstock-site-order-files', 1);
      request.onupgradeneeded = function () {
        return request.result.createObjectStore('files');
      };
      request.onerror = function () {
        return reject(Error('Device storage is unavailable. Your files have not been submitted.'));
      };
      request.onsuccess = function () {
        var db = request.result,
          tx = db.transaction('files', action === 'get' ? 'readonly' : 'readwrite'),
          store = tx.objectStore('files');
        var value;
        if (action === 'get') {
          var _read = store.get(files);
          _read.onsuccess = function () {
            value = _read.result;
          };
        } else {
          var _iterator4 = _createForOfIteratorHelper(files),
            _step4;
          try {
            for (_iterator4.s(); !(_step4 = _iterator4.n()).done;) {
              var item = _step4.value;
              if (action === 'put') store.put(item.file, item.id);else store.delete(item.id);
            }
          } catch (err) {
            _iterator4.e(err);
          } finally {
            _iterator4.f();
          }
        }
        tx.oncomplete = function () {
          db.close();
          resolve(value);
        };
        tx.onerror = tx.onabort = function () {
          db.close();
          reject(Error('Could not save the files on this device.'));
        };
      };
    });
  }
  function validateOrderFiles(files) {
    var existing = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : [];
    var all = [].concat(_toConsumableArray(existing), _toConsumableArray(files));
    if (all.length > 10 || all.reduce(function (sum, file) {
      return sum + file.size;
    }, 0) > 25 * 1024 * 1024 || files.some(function (file) {
      return !file.size || file.size > 5 * 1024 * 1024;
    })) throw Error('Choose up to 10 files, 5 MB each and 25 MB in total.');
  }
  var attachmentData = function attachmentData(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        return resolve(String(reader.result).split(',')[1]);
      };
      reader.onerror = function () {
        return reject(Error('The file could not be read.'));
      };
      reader.readAsDataURL(file);
    });
  };
  function renderSelectedOrderFiles() {
    var list = root.querySelector('[data-selected-order-files]');
    if (list) list.innerHTML = selectedOrderFiles.map(function (file) {
      return "<div class=\"order-attachment-row\"><span>".concat(esc(file.name)).concat(file.missing ? ' — unavailable, please reattach' : '', "</span><button type=\"button\" data-remove-order-file=\"").concat(esc(file.id), "\">Remove</button></div>");
    }).join('');
  }
  function chooseOrderFiles(_x22) {
    return _chooseOrderFiles.apply(this, arguments);
  }
  function _chooseOrderFiles() {
    _chooseOrderFiles = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee40(event) {
      var owner, version, _session57, _selectedOrderFiles, added, errorNode, _session58, _errorNode, _t45;
      return _regenerator().w(function (_context41) {
        while (1) switch (_context41.p = _context41.n) {
          case 0:
            if (!busy) {
              _context41.n = 1;
              break;
            }
            return _context41.a(2);
          case 1:
            captureDraft();
            owner = session.username, version = sessionVersion;
            busy = true;
            _context41.p = 2;
            added = Array.from(event.target.files || []).map(function (file) {
              return {
                id: crypto.randomUUID(),
                name: file.name,
                size: file.size,
                file: file
              };
            });
            validateOrderFiles(added, selectedOrderFiles);
            _context41.n = 3;
            return attachmentDb('put', added);
          case 3:
            if (!(sessionVersion !== version || ((_session57 = session) === null || _session57 === void 0 ? void 0 : _session57.username) !== owner)) {
              _context41.n = 4;
              break;
            }
            return _context41.a(2);
          case 4:
            (_selectedOrderFiles = selectedOrderFiles).push.apply(_selectedOrderFiles, _toConsumableArray(added));
            if (orderDraft) {
              orderDraft.attachments = selectedOrderFiles.map(function (_ref37) {
                var file = _ref37.file,
                  missing = _ref37.missing,
                  metadata = _objectWithoutProperties(_ref37, _excluded2);
                return metadata;
              });
              writeDraft();
            }
            captureDraft();
            renderSelectedOrderFiles();
            errorNode = root.querySelector('[data-file-error]');
            if (errorNode) errorNode.textContent = '';
            _context41.n = 6;
            break;
          case 5:
            _context41.p = 5;
            _t45 = _context41.v;
            _errorNode = root.querySelector('[data-file-error]');
            if (((_session58 = session) === null || _session58 === void 0 ? void 0 : _session58.username) === owner && _errorNode) _errorNode.textContent = _t45.message;
          case 6:
            _context41.p = 6;
            busy = false;
            event.target.value = '';
            return _context41.f(6);
          case 7:
            return _context41.a(2);
        }
      }, _callee40, null, [[2, 5, 6, 7]]);
    }));
    return _chooseOrderFiles.apply(this, arguments);
  }
  function orderAttachmentControls(order) {
    var _session$taskAccess;
    if (order.local) return '';
    var allowed = session.isAdmin || ((_session$taskAccess = session.taskAccess) === null || _session$taskAccess === void 0 ? void 0 : _session$taskAccess['site.orders.manage']) === true || can('site.orders.create') && order.requestedBy === session.username;
    return "<div class=\"wide order-attachments\"><h3>Files and photos</h3>".concat((order.attachments || []).map(function (file) {
      return "<div><button type=\"button\" data-order-file=\"".concat(esc(file.id), "\" data-order-id=\"").concat(esc(order.id), "\">").concat(esc(file.name), "</button></div>");
    }).join('')).concat(allowed ? "<div class=\"order-upload-actions\"><label class=\"order-upload-button order-upload-primary\"><svg aria-hidden=\"true\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5\"/></svg>Choose files<input aria-label=\"Choose order files\" type=\"file\" multiple data-attach-order=\"".concat(esc(order.id), "\"></label><label class=\"order-upload-button\"><svg aria-hidden=\"true\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M14 4h-4l-2 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-4z\"/><circle cx=\"12\" cy=\"13\" r=\"4\"/></svg>Take photo<input aria-label=\"Take order photo\" type=\"file\" accept=\"image/*\" capture=\"environment\" data-attach-order=\"").concat(esc(order.id), "\"></label></div><small>Up to 10 files \xB7 5 MB each \xB7 25 MB total</small>") : '', "</div>");
  }
  function queueExistingOrderFiles(_x23) {
    return _queueExistingOrderFiles.apply(this, arguments);
  }
  function _queueExistingOrderFiles() {
    _queueExistingOrderFiles = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee41(event) {
      var order, files, owner, packet, _session59, _t46;
      return _regenerator().w(function (_context42) {
        while (1) switch (_context42.p = _context42.n) {
          case 0:
            if (!busy) {
              _context42.n = 1;
              break;
            }
            return _context42.a(2);
          case 1:
            order = orders.find(function (item) {
              return item.id === event.target.dataset.attachOrder;
            });
            if (order) {
              _context42.n = 2;
              break;
            }
            return _context42.a(2);
          case 2:
            files = Array.from(event.target.files || []).map(function (file) {
              return {
                id: crypto.randomUUID(),
                name: file.name,
                size: file.size,
                file: file
              };
            });
            if (files.length) {
              _context42.n = 3;
              break;
            }
            return _context42.a(2);
          case 3:
            owner = session.username;
            busy = true;
            _context42.p = 4;
            validateOrderFiles(files, order.attachments || []);
            if (!(outbox.queue.length && outbox.owner !== owner)) {
              _context42.n = 5;
              break;
            }
            throw Error('Sync the previous user’s saved requests first.');
          case 5:
            _context42.n = 6;
            return attachmentDb('put', files);
          case 6:
            if (!(((_session59 = session) === null || _session59 === void 0 ? void 0 : _session59.username) !== owner)) {
              _context42.n = 7;
              break;
            }
            throw Error('Your account changed. Select the files again.');
          case 7:
            packet = {
              localId: crypto.randomUUID(),
              idempotencyKey: crypto.randomUUID(),
              orderId: order.id,
              order: order,
              attachments: files.map(function (_ref38) {
                var file = _ref38.file,
                  metadata = _objectWithoutProperties(_ref38, _excluded3);
                return metadata;
              }),
              createdAt: new Date().toISOString()
            };
            outbox.owner = owner;
            outbox.queue.push(packet);
            saveOutbox();
            event.target.value = '';
            message = 'Files saved on this device, waiting to upload.';
            _context42.n = 9;
            break;
          case 8:
            _context42.p = 8;
            _t46 = _context42.v;
            if (packet) outbox.queue = outbox.queue.filter(function (item) {
              return item !== packet;
            });
            message = _t46.message;
          case 9:
            _context42.p = 9;
            busy = false;
            render();
            return _context42.f(9);
          case 10:
            void flush();
          case 11:
            return _context42.a(2);
        }
      }, _callee41, null, [[4, 8, 9, 10]]);
    }));
    return _queueExistingOrderFiles.apply(this, arguments);
  }
  function downloadOrderFile(_x24) {
    return _downloadOrderFile.apply(this, arguments);
  }
  function _downloadOrderFile() {
    _downloadOrderFile = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee42(button) {
      var response, _result17, url, link, _t47;
      return _regenerator().w(function (_context43) {
        while (1) switch (_context43.p = _context43.n) {
          case 0:
            button.disabled = true;
            _context43.p = 1;
            _context43.n = 2;
            return api('/orders/' + button.dataset.orderId + '/attachments/' + button.dataset.orderFile);
          case 2:
            response = _context43.v;
            _context43.n = 3;
            return response.json();
          case 3:
            _result17 = _context43.v;
            if (response.ok) {
              _context43.n = 4;
              break;
            }
            throw Error(_result17.error || 'Attachment could not be downloaded.');
          case 4:
            url = URL.createObjectURL(new Blob([Uint8Array.from(atob(_result17.file.data), function (c) {
              return c.charCodeAt(0);
            })], {
              type: 'application/octet-stream'
            })), link = document.createElement('a');
            link.href = url;
            link.download = _result17.file.name;
            document.body.append(link);
            link.click();
            link.remove();
            setTimeout(function () {
              return URL.revokeObjectURL(url);
            }, 60000);
            _context43.n = 6;
            break;
          case 5:
            _context43.p = 5;
            _t47 = _context43.v;
            message = _t47.message;
            render();
          case 6:
            _context43.p = 6;
            button.disabled = false;
            return _context43.f(6);
          case 7:
            return _context43.a(2);
        }
      }, _callee42, null, [[1, 5, 6, 7]]);
    }));
    return _downloadOrderFile.apply(this, arguments);
  }
  var sessionVersion = 0;
  var calendarStyle = document.createElement('style');
  calendarStyle.textContent = '.date-trigger{width:100%;min-height:44px;display:flex;align-items:center;justify-content:space-between;border-radius:12px;background:#fff;text-align:left}.date-trigger span{font-size:13px}.date-trigger b{font-size:18px;color:#155e75}.date-trigger svg{width:20px;height:20px;fill:none;stroke:#155e75;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}.date-overlay{position:fixed;inset:0;z-index:100;background:#0f172a80;display:grid;place-items:center;padding:18px}.date-dialog{width:min(100%,340px);border-radius:20px;background:#fff;padding:16px;box-shadow:0 24px 70px #0004}.date-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}.date-heading button{width:40px;height:40px;padding:0;border:0;border-radius:50%;font-size:24px}.date-heading strong{font-size:14px}.date-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;text-align:center}.date-grid>span{padding:5px 0;color:#a3a3a3;font-size:10px;text-transform:uppercase}.date-grid button{aspect-ratio:1;padding:0;border:0;border-radius:50%;background:#fff}.date-grid button.outside{color:#d4d4d4}.date-grid button.today{background:#ecfeff;color:#155e75;box-shadow:inset 0 0 0 1px #67e8f9}.date-grid button.selected{background:#155e75;color:#fff;box-shadow:none}.date-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px;padding-top:12px;border-top:1px solid #f0f0f0}.date-actions button:last-child{border-color:#a5f3fc;background:#ecfeff;color:#155e75}';
  document.head.appendChild(calendarStyle);
  var profilePhotoStyle = document.createElement('style');
  profilePhotoStyle.textContent = '.profile-photo-editor{display:grid;gap:10px;justify-items:center}.profile-photo-editor>strong{justify-self:start;font-size:12px;color:#525252}.profile-photo-preview{width:144px;height:144px;display:grid;place-items:center;overflow:hidden;border:4px solid #fff;border-radius:50%;background:#cffafe;color:#164e63;font-size:28px;font-weight:800;box-shadow:0 1px 8px #0002}.profile-photo-preview img{width:100%;height:100%;object-fit:cover}.profile-photo-choose{display:flex;width:100%;min-height:44px;align-items:center;justify-content:center;border-radius:8px;cursor:pointer}.profile-photo-choose input{position:absolute;width:1px;height:1px;min-height:0;overflow:hidden;clip:rect(0,0,0,0)}.profile-photo-editor>small{color:#737373;text-align:center}.profile-adjust{display:grid;width:100%;gap:12px;padding:14px;border:1px solid #e5e7eb;border-radius:12px;background:#f8fafc}.profile-adjust>b{color:#334155;font-size:13px}.profile-adjust label{gap:4px}.profile-adjust input[type=range]{min-height:24px;padding:0;accent-color:#155e75}.danger-button{justify-self:start;border-color:#fecaca;background:#fff;color:#b91c1c}';
  document.head.appendChild(profilePhotoStyle);
  profilePhotoStyle.textContent += '.photo-editor-screen{position:fixed;inset:0;z-index:50;display:flex;flex-direction:column;background:#fff}.photo-editor-head{display:flex;align-items:center;justify-content:space-between;padding:calc(12px + env(safe-area-inset-top)) 16px 12px;border-bottom:1px solid #e5e7eb}.photo-editor-head h2{margin:0;font-size:16px}.photo-editor-stage{min-height:0;flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;padding:24px 16px;background:#0a0a0a;color:#fff}.photo-crop-stage{position:relative;width:min(88vw,70vh);aspect-ratio:1;overflow:hidden;background:#000;touch-action:none;cursor:grab}.photo-crop-stage img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none}.photo-crop-guide{position:absolute;inset:0;border:2px solid #fff;border-radius:50%;box-shadow:0 0 0 9999px rgba(0,0,0,.5);pointer-events:none}.photo-editor-help{margin:20px 0 12px;font-size:14px;font-weight:600}.photo-editor-zoom{display:flex;align-items:center;gap:12px}.photo-editor-zoom button{width:44px;height:44px;padding:0;border-color:#ffffff55;background:#ffffff18;color:#fff;border-radius:50%;font-size:20px}.photo-editor-zoom span{width:54px;text-align:center}.photo-editor-foot{padding:14px 16px calc(14px + env(safe-area-inset-bottom));border-top:1px solid #e5e7eb}.photo-editor-foot .profile-photo-choose{border:1px solid #d4d4d4;background:#fff;color:#262626}';
  profilePhotoStyle.textContent += '.profile-photo-actions{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;width:100%}.profile-photo-actions .profile-photo-choose{width:auto;min-height:44px;padding:10px 16px;gap:8px;font-size:14px;font-weight:600;border:1px solid #155e75}.profile-photo-actions .photo-camera{background:#155e75;color:#fff}.profile-photo-actions .photo-library{background:#fff;color:#155e75}.profile-photo-choose:focus-within{outline:3px solid #38bdf8;outline-offset:3px}.profile-photo-editor>.danger-button{justify-self:center;padding:6px 10px;font-size:13px;border:0;background:transparent;color:#b91c1c}';
  var materialCalendarStyle = document.createElement('style');
  materialCalendarStyle.textContent = '.date-dialog{width:min(100%,360px);padding:0;overflow:hidden;border-radius:12px}.date-selected{background:#155e75;color:#fff;padding:22px 24px}.date-selected small{display:block;color:#cffafe;font-size:11px;font-weight:800;letter-spacing:.18em}.date-selected strong{display:block;margin-top:18px;font-size:30px;font-weight:400}.date-body{padding:18px 20px}.date-heading{margin-bottom:10px}.date-heading>span{display:flex;gap:3px}.date-heading button{background:#fff}.date-grid>span{padding:9px 0}.date-grid button{width:38px;height:38px;aspect-ratio:auto}.date-grid button.today{background:#fff;color:#155e75;box-shadow:inset 0 0 0 1px #155e75}.date-grid button.selected{background:#155e75;color:#fff;box-shadow:none}.date-actions{gap:22px;border:0;margin-top:18px;padding:0}.date-actions button{border:0;background:#fff;color:#155e75;padding:8px 0;font-size:12px;letter-spacing:.08em}.date-actions button:last-child{border:0;background:#fff;color:#155e75}';
  document.head.appendChild(materialCalendarStyle);
  new MutationObserver(function () {
    var loginBrand = root.querySelector('.login>.brand');
    if (loginBrand) {
      loginBrand.className = 'factory-home-logo';
      root.prepend(loginBrand);
    }
    root.querySelectorAll('.brand img,.factory-home-logo img').forEach(function (img) {
      if (img.src !== _brandLogo.brandLogo) img.src = _brandLogo.brandLogo;
    });
  }).observe(root, {
    childList: true,
    subtree: true
  });
  if (((_session25 = session) === null || _session25 === void 0 ? void 0 : _session25.expiresAt) <= Date.now()) clearAccountState();
  var esc = function esc(value) {
    return String(value !== null && value !== void 0 ? value : '').replace(/[&<>"']/g, function (c) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[c];
    });
  };
  var dateIso = function dateIso(date) {
      return "".concat(date.getFullYear(), "-").concat(String(date.getMonth() + 1).padStart(2, '0'), "-").concat(String(date.getDate()).padStart(2, '0'));
    },
    formatDate = function formatDate(value) {
      return new Date(value + 'T00:00:00').toLocaleDateString('en-AU', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      });
    };
  function openDatePicker(input, trigger, onChange) {
    var draft = input.value || dateIso(new Date()),
      month = new Date(draft + 'T00:00:00');
    month = new Date(month.getFullYear(), month.getMonth(), 1);
    var overlay = document.createElement('div');
    overlay.className = 'date-overlay';
    var _draw = function draw() {
      var first = month.getDay(),
        total = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate(),
        previous = new Date(month.getFullYear(), month.getMonth(), 0).getDate(),
        cells = Array.from({
          length: 42
        }, function (_, index) {
          var day = index - first + 1;
          return day < 1 ? new Date(month.getFullYear(), month.getMonth() - 1, previous + day) : day > total ? new Date(month.getFullYear(), month.getMonth() + 1, day - total) : new Date(month.getFullYear(), month.getMonth(), day);
        }),
        selected = new Date(draft + 'T00:00:00');
      overlay.innerHTML = "<div class=\"date-dialog\" role=\"dialog\" aria-label=\"Choose delivery date\"><div class=\"date-selected\"><small>SELECT DATE</small><strong>".concat(esc(selected.toLocaleDateString('en-AU', {
        weekday: 'short',
        day: 'numeric',
        month: 'short'
      })), "</strong></div><div class=\"date-body\"><div class=\"date-heading\"><strong>").concat(esc(month.toLocaleDateString('en-AU', {
        month: 'long',
        year: 'numeric'
      })), "</strong><span><button type=\"button\" data-prev aria-label=\"Previous month\">\u2039</button><button type=\"button\" data-next aria-label=\"Next month\">\u203A</button></span></div><div class=\"date-grid\">").concat(['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(function (day) {
        return "<span>".concat(day, "</span>");
      }).join('')).concat(cells.map(function (date) {
        var value = dateIso(date),
          outside = date.getMonth() !== month.getMonth();
        return "<button type=\"button\" data-day=\"".concat(value, "\" class=\"").concat(value === draft ? 'selected ' : '').concat(value === dateIso(new Date()) ? 'today ' : '').concat(outside ? 'outside' : '', "\">").concat(date.getDate(), "</button>");
      }).join(''), "</div><div class=\"date-actions\"><button type=\"button\" data-close>CANCEL</button><button type=\"button\" data-ok>OK</button></div></div></div>");
      overlay.querySelector('[data-prev]').onclick = function () {
        month = new Date(month.getFullYear(), month.getMonth() - 1, 1);
        _draw();
      };
      overlay.querySelector('[data-next]').onclick = function () {
        month = new Date(month.getFullYear(), month.getMonth() + 1, 1);
        _draw();
      };
      overlay.querySelector('[data-close]').onclick = function () {
        return overlay.remove();
      };
      overlay.querySelector('[data-ok]').onclick = function () {
        input.value = draft;
        trigger.querySelector('span').textContent = formatDate(input.value);
        captureDraft();
        overlay.remove();
        if (onChange) onChange(input.value);
      };
      overlay.querySelectorAll('[data-day]').forEach(function (button) {
        return button.onclick = function () {
          draft = button.dataset.day;
          _draw();
        };
      });
    };
    document.body.appendChild(overlay);
    _draw();
  }
  var RECEIVE_ICON = '<svg class="nav-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v11m-4-4 4 4 4-4M5 14l-2 4v3h18v-3l-2-4M3 18h5l2 3h4l2-3h5"/></svg>';
  var CNC_ICON = '<svg class="nav-svg" viewBox="0 0 64 64" fill="none" aria-hidden="true"><path d="M6 42V9L10 5H25V13H14V36L10 46Z M39 5H54L58 9V42L54 46L50 36V13H39Z" fill="currentColor"/><rect x="26" y="3" width="12" height="17" rx="1.5" fill="currentColor"/><path d="M27 22H37V26H27Z M29 28H35V32H29Z" fill="currentColor"/><path d="M14 35H50L60 56V60H4V56Z" fill="currentColor"/><path d="M32 33V39" stroke="white" stroke-width="5" stroke-linecap="round"/><path d="M32 33V39" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M24 41V47H34V53H49" stroke="white" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var SETTINGS_ICON = '<svg class="nav-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
  var SUPPORT_ICON = '<svg class="nav-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 13v-2a8 8 0 0 1 16 0v2"/><path d="M4 12H3a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h2v-6Z"/><path d="M20 12h1a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-2v-6Z"/><path d="M19 18a7 7 0 0 1-5 3"/><circle cx="12.5" cy="21" r="1"/></svg>';
  function read(key, fallback) {
    try {
      return JSON.parse((key === SESSION_KEY ? sessionStorage : deviceStorage).getItem(key) || 'null') || fallback;
    } catch (_unused8) {
      return fallback;
    }
  }
  function saveOutbox() {
    deviceStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox));
  }
  function readProjects(owner) {
    var saved = read(PROJECTS_KEY, {});
    return owner && saved.owner === owner && Array.isArray(saved.projects) ? saved.projects : [];
  }
  function clearAccountState() {
    var _receiptPad3;
    userDetailsDraft = null;
    orderTypeEditor = null;
    orderTypeSaving = false;
    orderValidationId = '';
    panelDrawingEditor = null;
    panelDrawingSaving = false;
    gateEditor = null;
    gateSaving = false;
    deliveryEditor = null;
    deliverySaving = false;
    captureComment();
    commentStates = {};
    commentDrafts = {};
    commentRequest++;
    commentVisibleId = '';
    cloudDrafts = [];
    cloudDraftError = '';
    cloudDiscardId = '';
    deviceDiscardId = '';
    captureReceipt();
    captureDraft();
    orderDraft = null;
    draftOwner = '';
    selectedOrderFiles = [];
    selectedOrderId = '';
    discardDraftArmed = false;
    sessionVersion++;
    session = null;
    busy = false;
    sharingKeys = [];
    sharingLoaded = false;
    sharingBusy = false;
    sharingError = '';
    sharingSecret = '';
    sharingSecretId = '';
    sharingLabel = '';
    sharedDraftOpening = false;
    if (!mobileHost) sessionStorage.removeItem(SESSION_KEY);
    orders = [];
    cncPanels = [];
    projects = [];
    supportTickets = [];
    profile = null;
    pendingSetup = null;
    supportSelected = '';
    supportPhoto = '';
    supportReplyPhoto = '';
    selectedProfilePhoto = null;
    profileAdjustment = {
      zoom: 1,
      x: 50,
      y: 50
    };
    profileGesture.pointers.clear();
    profileGesture.distance = 0;
    cncExpanded.clear();
    view = 'orders';
    orderScope = 'all';
    orderFilter = 'active';
    cncFilter = 'all';
    cncQuery = '';
    deviceStorage.removeItem(PROJECTS_KEY);
    document.querySelectorAll('.date-overlay').forEach(function (overlay) {
      return overlay.remove();
    });
    // Keep the outbox and its owner: signing out must never discard unsynced orders.
    notificationRequest++;
    notificationBusy = false;
    notificationError = '';
    notificationLoaded = false;
    clearNotificationsArmed = false;
    receiptDraft = null;
    receiptConflict = null;
    receiptSaving = false;
    receiptPhotoBusy = false;
    (_receiptPad3 = receiptPad) === null || _receiptPad3 === void 0 || _receiptPad3.destroy();
    receiptPad = null;
    if (receiptPhotoPreviewUrl) URL.revokeObjectURL(receiptPhotoPreviewUrl);
    receiptPhotoPreviewUrl = '';
    deliveryQuery = '';
    orderAlerts = [];
    statusConflict = null;
    statusChoices = {};
    statusSaving = false;
    historyState = {};
    productionState = {};
    productionRequest++;
    submissionState = {};
    fileRecovery = {};
    notificationOrderState = {};
    notificationOrderRequest++;
    attentionFilter = 'all';
    attentionRefreshing = false;
    attentionError = '';
    orderReturnView = 'orders';
    orderQuery = '';
    orderProject = '';
    orderRequester = '';
    orderDelivery = '';
  }
  function api(_x25) {
    return _api.apply(this, arguments);
  }
  function _api() {
    _api = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee44(path) {
      var _session60;
      var options,
        version,
        token,
        headers,
        current,
        request,
        response,
        json,
        _args45 = arguments;
      return _regenerator().w(function (_context45) {
        while (1) switch (_context45.n) {
          case 0:
            options = _args45.length > 1 && _args45[1] !== undefined ? _args45[1] : {};
            version = sessionVersion, token = ((_session60 = session) === null || _session60 === void 0 ? void 0 : _session60.token) || null, headers = new Headers(options.headers || {});
            if (token) headers.set('Authorization', 'Bearer ' + token);
            current = function current() {
              var _session61;
              return version === sessionVersion && token === (((_session61 = session) === null || _session61 === void 0 ? void 0 : _session61.token) || null) && (!mobileHost || mobileHost.isCurrent());
            };
            request = _objectSpread(_objectSpread({}, options), {}, {
              headers: headers,
              cache: 'no-store',
              signal: options.signal || AbortSignal.timeout(20000)
            });
            _context45.n = 1;
            return mobileHost ? mobileHost.apiFetch(API + path, request) : fetch(API + path, request);
          case 1:
            response = _context45.v;
            if (current()) {
              _context45.n = 2;
              break;
            }
            throw Error('Session changed. Please sign in again.');
          case 2:
            if (!(response.status === 401 && (token || mobileHost))) {
              _context45.n = 3;
              break;
            }
            clearAccountState();
            message = 'Your session expired. Sign in again; saved requests remain on this device.';
            render();
            throw Error(message);
          case 3:
            // A response arriving or finishing JSON decoding after logout cannot restore old account data.
            json = response.json.bind(response);
            response.json = /*#__PURE__*/_asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee43() {
              var data;
              return _regenerator().w(function (_context44) {
                while (1) switch (_context44.n) {
                  case 0:
                    _context44.n = 1;
                    return json();
                  case 1:
                    data = _context44.v;
                    if (current()) {
                      _context44.n = 2;
                      break;
                    }
                    throw Error('Session changed. Please sign in again.');
                  case 2:
                    return _context44.a(2, data);
                }
              }, _callee43);
            }));
            return _context45.a(2, response);
        }
      }, _callee44);
    }));
    return _api.apply(this, arguments);
  }
  function login(_x26) {
    return _login.apply(this, arguments);
  }
  function _login() {
    _login = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee45(event) {
      var form, remember, response, _result18, _t48;
      return _regenerator().w(function (_context46) {
        while (1) switch (_context46.p = _context46.n) {
          case 0:
            event.preventDefault();
            if (!busy) {
              _context46.n = 1;
              break;
            }
            return _context46.a(2);
          case 1:
            busy = true;
            message = '';
            form = new FormData(event.currentTarget), remember = form.get('remember');
            render();
            _context46.p = 2;
            _context46.n = 3;
            return api('/login', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                username: form.get('username'),
                pin: form.get('pin'),
                app: 'site'
              })
            });
          case 3:
            response = _context46.v;
            _context46.n = 4;
            return response.json();
          case 4:
            _result18 = _context46.v;
            if (response.ok) {
              _context46.n = 5;
              break;
            }
            throw Error(_result18.error || 'Login failed');
          case 5:
            if (!_result18.mustChangePin) {
              _context46.n = 6;
              break;
            }
            pendingSetup = {
              username: form.get('username'),
              pin: form.get('pin'),
              remember: !!remember
            };
            return _context46.a(2);
          case 6:
            session = {
              token: _result18.token,
              username: _result18.username,
              isAdmin: _result18.isAdmin,
              taskAccess: _result18.taskAccess || {},
              expiresAt: _result18.expiresAt
            };
            sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
            if (remember) deviceStorage.setItem(USERNAME_KEY, _result18.username);else deviceStorage.removeItem(USERNAME_KEY);
            if (!window.PanelStockWorkspaces) {
              _context46.n = 7;
              break;
            }
            _context46.n = 7;
            return openSiteWorkspace(false);
          case 7:
            _context46.n = 8;
            return refresh();
          case 8:
            _context46.n = 9;
            return flush();
          case 9:
            _context46.n = 11;
            break;
          case 10:
            _context46.p = 10;
            _t48 = _context46.v;
            message = _t48.message || 'Could not reach the server — check your connection.';
          case 11:
            _context46.p = 11;
            busy = false;
            render();
            void resumeSharedDraft();
            return _context46.f(11);
          case 12:
            return _context46.a(2);
        }
      }, _callee45, null, [[2, 10, 11, 12]]);
    }));
    return _login.apply(this, arguments);
  }
  function register(_x27) {
    return _register.apply(this, arguments);
  }
  function _register() {
    _register = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee46(event) {
      var form, response, _result19, _t49;
      return _regenerator().w(function (_context47) {
        while (1) switch (_context47.p = _context47.n) {
          case 0:
            event.preventDefault();
            if (!busy) {
              _context47.n = 1;
              break;
            }
            return _context47.a(2);
          case 1:
            busy = true;
            message = '';
            form = new FormData(event.currentTarget);
            if (!(form.get('newPin') !== form.get('confirmPin'))) {
              _context47.n = 2;
              break;
            }
            busy = false;
            message = 'The new PINs do not match.';
            render();
            return _context47.a(2);
          case 2:
            _context47.p = 2;
            _context47.n = 3;
            return api('/set-pin', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                username: pendingSetup.username,
                oldPin: pendingSetup.pin,
                newPin: form.get('newPin'),
                app: 'site'
              })
            });
          case 3:
            response = _context47.v;
            _context47.n = 4;
            return response.json();
          case 4:
            _result19 = _context47.v;
            if (response.ok) {
              _context47.n = 5;
              break;
            }
            throw Error(_result19.error || 'PIN could not be set');
          case 5:
            session = {
              token: _result19.token,
              username: _result19.username,
              isAdmin: _result19.isAdmin,
              taskAccess: _result19.taskAccess || {},
              expiresAt: _result19.expiresAt
            };
            sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
            if (pendingSetup.remember) deviceStorage.setItem(USERNAME_KEY, _result19.username);
            pendingSetup = null;
            if (!window.PanelStockWorkspaces) {
              _context47.n = 6;
              break;
            }
            _context47.n = 6;
            return openSiteWorkspace(false);
          case 6:
            _context47.n = 7;
            return refresh();
          case 7:
            _context47.n = 9;
            break;
          case 8:
            _context47.p = 8;
            _t49 = _context47.v;
            message = _t49.message || 'Could not reach the server.';
          case 9:
            _context47.p = 9;
            busy = false;
            render();
            void resumeSharedDraft();
            return _context47.f(9);
          case 10:
            return _context47.a(2);
        }
      }, _callee46, null, [[2, 8, 9, 10]]);
    }));
    return _register.apply(this, arguments);
  }
  var can = function can(task) {
    var _session26, _session27, _session28;
    return ((_session26 = session) === null || _session26 === void 0 ? void 0 : _session26.isAdmin) || (mobileHost ? ((_session27 = session) === null || _session27 === void 0 || (_session27 = _session27.taskAccess) === null || _session27 === void 0 ? void 0 : _session27[task]) === true : ((_session28 = session) === null || _session28 === void 0 || (_session28 = _session28.taskAccess) === null || _session28 === void 0 ? void 0 : _session28[task]) !== false);
  };
  function refresh() {
    return _refresh.apply(this, arguments);
  }
  function _refresh() {
    _refresh = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee51() {
      var version, sessionResponse, current, requests, _t52;
      return _regenerator().w(function (_context52) {
        while (1) switch (_context52.p = _context52.n) {
          case 0:
            if (session) {
              _context52.n = 1;
              break;
            }
            return _context52.a(2);
          case 1:
            version = sessionVersion;
            _context52.p = 2;
            _context52.n = 3;
            return api('/session');
          case 3:
            sessionResponse = _context52.v;
            if (!sessionResponse.ok) {
              _context52.n = 5;
              break;
            }
            _context52.n = 4;
            return sessionResponse.json();
          case 4:
            current = _context52.v;
            session = _objectSpread(_objectSpread({}, session), {}, {
              isAdmin: current.isAdmin,
              taskAccess: current.taskAccess || {}
            });
            if (!mobileHost) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
          case 5:
            requests = [can('site.orders.create') ? loadCloudDrafts() : Promise.resolve(), pollOrderAlerts(), api('/profile').then(/*#__PURE__*/function () {
              var _ref40 = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee47(response) {
                return _regenerator().w(function (_context48) {
                  while (1) switch (_context48.n) {
                    case 0:
                      if (!response.ok) {
                        _context48.n = 2;
                        break;
                      }
                      _context48.n = 1;
                      return response.json();
                    case 1:
                      profile = _context48.v.profile;
                    case 2:
                      return _context48.a(2);
                  }
                }, _callee47);
              }));
              return function (_x49) {
                return _ref40.apply(this, arguments);
              };
            }()), api('/support').then(/*#__PURE__*/function () {
              var _ref41 = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee48(response) {
                var _t50;
                return _regenerator().w(function (_context49) {
                  while (1) switch (_context49.n) {
                    case 0:
                      if (!response.ok) {
                        _context49.n = 3;
                        break;
                      }
                      _context49.n = 1;
                      return response.json();
                    case 1:
                      _t50 = _context49.v.tickets;
                      if (_t50) {
                        _context49.n = 2;
                        break;
                      }
                      _t50 = [];
                    case 2:
                      supportTickets = _t50;
                    case 3:
                      return _context49.a(2);
                  }
                }, _callee48);
              }));
              return function (_x50) {
                return _ref41.apply(this, arguments);
              };
            }()), can('site.orders.view') ? api('/orders').then(/*#__PURE__*/function () {
              var _ref42 = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee49(response) {
                var _result20;
                return _regenerator().w(function (_context50) {
                  while (1) switch (_context50.n) {
                    case 0:
                      if (!response.ok) {
                        _context50.n = 2;
                        break;
                      }
                      _context50.n = 1;
                      return response.json();
                    case 1:
                      _result20 = _context50.v;
                      orders = _result20.orders || [];
                      orderTypes = Array.isArray(_result20.orderTypes) ? _result20.orderTypes : [].concat(DEFAULT_ORDER_TYPES);
                      projects = (_result20.projectRecords || (_result20.projects || []).map(function (name) {
                        return {
                          id: '',
                          name: name,
                          address: '',
                          notes: '',
                          active: true
                        };
                      })).filter(function (project) {
                        return project.active !== false;
                      });
                      deviceStorage.setItem(PROJECTS_KEY, JSON.stringify({
                        owner: session.username,
                        projects: projects,
                        orderTypes: orderTypes
                      }));
                    case 2:
                      return _context50.a(2);
                  }
                }, _callee49);
              }));
              return function (_x51) {
                return _ref42.apply(this, arguments);
              };
            }()) : Promise.resolve(), can('site.cnc.view') ? api('/site/cnc').then(/*#__PURE__*/function () {
              var _ref43 = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee50(response) {
                var _t51;
                return _regenerator().w(function (_context51) {
                  while (1) switch (_context51.n) {
                    case 0:
                      if (!response.ok) {
                        _context51.n = 3;
                        break;
                      }
                      _context51.n = 1;
                      return response.json();
                    case 1:
                      _t51 = _context51.v.cncPanels;
                      if (_t51) {
                        _context51.n = 2;
                        break;
                      }
                      _t51 = [];
                    case 2:
                      cncPanels = _t51;
                    case 3:
                      return _context51.a(2);
                  }
                }, _callee50);
              }));
              return function (_x52) {
                return _ref43.apply(this, arguments);
              };
            }()) : Promise.resolve()];
            _context52.n = 6;
            return Promise.all(requests);
          case 6:
            return _context52.a(2, true);
          case 7:
            _context52.p = 7;
            _t52 = _context52.v;
            if (version === sessionVersion) message = 'Showing saved information. Connect to refresh.';
            return _context52.a(2, false);
        }
      }, _callee51, null, [[2, 7]]);
    }));
    return _refresh.apply(this, arguments);
  }
  function submissionKey(packet) {
    return packet.localId || packet.idempotencyKey;
  }
  function submissionPacket(id) {
    return session && outbox.owner === session.username ? outbox.queue.find(function (packet) {
      return submissionKey(packet) === id;
    }) : null;
  }
  function submissionPacketForOrder(id) {
    return session && outbox.owner === session.username ? outbox.queue.find(function (packet) {
      return packet.localId === id || packet.orderId === id;
    }) : null;
  }
  var storedSubmissionFiles = function storedSubmissionFiles(packet) {
    return (packet.attachments || []).map(function (file) {
      return {
        id: file.storageId || file.id
      };
    });
  };
  var submissionFileHash = /*#__PURE__*/function () {
    var _submissionFileHash = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee3(file) {
      var _t3, _t4, _t5, _t6;
      return _regenerator().w(function (_context3) {
        while (1) switch (_context3.n) {
          case 0:
            _t3 = Array;
            _t4 = Uint8Array;
            _t5 = crypto.subtle;
            _context3.n = 1;
            return file.arrayBuffer();
          case 1:
            _context3.n = 2;
            return _t5.digest.call(_t5, 'SHA-256', _context3.v);
          case 2:
            _t6 = _context3.v;
            return _context3.a(2, _t3.from.call(_t3, new _t4(_t6), function (byte) {
              return byte.toString(16).padStart(2, '0');
            }).join(''));
        }
      }, _callee3);
    }));
    function submissionFileHash(_x28) {
      return _submissionFileHash.apply(this, arguments);
    }
    return submissionFileHash;
  }();
  function submissionProgress(packet) {
    var _packet$error, _packet$omittedFiles;
    var key = submissionKey(packet),
      files = packet.attachments || [],
      uploaded = files.filter(function (file) {
        return file.uploaded === true;
      }).length,
      active = submissionState.id === key;
    var phase = active ? submissionState.step : (_packet$error = packet.error) === null || _packet$error === void 0 ? void 0 : _packet$error.step;
    var label = active ? phase === 'order' ? 'Submitting order…' : phase === 'file' ? 'Uploading files…' : 'Finishing submission…' : packet.error ? 'Needs attention' : packet.orderId ? 'Order saved · uploads pending' : navigator.onLine ? 'Waiting to submit' : 'Saved on this device · offline';
    return "<article class=\"site-submission-card\" data-submission-id=\"".concat(esc(key), "\"><div class=\"site-submission-heading\"><strong>").concat(packet.orderId ? '#' + esc(packet.order.orderNumber || 'Saved') : 'New order', " \xB7 ").concat(esc(packet.order.project || 'Project not set'), "</strong><span role=\"status\">").concat(label, "</span></div><progress max=\"").concat(files.length + 1, "\" value=\"").concat((packet.orderId ? 1 : 0) + uploaded, "\" aria-label=\"Order submission steps complete\"></progress><p class=\"site-submission-summary\">").concat(packet.orderId ? 'Order saved to your account.' : 'The office has not confirmed this order yet.', " ").concat(uploaded, " of ").concat(files.length, " file").concat(files.length === 1 ? '' : 's', " uploaded.").concat(!navigator.onLine ? ' Connect to finish.' : '', "</p>").concat(packet.error ? "<p class=\"site-submission-error\" role=\"alert\">".concat(esc(packet.error.message), "</p>") : '', "<ul class=\"site-submission-files\">").concat(files.map(function (file) {
      var _packet$error2;
      var failed = ((_packet$error2 = packet.error) === null || _packet$error2 === void 0 ? void 0 : _packet$error2.fileId) === file.id,
        uploading = active && submissionState.fileId === file.id;
      var status = file.uploaded ? 'Uploaded' : uploading ? 'Uploading…' : failed ? packet.error.missing ? 'Reattach required' : 'Upload needs attention' : 'Waiting to upload';
      var recovery = fileRecovery.packetId === key && fileRecovery.fileId === file.id;
      return "<li class=\"".concat(file.uploaded ? 'is-complete' : failed ? 'is-failed' : '', "\"><div><strong>").concat(esc(file.name), "</strong><small>").concat(status, "</small></div>").concat(!file.uploaded ? "<div class=\"actions\">".concat(failed && !packet.error.missing ? "<button type=\"button\" data-retry-submission-file=\"".concat(esc(file.id), "\" data-submission-packet=\"").concat(esc(key), "\" ").concat(busy || !navigator.onLine ? 'disabled' : '', ">Retry file</button>") : '', "<label class=\"site-submission-reattach ").concat(busy ? 'is-disabled' : '', "\">Reattach<input type=\"file\" aria-label=\"Reattach ").concat(esc(file.name), "\" data-reattach-submission=\"").concat(esc(file.id), "\" data-submission-packet=\"").concat(esc(key), "\" ").concat(busy ? 'disabled' : '', "></label><button type=\"button\" data-omit-submission-file=\"").concat(esc(file.id), "\" data-submission-packet=\"").concat(esc(key), "\" ").concat(busy ? 'disabled' : '', ">").concat(recovery && fileRecovery.omit ? 'Yes, omit file' : 'Omit file', "</button></div>") : '').concat(recovery && fileRecovery.omit ? "<p class=\"site-submission-summary\">Omit ".concat(esc(file.name), " from this waiting request? Uploaded files are kept. <button type=\"button\" data-keep-submission-file ").concat(busy ? 'disabled' : '', ">Keep file</button></p>") : '').concat(recovery && fileRecovery.error ? "<p class=\"site-submission-error\" role=\"alert\">".concat(esc(fileRecovery.error), "</p>") : '', "</li>");
    }).join(''), "</ul>").concat((_packet$omittedFiles = packet.omittedFiles) !== null && _packet$omittedFiles !== void 0 && _packet$omittedFiles.length ? "<p class=\"site-submission-summary\">Omitted: ".concat(packet.omittedFiles.map(esc).join(', '), "</p>") : '', "<button type=\"button\" data-retry-submission=\"").concat(esc(key), "\" ").concat(busy || !navigator.onLine ? 'disabled' : '', ">").concat(active ? 'Syncing…' : packet.orderId ? 'Finish sync' : 'Submit this order', "</button></article>");
  }
  function submissionQueueContent() {
    return session && outbox.owner === session.username && outbox.queue.length ? "<section class=\"site-submission\"><h3>Submission progress</h3><p class=\"site-submission-summary\">Requests and waiting files stay on this device until each step is confirmed.</p>".concat(outbox.queue.map(submissionProgress).join(''), "</section>") : '';
  }
  function submissionQueueView() {
    return "<div data-submission-queue>".concat(submissionQueueContent(), "</div>");
  }
  function submissionOrderContent() {
    var packet = submissionPacketForOrder(selectedOrderId);
    return packet ? "<section class=\"site-submission\"><h3>Submission progress</h3>".concat(submissionProgress(packet), "</section>") : '';
  }
  function updateSubmissionUI() {
    root.querySelectorAll('[data-submission-queue]').forEach(function (node) {
      node.innerHTML = submissionQueueContent();
    });
    root.querySelectorAll('[data-submission-order]').forEach(function (node) {
      node.innerHTML = submissionOrderContent();
    });
    wireSubmissionRecovery();
  }
  function wireSubmissionRecovery() {
    root.querySelectorAll('[data-retry-submission]').forEach(function (button) {
      return button.onclick = function () {
        return flush(button.dataset.retrySubmission);
      };
    });
    root.querySelectorAll('[data-retry-submission-file]').forEach(function (button) {
      return button.onclick = function () {
        return flush(button.dataset.submissionPacket, button.dataset.retrySubmissionFile);
      };
    });
    root.querySelectorAll('[data-reattach-submission]').forEach(function (input) {
      return input.onchange = reattachSubmissionFile;
    });
    root.querySelectorAll('[data-omit-submission-file]').forEach(function (button) {
      return button.onclick = function () {
        return omitSubmissionFile(button.dataset.submissionPacket, button.dataset.omitSubmissionFile);
      };
    });
    root.querySelectorAll('[data-keep-submission-file]').forEach(function (button) {
      return button.onclick = function () {
        fileRecovery = {};
        updateSubmissionUI();
      };
    });
  }
  function reattachSubmissionFile(_x29) {
    return _reattachSubmissionFile.apply(this, arguments);
  }
  function _reattachSubmissionFile() {
    _reattachSubmissionFile = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee52(event) {
      var _packet$attachments, _input$files;
      var input, packet, index, file, owner, version, previous, replacement, key, stored, saved, _session62, _session63, existing, _iterator0, _step0, item, previousError, _session64, _session65, _t53, _t54;
      return _regenerator().w(function (_context53) {
        while (1) switch (_context53.p = _context53.n) {
          case 0:
            if (!busy) {
              _context53.n = 1;
              break;
            }
            return _context53.a(2);
          case 1:
            input = event.target, packet = submissionPacket(input.dataset.submissionPacket), index = packet === null || packet === void 0 || (_packet$attachments = packet.attachments) === null || _packet$attachments === void 0 ? void 0 : _packet$attachments.findIndex(function (file) {
              return file.id === input.dataset.reattachSubmission;
            }), file = (_input$files = input.files) === null || _input$files === void 0 ? void 0 : _input$files[0];
            if (!(!packet || index < 0 || packet.attachments[index].uploaded || !file)) {
              _context53.n = 2;
              break;
            }
            return _context53.a(2);
          case 2:
            owner = session.username, version = sessionVersion, previous = packet.attachments[index], replacement = {
              id: previous.id,
              storageId: crypto.randomUUID(),
              name: file.name,
              size: file.size
            }, key = submissionKey(packet);
            stored = false, saved = false;
            busy = true;
            fileRecovery = {
              packetId: key,
              fileId: previous.id
            };
            updateSubmissionUI();
            _context53.p = 3;
            existing = new Map((packet.order.attachments || []).map(function (item) {
              return [item.id, item];
            }));
            _iterator0 = _createForOfIteratorHelper(packet.attachments);
            try {
              for (_iterator0.s(); !(_step0 = _iterator0.n()).done;) {
                item = _step0.value;
                existing.set(item.id, item);
              }
            } catch (err) {
              _iterator0.e(err);
            } finally {
              _iterator0.f();
            }
            existing.delete(previous.id);
            validateOrderFiles([replacement], _toConsumableArray(existing.values()));
            _context53.n = 4;
            return submissionFileHash(file);
          case 4:
            replacement.sha256 = _context53.v;
            if (!(version !== sessionVersion || ((_session62 = session) === null || _session62 === void 0 ? void 0 : _session62.username) !== owner)) {
              _context53.n = 5;
              break;
            }
            return _context53.a(2);
          case 5:
            _context53.n = 6;
            return attachmentDb('put', [{
              id: replacement.storageId,
              file: file
            }]);
          case 6:
            stored = true;
            if (!(version !== sessionVersion || ((_session63 = session) === null || _session63 === void 0 ? void 0 : _session63.username) !== owner)) {
              _context53.n = 7;
              break;
            }
            return _context53.a(2);
          case 7:
            previousError = packet.error;
            packet.attachments[index] = replacement;
            delete packet.error;
            _context53.p = 8;
            saveOutbox();
            saved = true;
            _context53.n = 10;
            break;
          case 9:
            _context53.p = 9;
            _t53 = _context53.v;
            packet.attachments[index] = previous;
            packet.error = previousError;
            throw _t53;
          case 10:
            _context53.n = 11;
            return attachmentDb('delete', [{
              id: previous.storageId || previous.id
            }]).catch(function () {});
          case 11:
            _context53.n = 13;
            break;
          case 12:
            _context53.p = 12;
            _t54 = _context53.v;
            if (version === sessionVersion && ((_session64 = session) === null || _session64 === void 0 ? void 0 : _session64.username) === owner) fileRecovery = {
              packetId: key,
              fileId: previous.id,
              error: _t54.message
            };
          case 13:
            _context53.p = 13;
            if (!(stored && !saved)) {
              _context53.n = 14;
              break;
            }
            _context53.n = 14;
            return attachmentDb('delete', [{
              id: replacement.storageId
            }]).catch(function () {});
          case 14:
            if (version === sessionVersion && ((_session65 = session) === null || _session65 === void 0 ? void 0 : _session65.username) === owner) {
              busy = false;
              updateSubmissionUI();
            }
            input.value = '';
            return _context53.f(13);
          case 15:
            return _context53.a(2);
        }
      }, _callee52, null, [[8, 9], [3, 12, 13, 15]]);
    }));
    return _reattachSubmissionFile.apply(this, arguments);
  }
  function omitSubmissionFile(_x30, _x31) {
    return _omitSubmissionFile.apply(this, arguments);
  }
  function _omitSubmissionFile() {
    _omitSubmissionFile = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee53(packetId, fileId) {
      var _packet$emailAttachme, _packet$error3;
      var packet, file, previousFiles, previousError, previousOmitted, previousOmittedIds, _t55;
      return _regenerator().w(function (_context54) {
        while (1) switch (_context54.p = _context54.n) {
          case 0:
            packet = submissionPacket(packetId), file = packet === null || packet === void 0 ? void 0 : packet.attachments.find(function (value) {
              return value.id === fileId;
            });
            if (!(busy || !file || file.uploaded)) {
              _context54.n = 1;
              break;
            }
            return _context54.a(2);
          case 1:
            if (!(fileRecovery.packetId !== packetId || fileRecovery.fileId !== fileId || !fileRecovery.omit)) {
              _context54.n = 2;
              break;
            }
            fileRecovery = {
              packetId: packetId,
              fileId: fileId,
              omit: true
            };
            updateSubmissionUI();
            return _context54.a(2);
          case 2:
            previousFiles = packet.attachments, previousError = packet.error, previousOmitted = packet.omittedFiles, previousOmittedIds = packet.omittedEmailAttachmentIds;
            packet.attachments = previousFiles.filter(function (value) {
              return value !== file;
            });
            packet.omittedFiles = [].concat(_toConsumableArray(previousOmitted || []), [file.name]);
            if ((_packet$emailAttachme = packet.emailAttachmentIds) !== null && _packet$emailAttachme !== void 0 && _packet$emailAttachme.includes(file.id)) packet.omittedEmailAttachmentIds = [].concat(_toConsumableArray(previousOmittedIds || []), [file.id]);
            if (((_packet$error3 = packet.error) === null || _packet$error3 === void 0 ? void 0 : _packet$error3.fileId) === fileId) delete packet.error;
            _context54.p = 3;
            saveOutbox();
            _context54.n = 5;
            break;
          case 4:
            _context54.p = 4;
            _t55 = _context54.v;
            packet.attachments = previousFiles;
            packet.error = previousError;
            packet.omittedFiles = previousOmitted;
            packet.omittedEmailAttachmentIds = previousOmittedIds;
            fileRecovery.error = _t55.message;
            updateSubmissionUI();
            return _context54.a(2);
          case 5:
            fileRecovery = {};
            updateSubmissionUI();
            _context54.n = 6;
            return attachmentDb('delete', [{
              id: file.storageId || file.id
            }]).catch(function () {});
          case 6:
            return _context54.a(2);
        }
      }, _callee53, null, [[3, 4]]);
    }));
    return _omitSubmissionFile.apply(this, arguments);
  }
  function reconcileSubmissionFiles(_x32, _x33, _x34) {
    return _reconcileSubmissionFiles.apply(this, arguments);
  }
  function _reconcileSubmissionFiles() {
    _reconcileSubmissionFiles = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee54(packet, current, persist) {
      var _result$order;
      var response, result, _iterator1, _step1, _loop6, _t56;
      return _regenerator().w(function (_context56) {
        while (1) switch (_context56.p = _context56.n) {
          case 0:
            _context56.n = 1;
            return api('/orders/' + encodeURIComponent(packet.orderId));
          case 1:
            response = _context56.v;
            _context56.n = 2;
            return response.json();
          case 2:
            result = _context56.v;
            current();
            if (response.ok) {
              _context56.n = 3;
              break;
            }
            throw Error(result.error || 'The saved order could not be checked. Retry when connected.');
          case 3:
            if (!(((_result$order = result.order) === null || _result$order === void 0 ? void 0 : _result$order.id) !== packet.orderId)) {
              _context56.n = 4;
              break;
            }
            throw Error('The saved order could not be checked.');
          case 4:
            packet.order = result.order;
            _iterator1 = _createForOfIteratorHelper(packet.attachments || []);
            _context56.p = 5;
            _loop6 = /*#__PURE__*/_regenerator().m(function _loop6() {
              var file, saved, error;
              return _regenerator().w(function (_context55) {
                while (1) switch (_context55.n) {
                  case 0:
                    file = _step1.value;
                    saved = (result.order.attachments || []).find(function (value) {
                      return value.id === file.id;
                    });
                    if (!(!saved || file.uploaded)) {
                      _context55.n = 1;
                      break;
                    }
                    return _context55.a(2, 1);
                  case 1:
                    if (!(saved.name !== file.name.trim().replace(/[\\/]/g, '_') || saved.size !== file.size || file.sha256 && saved.sha256 !== file.sha256)) {
                      _context55.n = 2;
                      break;
                    }
                    error = Error('This file is already uploaded with different details. View the order to check it, or omit the waiting copy.');
                    error.fileId = file.id;
                    throw error;
                  case 2:
                    file.uploaded = true;
                  case 3:
                    return _context55.a(2);
                }
              }, _loop6);
            });
            _iterator1.s();
          case 6:
            if ((_step1 = _iterator1.n()).done) {
              _context56.n = 9;
              break;
            }
            return _context56.d(_regeneratorValues(_loop6()), 7);
          case 7:
            if (!_context56.v) {
              _context56.n = 8;
              break;
            }
            return _context56.a(3, 8);
          case 8:
            _context56.n = 6;
            break;
          case 9:
            _context56.n = 11;
            break;
          case 10:
            _context56.p = 10;
            _t56 = _context56.v;
            _iterator1.e(_t56);
          case 11:
            _context56.p = 11;
            _iterator1.f();
            return _context56.f(11);
          case 12:
            persist();
          case 13:
            return _context56.a(2);
        }
      }, _callee54, null, [[5, 10, 11, 12]]);
    }));
    return _reconcileSubmissionFiles.apply(this, arguments);
  }
  function flush(_x35, _x36) {
    return _flush.apply(this, arguments);
  }
  function _flush() {
    _flush = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee55(packetId, fileId) {
      var owner, version, queue, retainedDraft, completed, lastError, current, persist, _iterator10, _step10, _loop7, _ret, _t62, _t63;
      return _regenerator().w(function (_context58) {
        while (1) switch (_context58.p = _context58.n) {
          case 0:
            if (!(busy || !session || !navigator.onLine || !outbox.queue.length || outbox.owner !== session.username)) {
              _context58.n = 1;
              break;
            }
            return _context58.a(2);
          case 1:
            if (!(packetId && !submissionPacket(packetId))) {
              _context58.n = 2;
              break;
            }
            return _context58.a(2);
          case 2:
            owner = session.username, version = sessionVersion, queue = outbox.queue.filter(function (packet) {
              return !packetId || submissionKey(packet) === packetId;
            });
            retainedDraft = false, completed = 0, lastError = '';
            busy = true;
            current = function current() {
              var _session66;
              if (((_session66 = session) === null || _session66 === void 0 ? void 0 : _session66.username) !== owner || version !== sessionVersion) throw Error('Your account changed. Sign back in to finish uploading.');
            };
            persist = function persist() {
              try {
                saveOutbox();
              } catch (error) {
                error.step = 'storage';
                throw error;
              }
            };
            _context58.p = 3;
            _iterator10 = _createForOfIteratorHelper(queue);
            _context58.p = 4;
            _loop7 = /*#__PURE__*/_regenerator().m(function _loop7() {
              var packet, step, activeFile, _result21$order, response, _result21, _iterator11, _step11, _result23$attachment, metadata, _file, error, data, _response2, _result23, _response, _result22, index, _t57, _t58, _t59, _t60, _t61;
              return _regenerator().w(function (_context57) {
                while (1) switch (_context57.p = _context57.n) {
                  case 0:
                    packet = _step10.value;
                    current();
                    if (!(fileId && !(packet.attachments || []).some(function (file) {
                      return file.id === fileId && !file.uploaded;
                    }))) {
                      _context57.n = 1;
                      break;
                    }
                    return _context57.a(2, 0);
                  case 1:
                    step = packet.orderId ? 'file' : 'order', activeFile = '';
                    submissionState = {
                      id: submissionKey(packet),
                      step: step
                    };
                    updateSubmissionUI();
                    _context57.p = 2;
                    // Write progress before making another request, even after a storage failure.
                    if (!packet.orderId && !packet.emailAttachmentIds) packet.emailAttachmentIds = (packet.attachments || []).map(function (file) {
                      return file.id;
                    });
                    persist();
                    if (!packet.orderId) {
                      _context57.n = 3;
                      break;
                    }
                    _context57.n = 3;
                    return reconcileSubmissionFiles(packet, current, persist);
                  case 3:
                    if (packet.orderId) {
                      _context57.n = 8;
                      break;
                    }
                    _context57.n = 4;
                    return api('/orders', {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json'
                      },
                      body: JSON.stringify({
                        idempotencyKey: packet.idempotencyKey,
                        order: packet.order,
                        attachmentIds: packet.emailAttachmentIds || []
                      })
                    });
                  case 4:
                    response = _context57.v;
                    _context57.n = 5;
                    return response.json();
                  case 5:
                    _result21 = _context57.v;
                    current();
                    if (response.ok) {
                      _context57.n = 6;
                      break;
                    }
                    throw Error(_result21.error || 'Order submission failed');
                  case 6:
                    if ((_result21$order = _result21.order) !== null && _result21$order !== void 0 && _result21$order.id) {
                      _context57.n = 7;
                      break;
                    }
                    throw Error('The order confirmation could not be read. Retry this request.');
                  case 7:
                    packet.orderId = _result21.order.id;
                    packet.order = _result21.order;
                    persist();
                  case 8:
                    delete packet.error;
                    step = 'file';
                    _iterator11 = _createForOfIteratorHelper(packet.attachments || []);
                    _context57.p = 9;
                    _iterator11.s();
                  case 10:
                    if ((_step11 = _iterator11.n()).done) {
                      _context57.n = 21;
                      break;
                    }
                    metadata = _step11.value;
                    if (!(metadata.uploaded || fileId && metadata.id !== fileId)) {
                      _context57.n = 11;
                      break;
                    }
                    return _context57.a(3, 20);
                  case 11:
                    activeFile = metadata.id;
                    submissionState = {
                      id: submissionKey(packet),
                      step: step,
                      fileId: activeFile
                    };
                    updateSubmissionUI();
                    _context57.n = 12;
                    return attachmentDb('get', metadata.storageId || metadata.id);
                  case 12:
                    _file = _context57.v;
                    current();
                    if (_file) {
                      _context57.n = 13;
                      break;
                    }
                    error = Error('A waiting file is unavailable on this device. Your order is saved; reattach this file or explicitly omit it.');
                    error.missing = true;
                    throw error;
                  case 13:
                    _context57.n = 14;
                    return submissionFileHash(_file);
                  case 14:
                    metadata.sha256 = _context57.v;
                    current();
                    persist();
                    _context57.n = 15;
                    return attachmentData(_file);
                  case 15:
                    data = _context57.v;
                    current();
                    _context57.n = 16;
                    return api('/orders/' + packet.orderId + '/attachments', {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json'
                      },
                      body: JSON.stringify({
                        id: metadata.id,
                        name: metadata.name,
                        data: data
                      })
                    });
                  case 16:
                    _response2 = _context57.v;
                    _context57.n = 17;
                    return _response2.json();
                  case 17:
                    _result23 = _context57.v;
                    current();
                    if (_response2.ok) {
                      _context57.n = 18;
                      break;
                    }
                    throw Error(_result23.error || 'Attachment upload failed. Retry when connected.');
                  case 18:
                    if (!(((_result23$attachment = _result23.attachment) === null || _result23$attachment === void 0 ? void 0 : _result23$attachment.id) !== metadata.id)) {
                      _context57.n = 19;
                      break;
                    }
                    throw Error('The file confirmation could not be read. Retry this file.');
                  case 19:
                    metadata.uploaded = true;
                    packet.order.attachments = _result23.attachments || packet.order.attachments;
                    persist();
                    updateSubmissionUI();
                  case 20:
                    _context57.n = 10;
                    break;
                  case 21:
                    _context57.n = 23;
                    break;
                  case 22:
                    _context57.p = 22;
                    _t57 = _context57.v;
                    _iterator11.e(_t57);
                  case 23:
                    _context57.p = 23;
                    _iterator11.f();
                    return _context57.f(23);
                  case 24:
                    if (!(packet.attachments || []).some(function (file) {
                      return !file.uploaded;
                    })) {
                      _context57.n = 25;
                      break;
                    }
                    persist();
                    return _context57.a(2, 0);
                  case 25:
                    step = 'finish';
                    activeFile = '';
                    submissionState = {
                      id: submissionKey(packet),
                      step: step
                    };
                    updateSubmissionUI();
                    if (!(!packet.emailFinalized && ((packet.emailAttachmentIds || []).length || (packet.attachments || []).length))) {
                      _context57.n = 29;
                      break;
                    }
                    _context57.n = 26;
                    return api('/orders/' + packet.orderId + '/email-attachments', {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json'
                      },
                      body: JSON.stringify({
                        batchId: packet.idempotencyKey,
                        attachmentIds: (packet.attachments || []).map(function (file) {
                          return file.id;
                        }),
                        omittedAttachmentIds: packet.omittedEmailAttachmentIds || []
                      })
                    });
                  case 26:
                    _response = _context57.v;
                    _context57.n = 27;
                    return _response.json();
                  case 27:
                    _result22 = _context57.v;
                    current();
                    if (!(!_response.ok || _result22.ok !== true)) {
                      _context57.n = 28;
                      break;
                    }
                    throw Error(_result22.error || 'Files are uploaded, but the order email could not be queued. Retry to finish.');
                  case 28:
                    packet.emailFinalized = true;
                    persist();
                  case 29:
                    if (!packet.cloudDraftId) {
                      _context57.n = 34;
                      break;
                    }
                    _context57.p = 30;
                    _context57.n = 31;
                    return draftApi('/' + packet.cloudDraftId + '/discard', {
                      expectedUpdatedAt: packet.cloudDraftVersion
                    });
                  case 31:
                    _context57.n = 33;
                    break;
                  case 32:
                    _context57.p = 32;
                    _t58 = _context57.v;
                    current();
                    if (!/not found/i.test(_t58.message)) retainedDraft = true;
                  case 33:
                    current();
                  case 34:
                    orders = [packet.order].concat(_toConsumableArray(orders.filter(function (order) {
                      return order.id !== packet.orderId;
                    })));
                    index = outbox.queue.indexOf(packet);
                    outbox.queue.splice(index, 1);
                    _context57.p = 35;
                    persist();
                    _context57.n = 37;
                    break;
                  case 36:
                    _context57.p = 36;
                    _t59 = _context57.v;
                    outbox.queue.splice(index, 0, packet);
                    throw _t59;
                  case 37:
                    if (view === 'order' && selectedOrderId === packet.localId) {
                      selectedOrderId = packet.orderId;
                      historyState = {};
                      productionState = {};
                      void loadOrderHistory(selectedOrderId);
                      void loadProductionProgress(selectedOrderId);
                    }
                    completed++;
                    _context57.n = 38;
                    return attachmentDb('delete', storedSubmissionFiles(packet)).catch(function () {});
                  case 38:
                    current();
                    _context57.n = 43;
                    break;
                  case 39:
                    _context57.p = 39;
                    _t60 = _context57.v;
                    current();
                    packet.error = {
                      step: _t60.step || step,
                      fileId: _t60.fileId || activeFile,
                      missing: _t60.missing === true,
                      message: _t60.message || 'Request and files remain saved on this device.'
                    };
                    lastError = packet.error.message;
                    _context57.p = 40;
                    persist();
                    _context57.n = 42;
                    break;
                  case 41:
                    _context57.p = 41;
                    _t61 = _context57.v;
                    return _context57.a(2, 1);
                  case 42:
                    if (!(_t60.step === 'storage')) {
                      _context57.n = 43;
                      break;
                    }
                    return _context57.a(2, 1);
                  case 43:
                    _context57.p = 43;
                    if (version === sessionVersion) {
                      submissionState = {};
                      updateSubmissionUI();
                    }
                    return _context57.f(43);
                  case 44:
                    return _context57.a(2);
                }
              }, _loop7, null, [[40, 41], [35, 36], [30, 32], [9, 22, 23, 24], [2, 39, 43, 44]]);
            });
            _iterator10.s();
          case 5:
            if ((_step10 = _iterator10.n()).done) {
              _context58.n = 9;
              break;
            }
            return _context58.d(_regeneratorValues(_loop7()), 6);
          case 6:
            _ret = _context58.v;
            if (!(_ret === 0)) {
              _context58.n = 7;
              break;
            }
            return _context58.a(3, 8);
          case 7:
            if (!(_ret === 1)) {
              _context58.n = 8;
              break;
            }
            return _context58.a(3, 9);
          case 8:
            _context58.n = 5;
            break;
          case 9:
            _context58.n = 11;
            break;
          case 10:
            _context58.p = 10;
            _t62 = _context58.v;
            _iterator10.e(_t62);
          case 11:
            _context58.p = 11;
            _iterator10.f();
            return _context58.f(11);
          case 12:
            current();
            message = lastError ? completed ? 'Some requests synced. Review the waiting request below.' : lastError : completed ? retainedDraft ? 'Order request and attachments submitted. A saved draft was retained; check Drafts.' : 'Order request and attachments submitted.' : 'Waiting files remain saved on this device.';
            if (!completed) {
              _context58.n = 14;
              break;
            }
            _context58.n = 13;
            return refresh();
          case 13:
            current();
          case 14:
            _context58.n = 16;
            break;
          case 15:
            _context58.p = 15;
            _t63 = _context58.v;
            if (version === sessionVersion) message = _t63.message;
          case 16:
            _context58.p = 16;
            if (version === sessionVersion) {
              busy = false;
              submissionState = {};
              updateSubmissionUI();
              if (['orders', 'order-attention'].includes(view) || view === 'order' && !root.querySelector('[data-receipt-form]')) render();
            }
            return _context58.f(16);
          case 17:
            return _context58.a(2);
        }
      }, _callee55, null, [[4, 10, 11, 12], [3, 15, 16, 17]]);
    }));
    return _flush.apply(this, arguments);
  }
  function shell(content) {
    if (!mobileHost) content = sharedDraftBanner() + content;
    if (mobileHost) return "<main class=\"shell site-mobile-orders site-order-screen\"><header class=\"topbar\"><h2>Site Orders</h2></header><div class=\"content\">".concat(content, "</div></main>");
    return "<main class=\"shell ".concat(view === 'notifications' ? 'site-notifications-screen' : ['order', 'orders', 'order-search', 'deliveries'].includes(view) ? 'site-order-screen' : '', "\"><header class=\"topbar\"><div class=\"brand\"><img src=\"/icon-512.png\" alt=\"Lennox Facades\"></div>").concat(notificationBell(), "</header><div class=\"content\">").concat(content, "</div><nav class=\"bottom-nav\">").concat(can('site.orders.view') ? "<button data-orders class=\"".concat(view === 'orders' || view === 'order-search' || view === 'new' || view === 'order' || view === 'drafts' ? 'active' : '', "\"><span class=\"nav-icon\">\u25A4</span><span>Orders</span></button>") : '').concat(canUseReceive() ? "<button data-receive class=\"".concat(view === 'deliveries' ? 'active' : '', "\" ").concat(view === 'deliveries' ? 'aria-current="page"' : '', "><span class=\"nav-icon\">").concat(RECEIVE_ICON, "</span><span>Receive</span></button>") : '').concat(can('site.cnc.view') ? "<button data-cnc class=\"".concat(view === 'cnc' ? 'active' : '', "\"><span class=\"nav-icon\">").concat(CNC_ICON, "</span><span>CNC</span></button>") : '', "<button data-support class=\"").concat(view === 'support' ? 'active' : '', "\"><span class=\"nav-icon\">").concat(SUPPORT_ICON, "</span><span>Support</span></button><button data-settings class=\"").concat(view === 'settings' ? 'active' : '', "\"><span class=\"nav-icon\">").concat(SETTINGS_ICON, "</span><span>Settings</span></button></nav></main>");
  }
  function confirmPinReset(name) {
    return new Promise(function (resolve) {
      var previous = document.activeElement,
        overlay = document.createElement('div'),
        dialog = document.createElement('div'),
        heading = document.createElement('h2'),
        message = document.createElement('p'),
        footer = document.createElement('div'),
        cancel = document.createElement('button'),
        send = document.createElement('button');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;display:grid;place-items:center;padding:24px;background:rgba(15,23,42,.55)';
      dialog.setAttribute('role', 'alertdialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-labelledby', 'pin-reset-confirm-title');
      dialog.setAttribute('aria-describedby', 'pin-reset-confirm-message');
      dialog.style.cssText = 'width:100%;max-width:480px;border-radius:12px;background:#fff;padding:24px;box-shadow:0 24px 60px rgba(15,23,42,.28)';
      heading.id = 'pin-reset-confirm-title';
      heading.textContent = 'Send PIN reset link?';
      heading.style.cssText = 'margin:0 0 16px;font-size:18px;color:#0f172a';
      message.id = 'pin-reset-confirm-message';
      message.textContent = 'Request a PIN reset for ' + name + '? A reset link will be emailed to the address saved on this account, if one is set.';
      message.style.cssText = 'color:#475569;font-size:14px;line-height:1.6;overflow-wrap:anywhere';
      footer.style.cssText = 'display:flex;justify-content:flex-end;gap:12px;margin-top:24px';
      cancel.type = 'button';
      cancel.textContent = 'Cancel';
      cancel.style.cssText = 'min-height:44px;padding:10px 16px;background:#fff;border:1px solid #cbd5e1;border-radius:8px;color:#475569';
      send.type = 'button';
      send.textContent = 'Send reset link';
      send.style.cssText = 'min-height:44px;padding:10px 16px;background:#155e75;border:1px solid #155e75;border-radius:8px;color:#fff';
      footer.appendChild(cancel);
      footer.appendChild(send);
      dialog.appendChild(heading);
      dialog.appendChild(message);
      dialog.appendChild(footer);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);
      var closed = false;
      function finish(value) {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKey);
        overlay.parentNode.removeChild(overlay);
        if (previous && previous.focus) previous.focus();
        resolve(value);
      }
      function onKey(event) {
        if (event.key === 'Escape') {
          event.preventDefault();
          finish(false);
        }
        if (event.key === 'Tab') {
          if (event.shiftKey && document.activeElement === cancel) {
            event.preventDefault();
            send.focus();
          } else if (!event.shiftKey && document.activeElement === send) {
            event.preventDefault();
            cancel.focus();
          }
        }
      }
      cancel.onclick = function () {
        finish(false);
      };
      send.onclick = function () {
        finish(true);
      };
      overlay.onclick = function (event) {
        if (event.target === overlay) finish(false);
      };
      document.addEventListener('keydown', onKey);
      cancel.focus();
    });
  }
  function loginScreen() {
    var _root$querySelector20, _root$querySelector21;
    var remembered = deviceStorage.getItem(USERNAME_KEY) || '';
    root.innerHTML = "<section class=\"login\"><div class=\"brand\"><img src=\"/icon-512.png\" alt=\"Lennox Facades\"><div><h1>Site Orders</h1></div></div><h2 class=\"login-title\"><span class=\"person\">\u2659</span>".concat(pendingSetup ? 'Set a new PIN' : 'Log in to PanelStock', "</h2>").concat(message ? "<div class=\"notice\">".concat(esc(message), "</div>") : '').concat(pendingSetup ? "<form data-register><p class=\"login-help\">Your account was created by an administrator. Choose your personal PIN.</p><label>New PIN<input name=\"newPin\" type=\"password\" inputmode=\"numeric\" pattern=\"[0-9]{6,12}\" placeholder=\"6\u201312 digits\" required></label><label>Confirm new PIN<input name=\"confirmPin\" type=\"password\" inputmode=\"numeric\" pattern=\"[0-9]{6,12}\" placeholder=\"Re-enter PIN\" required></label><button class=\"primary\" type=\"submit\" ".concat(busy ? 'disabled' : '', ">").concat(busy ? 'Saving…' : 'Set PIN & continue', "</button></form>") : "<form data-login><label>Username<input name=\"username\" autocomplete=\"username\" value=\"".concat(esc(remembered), "\" placeholder=\"e.g. Sam\" required></label><div class=\"login-pin-field\"><div class=\"login-pin-heading\"><label for=\"login-pin\">PIN</label><button type=\"button\" data-pin-reset>Forgot PIN?</button></div><input id=\"login-pin\" name=\"pin\" type=\"password\" inputmode=\"numeric\" autocomplete=\"current-password\" placeholder=\"Your PIN\" required></div><label class=\"remember\"><input name=\"remember\" type=\"checkbox\" checked>Remember my username on this device</label><button class=\"primary\" type=\"submit\" ").concat(busy ? 'disabled' : '', ">").concat(busy ? 'Checking…' : 'Log in', "</button></form>"), "</section>");
    (_root$querySelector20 = root.querySelector('[data-login]')) === null || _root$querySelector20 === void 0 || _root$querySelector20.addEventListener('submit', login);
    (_root$querySelector21 = root.querySelector('[data-register]')) === null || _root$querySelector21 === void 0 || _root$querySelector21.addEventListener('submit', register);
    var resetButton = root.querySelector('[data-pin-reset]');
    if (resetButton) resetButton.onclick = function () {
      var input = root.querySelector('input[name="username"]'),
        name = input ? input.value.trim() : '';
      if (!name) {
        message = 'Enter your username first.';
        render();
        return;
      }
      if (busy) return;
      busy = true;
      confirmPinReset(name).then(function (confirmed) {
        if (!confirmed) {
          busy = false;
          return;
        }
        return api('/passcode-reset-request', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            username: name
          })
        }).then(function (response) {
          return response.json();
        }).then(function (result) {
          message = result.message || result.error || "If your account has an email address, a PIN reset link will be sent. Otherwise, contact your administrator.";
        }).catch(function () {
          message = 'Could not reach the server. Please try again.';
        }).then(function () {
          busy = false;
          render();
        });
      }).catch(function () {
        busy = false;
        message = 'Could not open the reset confirmation. Please try again.';
        render();
      });
    };
  }
  function orderList() {
    var searchMode = view === 'order-search',
      pending = pendingOrders(),
      all = [].concat(_toConsumableArray(pending), _toConsumableArray(orders.filter(function (order) {
        return outbox.owner !== session.username || !outbox.queue.some(function (packet) {
          return packet.orderId === order.id;
        });
      }))),
      scoped = searchMode || orderScope === 'all' ? all : all.filter(function (order) {
        return order.local || order.requestedBy === session.username;
      }),
      matches = function matches(order) {
        return orderFilter === 'active' ? order.local || ['submitted', 'ordered', 'approved', 'in_stock', 'completed'].includes(order.status) : order.status === orderFilter;
      },
      shown = scoped.filter(function (order) {
        return matches(order) && (!searchMode || matchesOrder(order));
      }),
      active = scoped.filter(function (order) {
        return order.local || ['submitted', 'ordered', 'approved', 'in_stock', 'completed'].includes(order.status);
      }).length,
      completed = scoped.filter(function (order) {
        return order.status === 'completed';
      }).length,
      dispatched = scoped.filter(function (order) {
        return order.status === 'dispatched';
      }).length,
      cancelled = scoped.filter(function (order) {
        return order.status === 'cancelled';
      }).length;
    return "<div class=\"toolbar site-orders-toolbar\"><div><h2 style=\"margin:0\">".concat(searchMode ? 'Search orders' : orderScope === 'mine' ? 'My Orders' : 'All Orders', "</h2><small>").concat(scoped.filter(function (order) {
      return !order.local;
    }).length, " order").concat(scoped.filter(function (order) {
      return !order.local;
    }).length === 1 ? '' : 's').concat(pending.length ? " \xB7 ".concat(pending.length, " waiting to sync") : '', "</small></div><div class=\"actions\">").concat(can('site.cnc.view') ? '<button type="button" class="export-button" data-production-tracker title="Download the automatically refreshing Excel workbook"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16h16V8zM14 2v6h6M8 12h8M8 16h8"/></svg>Production Tracker</button>' : '').concat(searchMode ? '<button data-orders>Back to orders</button>' : '<button data-open-order-search>Search orders</button>').concat(!searchMode ? "<button type=\"button\" data-open-attention>Needs attention (".concat(orderAttentionEntries().length, ")</button>") : '').concat(can('site.orders.create') ? "<button data-open-drafts>Drafts (".concat(draftCount(), ")</button><button class=\"primary\" data-new-empty>+ New order</button>") : '', "</div></div>").concat(message ? "<div class=\"notice ".concat(message.includes('submitted') ? 'success' : '', "\">").concat(esc(message)).concat(pending.length ? " <button data-retry>".concat(busy ? 'Syncing…' : 'Retry', "</button>") : '', "</div>") : '').concat(submissionQueueView()).concat(statusConflictView()).concat(searchMode ? orderSearchControls(all) : orderListTabs(orderScope), "<div class=\"order-filters\"><button data-order-filter=\"active\" class=\"").concat(orderFilter === 'active' ? 'active' : '', "\"><span class=\"filter-label\">Active</span><span class=\"filter-count\">").concat(active, "</span></button><button data-order-filter=\"completed\" class=\"").concat(orderFilter === 'completed' ? 'active' : '', "\"><span class=\"filter-label\">Ready for dispatch</span><span class=\"filter-count\">").concat(completed, "</span></button><button data-order-filter=\"dispatched\" class=\"").concat(orderFilter === 'dispatched' ? 'active' : '', "\"><span class=\"filter-label\">Dispatched</span><span class=\"filter-count\">").concat(dispatched, "</span></button><button data-order-filter=\"cancelled\" class=\"").concat(orderFilter === 'cancelled' ? 'active' : '', "\"><span class=\"filter-label\">Cancelled</span><span class=\"filter-count\">").concat(cancelled, "</span></button></div><p class=\"site-order-count\" role=\"status\">").concat(shown.length, " ").concat(searchMode ? 'matching ' : '', "order").concat(shown.length === 1 ? '' : 's', "</p><section class=\"card site-order-results site-request-results\">").concat(shown.map(function (order) {
      var _order$items3, _order$items4;
      return "<article class=\"order site-order-tile\"><div class=\"site-order-identity\"><div class=\"site-request-title\"><strong>#".concat(esc(order.orderNumber), " \xB7 ").concat(esc(order.project), "</strong><span class=\"status site-order-status\">").concat(esc(order.local ? order.status : orderStatusLabel(order.status)), "</span></div><small class=\"site-request-meta\">").concat(((_order$items3 = order.items) === null || _order$items3 === void 0 ? void 0 : _order$items3.length) || 0, " item").concat(((_order$items4 = order.items) === null || _order$items4 === void 0 ? void 0 : _order$items4.length) === 1 ? '' : 's', " \xB7 ").concat(esc(new Date(order.createdAt).toLocaleString('en-AU')), "</small>").concat(orderDates(order), "</div><div class=\"site-request-controls\"><div class=\"actions site-request-open\"><button data-order-details=\"").concat(esc(order.id), "\">View order</button>").concat(order.local ? '' : "<button class=\"export-button\" data-export=\"pdf\" data-order-id=\"".concat(esc(order.id), "\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" aria-hidden=\"true\"><path d=\"M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v7H6z\"/></svg>PDF</button><button class=\"export-button\" data-export=\"xlsx\" data-order-id=\"").concat(esc(order.id), "\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" aria-hidden=\"true\"><path d=\"M14 2H6a2 2 0 0 0-2 2v16h16V8zM14 2v6h6M8 12h8M8 16h8\"/></svg>Excel</button>"), "</div>").concat(can('site.orders.manage') && !order.local && !isPanelOrder(order) && !['completed', 'dispatched'].includes(order.status) ? "<div class=\"site-request-status\"><label>Update status<select data-status=\"".concat(esc(order.id), "\" aria-label=\"Order status\" ").concat(statusSaving ? 'disabled' : '', ">").concat(['submitted', 'approved', 'ordered', 'in_stock', 'completed', 'cancelled'].filter(function (status) {
        return status !== 'completed' || !isGateOrder(order);
      }).map(function (status) {
        return "<option value=\"".concat(status, "\" ").concat((statusChoices[order.id] || order.status) === status ? 'selected' : '', ">").concat(orderStatusLabel(status), "</option>");
      }).join(''), "</select></label><button class=\"primary\" data-apply-status=\"").concat(esc(order.id), "\" disabled>Apply</button></div>") : ['completed', 'dispatched'].includes(order.status) ? '<small class="site-order-lock">Status locked</small>' : '', "</div></article>");
    }).join('') || "<div class=\"empty\"><strong>".concat(searchMode ? 'No matching orders' : orderFilter === 'active' ? 'You’re all caught up' : orderFilter === 'completed' ? 'No orders ready for dispatch yet' : orderFilter === 'dispatched' ? 'No dispatched orders yet' : 'No cancelled orders', "</strong><p>").concat(searchMode ? 'Try another search or clear your filters.' : orderFilter === 'active' ? 'New requests will appear here while they are in progress.' : orderFilter === 'completed' ? 'Orders will appear here when they are ready for dispatch.' : orderFilter === 'dispatched' ? 'Orders will appear here after dispatch.' : 'Cancelled requests will appear here.', "</p>").concat(!searchMode && orderFilter === 'active' && completed ? "<button data-order-filter=\"completed\">View ready orders (".concat(completed, ")</button>") : '', "</div>"), "</section>");
  }
  function newOrder() {
    var _orderDraft4, _orderDraft5;
    var defaults = siteOrderContactDefaults();
    return "<div class=\"toolbar\"><h2 style=\"margin:0\">New site order</h2><button data-cancel>Close</button></div><p data-draft-notice role=\"status\">".concat(esc(draftNotice), "</p>").concat(discardDraftArmed ? '<div class="notice">Discard this unfinished order and its saved files? <button type="button" data-discard-draft>Yes, discard draft</button><button type="button" data-keep-draft>Keep editing</button></div>' : '').concat(message ? "<div class=\"notice\">".concat(esc(message), "</div>") : '', "<form class=\"card site-order-form ").concat(orderValidationId && orderValidationId === ((_orderDraft4 = orderDraft) === null || _orderDraft4 === void 0 ? void 0 : _orderDraft4.id) ? 'site-validation-attempted' : '', "\" data-order novalidate data-draft-id=\"").concat(esc(((_orderDraft5 = orderDraft) === null || _orderDraft5 === void 0 ? void 0 : _orderDraft5.id) || ''), "\"><p class=\"site-required-note\"><span class=\"site-required\" aria-hidden=\"true\">*</span> Required to submit. You can save an incomplete draft.</p><section class=\"site-form-section\"><h3>Order details</h3><div class=\"grid\"><label><span>Project <span class=\"site-required\" aria-hidden=\"true\">*</span></span><select name=\"projectId\" required><option value=\"\">Select a project</option>").concat(projects.map(function (project) {
      return "<option value=\"".concat(esc(project.id || project.name), "\">").concat(esc(project.name), "</option>");
    }).join(''), "</select></label><label><span>Order type <span class=\"site-required\" aria-hidden=\"true\">*</span></span><select name=\"orderType\" required><option value=\"\">Select an order type</option>").concat(_toConsumableArray(orderTypes).sort(function (a, b) {
      return a.localeCompare(b, 'en', {
        sensitivity: 'base'
      });
    }).map(function (type) {
      return "<option value=\"".concat(esc(type), "\">").concat(esc(type), "</option>");
    }).join(''), "</select></label><label class=\"wide\" data-other-type style=\"display:none\"><span>Please specify <span class=\"site-required\" aria-hidden=\"true\">*</span></span><input name=\"orderTypeOther\" pattern=\".*\\S.*\" maxlength=\"80\" placeholder=\"e.g. Safety signage\"></label></div></section><section class=\"site-form-section\"><h3>Site contact</h3><div class=\"grid\"><label><span>Site contact <span class=\"site-required\" aria-hidden=\"true\">*</span></span><input name=\"siteContact\" pattern=\".*\\S.*\" maxlength=\"100\" value=\"").concat(esc(defaults.siteContact || ''), "\" required></label><label><span>Phone <span class=\"site-required\" aria-hidden=\"true\">*</span></span><input name=\"phone\" pattern=\".*\\S.*\" type=\"tel\" inputmode=\"tel\" maxlength=\"40\" value=\"").concat(esc(defaults.phone || ''), "\" required></label></div></section><section class=\"site-form-section\"><h3>Requested delivery</h3><div class=\"site-requested-dates\"><label><span>Requested delivery date <span class=\"site-required\" aria-hidden=\"true\">*</span></span><input name=\"requestedDeliveryDate\" type=\"hidden\" value=\"\"><button class=\"date-trigger\" data-date-picker type=\"button\"><span>Choose date</span><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><rect x=\"3\" y=\"5\" width=\"18\" height=\"16\" rx=\"2\"></rect><path d=\"M16 3v4M8 3v4M3 10h18\"></path><path d=\"M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01\"></path></svg></button></label><label>Requested delivery time<input name=\"requestedDeliveryTime\" type=\"time\"></label></div></section><section class=\"site-form-section\"><h3>Notes</h3><label class=\"wide\">Location / notes<textarea name=\"locationNotes\" maxlength=\"300\" rows=\"2\"></textarea></label></section>").concat(projects.length ? '' : '<div class="notice">No projects are available yet. Ask an administrator to add one on Web.</div>', "<div class=\"items\"><h3>Items <span class=\"site-required\" aria-hidden=\"true\">*</span></h3><div class=\"site-item-labels\"><span>Qty <span class=\"site-required\" aria-hidden=\"true\">*</span></span><span>Description <span class=\"site-required\" aria-hidden=\"true\">*</span></span></div></div><button data-add type=\"button\" class=\"site-add-item\">Add item</button><section class=\"order-attachments\"><h3>Files and photos</h3><small>Up to 10 files \xB7 5 MB each \xB7 25 MB total</small><div class=\"order-upload-actions\"><label class=\"order-upload-button order-upload-primary\"><svg aria-hidden=\"true\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5\"/></svg>Choose files<input aria-label=\"Choose order files\" type=\"file\" multiple data-order-files></label><label class=\"order-upload-button\"><svg aria-hidden=\"true\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M14 4h-4l-2 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-4z\"/><circle cx=\"12\" cy=\"13\" r=\"4\"/></svg>Take photo<input aria-label=\"Take order photo\" type=\"file\" accept=\"image/*\" capture=\"environment\" data-order-files></label></div><p data-file-error role=\"alert\"></p><div data-selected-order-files></div></section><div class=\"actions site-order-submit\"><button type=\"button\" data-save-cloud-draft ").concat(busy ? 'disabled' : '', ">Save draft</button><button type=\"button\" data-discard-draft>Discard draft</button><button class=\"primary\" type=\"submit\" ").concat(projects.length ? '' : 'disabled', ">Submit request</button></div></form>");
  }
  function cncView() {
    var sorted = _toConsumableArray(cncPanels).sort(function (a, b) {
        return String(a.jobReference || '').localeCompare(String(b.jobReference || ''), 'en', {
          numeric: true
        }) || String(a.orderNumber || '').localeCompare(String(b.orderNumber || ''), 'en', {
          numeric: true
        }) || String(a.sheetNumber || '').localeCompare(String(b.sheetNumber || ''), 'en', {
          numeric: true
        }) || String(a.panelNumber || '').localeCompare(String(b.panelNumber || ''), 'en', {
          numeric: true
        });
      }),
      pending = sorted.filter(function (panel) {
        return panel.status !== 'completed';
      }).length,
      completed = sorted.length - pending,
      q = cncQuery.trim().toLowerCase(),
      filtered = sorted.filter(function (panel) {
        return (cncFilter === 'all' || (panel.status === 'completed' ? 'completed' : 'pending') === cncFilter) && (!q || [panel.orderNumber, panel.jobReference, panel.sheetNumber, panel.panelNumber].join(' ').toLowerCase().includes(q));
      }),
      jobs = new Map();
    var _iterator5 = _createForOfIteratorHelper(filtered),
      _step5;
    try {
      for (_iterator5.s(); !(_step5 = _iterator5.n()).done;) {
        var panel = _step5.value;
        var job = panel.jobReference || 'No job reference',
          order = panel.orderNumber || 'No order';
        if (!jobs.has(job)) jobs.set(job, new Map());
        if (!jobs.get(job).has(order)) jobs.get(job).set(order, []);
        jobs.get(job).get(order).push(panel);
      }
    } catch (err) {
      _iterator5.e(err);
    } finally {
      _iterator5.f();
    }
    var groups = _toConsumableArray(jobs).map(function (_ref24) {
      var _ref25 = _slicedToArray(_ref24, 2),
        job = _ref25[0],
        jobOrders = _ref25[1];
      var jobCount = _toConsumableArray(jobOrders.values()).reduce(function (count, rows) {
        return count + rows.length;
      }, 0);
      return "<details class=\"cnc-job\" data-cnc-key=\"job:".concat(esc(job), "\" ").concat(cncExpanded.has('job:' + job) || q ? 'open' : '', "><summary><strong>").concat(esc(job), "</strong><span>").concat(jobCount, " panel").concat(jobCount === 1 ? '' : 's', "</span><b>\u203A</b></summary><div>").concat(_toConsumableArray(jobOrders).map(function (_ref26) {
        var _ref27 = _slicedToArray(_ref26, 2),
          order = _ref27[0],
          rows = _ref27[1];
        var done = rows.filter(function (panel) {
            return panel.status === 'completed';
          }).length,
          key = 'order:' + job + '|' + order,
          sheets = new Set(rows.map(function (panel) {
            return String(panel.sheetNumber || '');
          })).size;
        return "<details class=\"cnc-order\" data-cnc-key=\"".concat(esc(key), "\" ").concat(cncExpanded.has(key) || q ? 'open' : '', "><summary><span class=\"cnc-order-icon\">\u25A6</span><span class=\"cnc-order-name\"><strong>Order ").concat(esc(order), "</strong><small>").concat(sheets, " sheet").concat(sheets === 1 ? '' : 's', " \xB7 ").concat(rows.length, " panel").concat(rows.length === 1 ? '' : 's', "</small></span><span class=\"cnc-progress\"><strong>").concat(done, "/").concat(rows.length, "</strong><small>complete</small></span><b>\u203A</b></summary><div class=\"cnc-panels\">").concat(rows.map(function (panel) {
          return "<article><div><span>Sheet ".concat(esc(panel.sheetNumber || '—'), " \xB7 Panel ").concat(esc(panel.panelNumber || '—'), "</span><em class=\"").concat(panel.status === 'completed' ? 'done' : '', "\">").concat(panel.status === 'completed' ? 'Completed' : 'Pending', "</em></div>").concat(panel.status === 'completed' && panel.completedAt ? "<small>Completed ".concat(esc(new Date(panel.completedAt).toLocaleString('en-AU'))).concat(panel.completedBy ? " by ".concat(esc(panel.completedBy)) : '', "</small>") : '', "</article>");
        }).join(''), "</div></details>");
      }).join(''), "</div></details>");
    }).join('');
    return "<section class=\"cnc-tracker\"><div class=\"cnc-heading\"><div><h2>CNC Tracker</h2><span>Read-only live view</span></div><button data-refresh>Refresh</button></div>".concat(message ? "<div class=\"notice\">".concat(esc(message), "</div>") : '', "<label class=\"cnc-search\"><span>\u2315</span><input data-cnc-search type=\"search\" value=\"").concat(esc(cncQuery), "\" placeholder=\"Search order, job, sheet or panel\u2026\" aria-label=\"Search CNC schedule\"></label><div class=\"cnc-pills\">").concat([['all', 'All', sorted.length], ['pending', 'Pending', pending], ['completed', 'Completed', completed]].map(function (_ref28) {
      var _ref29 = _slicedToArray(_ref28, 3),
        value = _ref29[0],
        label = _ref29[1],
        count = _ref29[2];
      return "<button data-cnc-filter=\"".concat(value, "\" class=\"").concat(cncFilter === value ? 'active' : '', "\">").concat(label, " (").concat(count, ")</button>");
    }).join(''), "</div><div class=\"cnc-tools\"><button data-cnc-expand>Expand all</button><button data-cnc-collapse>Collapse all</button></div><p class=\"cnc-updated\"><i></i>Updated ").concat(new Date().toLocaleTimeString('en-AU', {
      hour: '2-digit',
      minute: '2-digit'
    }), " \xB7 refreshes automatically</p><div class=\"cnc-groups\">").concat(groups || "<div class=\"empty\">".concat(sorted.length ? 'No matching panels.' : 'No panels scheduled yet.', "</div>"), "</div></section>");
  }
  function profileEditorOverlay() {
    if (!selectedProfilePhoto) return '';
    return "<div class=\"photo-editor-screen\"><header class=\"photo-editor-head\"><button data-cancel-photo type=\"button\">Cancel</button><h2>Adjust photo</h2><button class=\"primary\" data-save-photo type=\"button\">".concat(busy ? 'Saving…' : 'Save', "</button></header><main class=\"photo-editor-stage\"><div class=\"photo-crop-stage\" data-photo-gesture><img data-photo-preview src=\"").concat(esc(selectedProfilePhoto), "\" alt=\"Photo being adjusted\" style=\"object-position:").concat(profileAdjustment.x, "% ").concat(profileAdjustment.y, "%;transform:scale(").concat(profileAdjustment.zoom, ")\"><span class=\"photo-crop-guide\" aria-hidden=\"true\"></span></div><p class=\"photo-editor-help\">Drag to reposition \xB7 Pinch or scroll to zoom</p></main><footer class=\"photo-editor-foot\"><label class=\"profile-photo-choose\">Choose a different photo<input data-profile-photo type=\"file\" accept=\"image/*\"></label></footer></div>");
  }
  function orderTypeSettings() {
    var _session29;
    return (_session29 = session) !== null && _session29 !== void 0 && _session29.isAdmin ? "<form class=\"card\" data-order-type><h3>Order types</h3><p>".concat(orderTypes.map(esc).join(' · '), "</p><label>New order type<input name=\"name\" maxlength=\"80\" required></label><button class=\"primary\" type=\"submit\" ").concat(busy ? 'disabled' : '', ">Add order type</button></form>") : '';
  }
  function saveOrderType(_x37) {
    return _saveOrderType.apply(this, arguments);
  }
  function _saveOrderType() {
    _saveOrderType = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee56(event) {
      var _session67;
      var name, button, response, _result24, _t64;
      return _regenerator().w(function (_context59) {
        while (1) switch (_context59.p = _context59.n) {
          case 0:
            event.preventDefault();
            if (!(!((_session67 = session) !== null && _session67 !== void 0 && _session67.isAdmin) || busy)) {
              _context59.n = 1;
              break;
            }
            return _context59.a(2);
          case 1:
            name = new FormData(event.currentTarget).get('name');
            busy = true;
            button = event.currentTarget.querySelector('button');
            button.disabled = true;
            _context59.p = 2;
            _context59.n = 3;
            return api('/order-types', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                name: name
              })
            });
          case 3:
            response = _context59.v;
            _context59.n = 4;
            return response.json();
          case 4:
            _result24 = _context59.v;
            if (response.ok) {
              _context59.n = 5;
              break;
            }
            throw Error(_result24.error || 'Order type could not be added.');
          case 5:
            orderTypes = _result24.orderTypes;
            deviceStorage.setItem(PROJECTS_KEY, JSON.stringify({
              owner: session.username,
              projects: projects,
              orderTypes: orderTypes
            }));
            message = 'Order type added.';
            _context59.n = 7;
            break;
          case 6:
            _context59.p = 6;
            _t64 = _context59.v;
            message = _t64.message;
          case 7:
            _context59.p = 7;
            busy = false;
            render();
            return _context59.f(7);
          case 8:
            return _context59.a(2);
        }
      }, _callee56, null, [[2, 6, 7, 8]]);
    }));
    return _saveOrderType.apply(this, arguments);
  }
  function settingsView() {
    var _userDetailsDraft;
    var current = profile || {
        displayName: session.username,
        email: '',
        profilePhoto: ''
      },
      details = ((_userDetailsDraft = userDetailsDraft) === null || _userDetailsDraft === void 0 ? void 0 : _userDetailsDraft.owner) === session.username ? userDetailsDraft : current,
      shown = current.profilePhoto;
    return "<div class=\"toolbar\"><div><h2 style=\"margin:0\">Settings</h2><small>Account and Site app preferences</small></div></div>".concat(message ? "<div class=\"notice ".concat(message.includes('saved') ? 'success' : '', "\">").concat(esc(message), "</div>") : '', "<div class=\"card account-summary\"><div class=\"account-person\"><div class=\"account-avatar\">").concat(shown ? "<img src=\"".concat(esc(shown), "\" alt=\"\">") : "<span>".concat(esc((current.displayName || session.username || '?').slice(0, 2).toUpperCase()), "</span>"), "</div><div><strong>Signed in as</strong><span>").concat(esc(current.displayName || session.username)).concat(session.isAdmin ? ' · Admin' : '', "</span></div></div></div><form class=\"card\" data-profile><div class=\"grid\"><div class=\"wide\"><h3>User details</h3><small>These details are shared with your account and fill in new Site Orders. You can change the contact for each order.</small></div><label>Name<input name=\"displayName\" autocomplete=\"name\" maxlength=\"100\" value=\"").concat(esc(details.displayName || ''), "\" required ").concat(busy ? 'disabled' : '', "></label><label>Phone number<input name=\"phone\" type=\"tel\" inputmode=\"tel\" autocomplete=\"tel\" maxlength=\"40\" value=\"").concat(esc(details.phone || ''), "\" placeholder=\"e.g. 0400 000 000\" ").concat(busy ? 'disabled' : '', "></label><label class=\"wide\">Email<input name=\"email\" type=\"email\" maxlength=\"160\" value=\"").concat(esc(details.email || ''), "\" ").concat(busy ? 'disabled' : '', "></label><div class=\"wide profile-photo-editor\"><strong>Profile photo</strong><div class=\"profile-photo-preview\">").concat(shown ? "<img src=\"".concat(esc(shown), "\" alt=\"Your profile\">") : "<span>".concat(esc((current.displayName || session.username || '?').slice(0, 2).toUpperCase()), "</span>"), "</div><div class=\"profile-photo-actions\"><label class=\"profile-photo-choose photo-camera\"><svg aria-hidden=\"true\" width=\"20\" height=\"20\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M14 4h-4l-2 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-4z\"/><circle cx=\"12\" cy=\"13\" r=\"4\"/></svg>Take photo<input data-profile-photo type=\"file\" accept=\"image/*\" capture=\"user\" aria-label=\"Take profile photo\"></label><label class=\"profile-photo-choose photo-library\"><svg aria-hidden=\"true\" width=\"20\" height=\"20\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5\"/></svg>Choose photo<input data-profile-photo name=\"profilePhoto\" type=\"file\" accept=\"image/*\" aria-label=\"Choose profile photo\"></label></div>").concat(current.profilePhoto ? '<button data-adjust-current type="button">Adjust current photo</button>' : '', "<small>Take a new photo or choose one from your library. You can adjust it before saving.</small>").concat(current.profilePhoto ? '<button class="danger-button" data-remove-photo type="button">Remove photo</button>' : '', "</div></div><div class=\"actions settings-actions\"><button class=\"primary\" type=\"submit\" ").concat(busy ? 'disabled' : '', ">").concat(busy ? 'Saving…' : 'Save user details', "</button><button data-logout type=\"button\">Log out</button></div></form>").concat(sharingSettings()).concat(orderTypeSettings()).concat(profileEditorOverlay());
  }
  function supportView() {
    var selected = supportTickets.find(function (ticket) {
      return ticket.id === supportSelected;
    });
    if (selected) {
      var replies = (selected.messages || []).map(function (reply) {
        return "<article class=\"order\"><div><strong>".concat(esc(reply.isAdmin ? 'Support · ' + reply.author : reply.author), "</strong><p>").concat(esc(reply.body), "</p>").concat(reply.photo ? "<img src=\"".concat(esc(reply.photo), "\" alt=\"Reply attachment\" style=\"max-width:100%;max-height:240px;border-radius:10px\">") : '', "<small>").concat(esc(new Date(reply.createdAt).toLocaleString('en-AU')), "</small></div></article>");
      }).join('');
      var statusControl = session.isAdmin ? '<select data-support-status><option>Open</option><option>In Progress</option><option>Resolved</option></select>' : "<span class=\"status\">".concat(esc(selected.status), "</span>");
      return "<div class=\"toolbar\"><button data-support-back>\u2190 Tickets</button><div><h2 style=\"margin:0\">".concat(esc(selected.subject), "</h2><small>").concat(esc(selected.category), " \xB7 ").concat(esc(selected.priority), " priority</small></div></div>").concat(message ? "<div class=\"notice\">".concat(esc(message), "</div>") : '', "<section class=\"card\"><div class=\"actions\">").concat(statusControl, "</div><p>").concat(esc(selected.description), "</p>").concat(selected.photo ? "<img src=\"".concat(esc(selected.photo), "\" alt=\"Ticket attachment\" style=\"max-width:100%;max-height:320px;border-radius:12px\">") : '', "<div>").concat(replies, "</div><form data-support-reply><label>Reply<textarea name=\"message\" rows=\"4\" placeholder=\"Write a reply\u2026\"></textarea></label><label class=\"profile-photo-choose\">Add photo<input data-support-reply-photo type=\"file\" accept=\"image/*\"></label>").concat(supportReplyPhoto ? "<img src=\"".concat(esc(supportReplyPhoto), "\" alt=\"Attachment preview\" style=\"height:80px;border-radius:10px\">") : '', "<button class=\"primary\" type=\"submit\" ").concat(busy ? 'disabled' : '', ">").concat(busy ? 'Sending…' : 'Send reply', "</button></form></section>");
    }
    var rows = supportTickets.map(function (ticket) {
      return "<button data-support-ticket=\"".concat(esc(ticket.id), "\" style=\"width:100%;margin-top:8px;text-align:left\"><strong>").concat(esc(ticket.subject), "</strong><br><small>").concat(session.isAdmin ? esc(ticket.createdBy) + ' · ' : '').concat(esc(ticket.status), " \xB7 ").concat(esc(new Date(ticket.updatedAt).toLocaleDateString('en-AU')), "</small></button>");
    }).join('');
    return "<div class=\"toolbar\"><div style=\"display:flex;align-items:center;gap:12px\"><span style=\"width:48px;height:48px;display:grid;place-items:center;border-radius:12px;background:#0f172a;color:#fff\">".concat(SUPPORT_ICON, "</span><div><h2 style=\"margin:0\">Support</h2><small>").concat(session.isAdmin ? 'View and respond to user tickets' : 'Ask for help and track your requests', "</small></div></div></div>").concat(message ? "<div class=\"notice\">".concat(esc(message), "</div>") : '', "<form class=\"card\" data-support-create><label>Subject<input name=\"subject\" maxlength=\"140\" required></label><div class=\"grid\"><label>Category<select name=\"category\"><option>General</option><option>Technical issue</option><option>Account access</option><option>Feature request</option></select></label><label>Priority<select name=\"priority\"><option>Low</option><option selected>Normal</option><option>High</option><option>Urgent</option></select></label></div><label>Description<textarea name=\"description\" rows=\"5\" maxlength=\"5000\" required></textarea></label><label class=\"profile-photo-choose\">Add photo<input data-support-photo type=\"file\" accept=\"image/*\"></label>").concat(supportPhoto ? "<img src=\"".concat(esc(supportPhoto), "\" alt=\"Attachment preview\" style=\"height:80px;border-radius:10px\">") : '', "<button class=\"primary\" type=\"submit\" ").concat(busy ? 'disabled' : '', ">").concat(busy ? 'Submitting…' : 'Submit ticket', "</button></form><section class=\"card\"><h3>").concat(session.isAdmin ? 'All tickets' : 'My tickets', "</h3>").concat(rows || '<p>No support tickets yet.</p>', "</section>");
  }
  function updateItemRequirements() {
    var _orderDraft6;
    var rows = _toConsumableArray(root.querySelectorAll('.item'));
    var attempted = orderValidationId && orderValidationId === ((_orderDraft6 = orderDraft) === null || _orderDraft6 === void 0 ? void 0 : _orderDraft6.id),
      missingDescription = !rows.some(function (row) {
        return row.querySelector('[name=description]').value.trim();
      });
    rows.forEach(function (row, index) {
      var quantity = row.querySelector('[name=quantity]'),
        description = row.querySelector('[name=description]');
      // Rows without descriptions are omitted when submitting, wherever they appear.
      var hasDescription = !!description.value.trim();
      description.required = !!(attempted && missingDescription && index === 0);
      description.pattern = description.required ? '.*\\S.*' : '.*';
      quantity.required = hasDescription;
      quantity.min = hasDescription ? '1' : '';
      quantity.step = hasDescription ? '1' : 'any';
    });
    syncOrderValidation();
  }
  function syncOrderValidation() {
    var _form$classList;
    var form = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : root.querySelector('[data-order]');
    if (!(form !== null && form !== void 0 && (_form$classList = form.classList) !== null && _form$classList !== void 0 && _form$classList.contains('site-validation-attempted'))) return;
    var _iterator6 = _createForOfIteratorHelper(form.querySelectorAll('input,select,textarea')),
      _step6;
    try {
      for (_iterator6.s(); !(_step6 = _iterator6.n()).done;) {
        var input = _step6.value;
        if (input.willValidate && !input.validity.valid) input.setAttribute('aria-invalid', 'true');else input.removeAttribute('aria-invalid');
      }
    } catch (err) {
      _iterator6.e(err);
    } finally {
      _iterator6.f();
    }
    var date = form.querySelector('[name=requestedDeliveryDate]'),
      button = form.querySelector('[data-date-picker]');
    if (button) {
      if (!(date !== null && date !== void 0 && date.value)) button.setAttribute('aria-invalid', 'true');else button.removeAttribute('aria-invalid');
    }
  }
  function markOrderValidation() {
    var _orderDraft7;
    var form = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : root.querySelector('[data-order]');
    if (!(form !== null && form !== void 0 && form.classList)) return;
    orderValidationId = ((_orderDraft7 = orderDraft) === null || _orderDraft7 === void 0 ? void 0 : _orderDraft7.id) || '';
    form.classList.add('site-validation-attempted');
    updateItemRequirements();
    syncOrderValidation(form);
  }
  function focusOrderValidation(form) {
    var _form$querySelector5;
    var target = form === null || form === void 0 || (_form$querySelector5 = form.querySelector) === null || _form$querySelector5 === void 0 ? void 0 : _form$querySelector5.call(form, '[aria-invalid="true"]');
    if (!target) return false;
    target.scrollIntoView({
      block: 'center',
      behavior: 'auto'
    });
    target.focus({
      preventScroll: true
    });
    return true;
  }
  function wireOrderValidation() {
    var form = root.querySelector('[data-order]');
    if (!form) return;
    form.addEventListener('invalid', function () {
      return markOrderValidation(form);
    }, true);
    form.addEventListener('input', function () {
      return syncOrderValidation(form);
    });
    form.addEventListener('change', function () {
      return syncOrderValidation(form);
    });
    syncOrderValidation(form);
  }
  function uppercaseOrderDescription(event) {
    var _event$nativeEvent;
    if (event.isComposing || (_event$nativeEvent = event.nativeEvent) !== null && _event$nativeEvent !== void 0 && _event$nativeEvent.isComposing) return;
    var input = event.target,
      value = input.value,
      upper = value.toUpperCase();
    if (value === upper) return;
    var start = input.selectionStart,
      end = input.selectionEnd,
      direction = input.selectionDirection;
    input.value = upper;
    if (start != null && typeof input.setSelectionRange === 'function') input.setSelectionRange(value.slice(0, start).toUpperCase().length, value.slice(0, end).toUpperCase().length, direction);
  }
  function addItem() {
    var focus = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : false;
    var list = root.querySelector('.items'),
      row = document.createElement('div');
    row.className = 'item';
    row.innerHTML = '<input name="quantity" type="number" min="1" step="1" value="1" required enterkeyhint="next" aria-label="Quantity"><input name="description" maxlength="180" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="enter" placeholder="Item description" aria-label="Description"><button type="button" aria-label="Remove item">×</button>';
    row.querySelector('button').onclick = function () {
      row.remove();
      updateItemRequirements();
      captureDraft();
    };
    row.addEventListener('input', function (event) {
      if (event.target.name === 'description') uppercaseOrderDescription(event);
      updateItemRequirements();
    });
    var commitDescription = function commitDescription(event) {
      if (event.target.name === 'description') {
        uppercaseOrderDescription(event);
        captureDraft();
      }
    };
    row.addEventListener('compositionend', commitDescription);
    row.addEventListener('change', commitDescription);
    row.addEventListener('focusout', commitDescription);
    row.addEventListener('keydown', function (event) {
      var _row$nextElementSibli;
      if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229 || !event.target.matches('input')) return;
      event.preventDefault();
      if (event.repeat) return;
      var quantity = row.querySelector('[name=quantity]'),
        description = row.querySelector('[name=description]');
      if (!quantity.reportValidity()) {
        quantity.focus();
        return;
      }
      if (!description.value.trim()) {
        description.focus();
        return;
      }
      if (!description.reportValidity()) {
        description.focus();
        return;
      }
      if ((_row$nextElementSibli = row.nextElementSibling) !== null && _row$nextElementSibli !== void 0 && _row$nextElementSibli.classList.contains('item')) row.nextElementSibling.querySelector('[name=description]').focus();else addItem(true);
    });
    list.appendChild(row);
    updateItemRequirements();
    if (focus === true) {
      row.querySelector('[name=description]').focus();
      captureDraft();
    }
    return row;
  }
  function submitOrder(_x38) {
    return _submitOrder.apply(this, arguments);
  }
  function _submitOrder() {
    _submitOrder = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee57(event) {
      var form, orderType, orderTypeOther, _root$querySelector69, _root$querySelector70, _root$querySelector71, selected, items, order, owner, packet, _session68, _orderDraft0, _orderDraft1, _orderDraft10, _t65;
      return _regenerator().w(function (_context60) {
        while (1) switch (_context60.p = _context60.n) {
          case 0:
            event.preventDefault();
            if (!busy) {
              _context60.n = 1;
              break;
            }
            return _context60.a(2);
          case 1:
            markOrderValidation(event.currentTarget);
            if (!focusOrderValidation(event.currentTarget)) {
              _context60.n = 2;
              break;
            }
            return _context60.a(2);
          case 2:
            captureDraft();
            if (!selectedOrderFiles.some(function (file) {
              return file.missing;
            })) {
              _context60.n = 3;
              break;
            }
            root.querySelector('[data-file-error]').textContent = 'Remove unavailable files and attach them again before submitting.';
            return _context60.a(2);
          case 3:
            form = new FormData(event.currentTarget), orderType = String(form.get('orderType') || '').trim(), orderTypeOther = String(form.get('orderTypeOther') || '').trim();
            if (orderType) {
              _context60.n = 4;
              break;
            }
            message = 'Choose an order type before submitting.';
            render();
            (_root$querySelector69 = root.querySelector('[name=orderType]')) === null || _root$querySelector69 === void 0 || _root$querySelector69.focus();
            return _context60.a(2);
          case 4:
            if (!(orderType === 'Other' && !orderTypeOther)) {
              _context60.n = 5;
              break;
            }
            message = 'Please specify the order type for Other.';
            render();
            (_root$querySelector70 = root.querySelector('[name=orderTypeOther]')) === null || _root$querySelector70 === void 0 || _root$querySelector70.focus();
            return _context60.a(2);
          case 5:
            if (form.get('requestedDeliveryDate')) {
              _context60.n = 6;
              break;
            }
            message = 'Choose a requested delivery date before submitting.';
            render();
            (_root$querySelector71 = root.querySelector('[data-date-picker]')) === null || _root$querySelector71 === void 0 || _root$querySelector71.focus();
            return _context60.a(2);
          case 6:
            selected = projects.find(function (project) {
              return (project.id || project.name) === form.get('projectId');
            }), items = _toConsumableArray(root.querySelectorAll('.item')).map(function (row) {
              return {
                quantity: Number(row.querySelector('[name=quantity]').value),
                description: row.querySelector('[name=description]').value.trim().toUpperCase()
              };
            }).filter(function (item) {
              return item.quantity > 0 && item.description;
            });
            if (items.length) {
              _context60.n = 7;
              break;
            }
            message = 'Add at least one item.';
            render();
            return _context60.a(2);
          case 7:
            if (!(outbox.queue.length && outbox.owner !== session.username)) {
              _context60.n = 8;
              break;
            }
            message = "Saved requests on this device belong to ".concat(outbox.owner, ".");
            view = 'orders';
            render();
            return _context60.a(2);
          case 8:
            if (selected) {
              _context60.n = 9;
              break;
            }
            message = 'Choose an available project before submitting.';
            render();
            return _context60.a(2);
          case 9:
            order = {
              projectId: (selected === null || selected === void 0 ? void 0 : selected.id) || null,
              project: (selected === null || selected === void 0 ? void 0 : selected.name) || form.get('projectId'),
              orderType: orderType,
              orderTypeOther: orderType === 'Other' ? orderTypeOther : '',
              siteContact: form.get('siteContact'),
              phone: form.get('phone'),
              requestedDeliveryDate: form.get('requestedDeliveryDate'),
              requestedDeliveryTime: form.get('requestedDeliveryTime'),
              locationNotes: form.get('locationNotes'),
              items: items
            };
            owner = session.username;
            busy = true;
            _context60.p = 10;
            validateOrderFiles(selectedOrderFiles);
            _context60.n = 11;
            return attachmentDb('put', selectedOrderFiles);
          case 11:
            if (!(((_session68 = session) === null || _session68 === void 0 ? void 0 : _session68.username) !== owner)) {
              _context60.n = 12;
              break;
            }
            throw Error('Your account changed. Submit the order again.');
          case 12:
            packet = {
              localId: crypto.randomUUID(),
              idempotencyKey: ((_orderDraft0 = orderDraft) === null || _orderDraft0 === void 0 ? void 0 : _orderDraft0.id) || crypto.randomUUID(),
              cloudDraftId: (_orderDraft1 = orderDraft) !== null && _orderDraft1 !== void 0 && _orderDraft1.cloudUpdatedAt ? orderDraft.id : null,
              cloudDraftVersion: ((_orderDraft10 = orderDraft) === null || _orderDraft10 === void 0 ? void 0 : _orderDraft10.cloudUpdatedAt) || '',
              order: order,
              attachments: selectedOrderFiles.map(function (_ref44) {
                var file = _ref44.file,
                  metadata = _objectWithoutProperties(_ref44, _excluded4);
                return metadata;
              }),
              createdAt: new Date().toISOString()
            };
            outbox.owner = owner;
            outbox.queue.push(packet);
            saveOutbox();
            try {
              deviceStorage.removeItem(DRAFT_KEY + owner);
            } catch (_unused17) {}
            orderDraft = null;
            draftOwner = '';
            selectedOrderFiles = [];
            _context60.n = 14;
            break;
          case 13:
            _context60.p = 13;
            _t65 = _context60.v;
            if (packet) outbox.queue = outbox.queue.filter(function (item) {
              return item !== packet;
            });
            root.querySelector('[data-file-error]').textContent = _t65.message;
            return _context60.a(2);
          case 14:
            _context60.p = 14;
            busy = false;
            return _context60.f(14);
          case 15:
            view = 'orders';
            message = navigator.onLine ? 'Submitting request…' : 'Request saved on this device and will submit when connected.';
            render();
            void flush();
          case 16:
            return _context60.a(2);
        }
      }, _callee57, null, [[10, 13, 14, 15]]);
    }));
    return _submitOrder.apply(this, arguments);
  }
  function downloadOrder(_x39) {
    return _downloadOrder.apply(this, arguments);
  }
  function _downloadOrder() {
    _downloadOrder = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee59(button) {
      var format, id, original, preview, ticket, _yield$Promise$all, _yield$Promise$all2, previewToken, downloadToken, base, link, fileToken, _t66;
      return _regenerator().w(function (_context62) {
        while (1) switch (_context62.p = _context62.n) {
          case 0:
            format = button.dataset.export, id = button.dataset.orderId, original = button.innerHTML, preview = format === 'pdf' ? window.open('about:blank', '_blank') : null;
            button.disabled = true;
            button.textContent = 'Preparing…';
            if (preview) preview.opener = null;
            ticket = /*#__PURE__*/function () {
              var _ticket = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee58() {
                var response, result;
                return _regenerator().w(function (_context61) {
                  while (1) switch (_context61.n) {
                    case 0:
                      _context61.n = 1;
                      return api('/orders/' + id + '/pdf-link', {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json'
                        },
                        body: '{}'
                      });
                    case 1:
                      response = _context61.v;
                      _context61.n = 2;
                      return response.json();
                    case 2:
                      result = _context61.v;
                      if (!(!response.ok || !result.pdfToken)) {
                        _context61.n = 3;
                        break;
                      }
                      throw Error(result.error || 'Order file could not be generated');
                    case 3:
                      return _context61.a(2, result.pdfToken);
                  }
                }, _callee58);
              }));
              function ticket() {
                return _ticket.apply(this, arguments);
              }
              return ticket;
            }();
            _context62.p = 1;
            if (!(format === 'pdf')) {
              _context62.n = 3;
              break;
            }
            _context62.n = 2;
            return Promise.all([ticket(), ticket()]);
          case 2:
            _yield$Promise$all = _context62.v;
            _yield$Promise$all2 = _slicedToArray(_yield$Promise$all, 2);
            previewToken = _yield$Promise$all2[0];
            downloadToken = _yield$Promise$all2[1];
            base = API + '/orders/' + id + '/pdf';
            if (preview) preview.location.replace(base + '?ticket=' + encodeURIComponent(previewToken));
            link = document.createElement('a');
            link.href = base + '?download=1&ticket=' + encodeURIComponent(downloadToken);
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            link.remove();
            if (!preview) message = 'The PDF download started, but your browser blocked the preview tab.';
            _context62.n = 5;
            break;
          case 3:
            _context62.n = 4;
            return ticket();
          case 4:
            fileToken = _context62.v;
            window.location.assign(API + '/orders/' + id + '/' + format + '?ticket=' + encodeURIComponent(fileToken));
          case 5:
            _context62.n = 7;
            break;
          case 6:
            _context62.p = 6;
            _t66 = _context62.v;
            if (preview && !preview.closed) preview.close();
            message = _t66.message;
            render();
          case 7:
            _context62.p = 7;
            if (button.isConnected) {
              button.disabled = false;
              button.innerHTML = original;
            }
            return _context62.f(7);
          case 8:
            return _context62.a(2);
        }
      }, _callee59, null, [[1, 6, 7, 8]]);
    }));
    return _downloadOrder.apply(this, arguments);
  }
  var readPhoto = function readPhoto(file) {
    return new Promise(function (resolve, reject) {
      if (!file.type.startsWith('image/')) {
        reject(Error('Choose an image from your photo library.'));
        return;
      }
      var reader = new FileReader();
      reader.onerror = function () {
        return reject(Error('Photo could not be read.'));
      };
      reader.onload = function () {
        var source = String(reader.result || '');
        if (file.size <= 1000000) {
          resolve(source);
          return;
        }
        var image = new Image();
        image.onerror = function () {
          return reject(Error('This photo format could not be opened. Try JPEG, PNG or WebP.'));
        };
        image.onload = function () {
          var limit = 1024;
          while (limit >= 400) {
            var scale = Math.min(1, limit / Math.max(image.naturalWidth, image.naturalHeight)),
              canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
            canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
            canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
            for (var quality = .88; quality >= .48; quality -= .1) {
              var result = canvas.toDataURL('image/jpeg', quality);
              if (result.length <= 1450000) {
                resolve(result);
                return;
              }
            }
            limit = Math.floor(limit * .75);
          }
          reject(Error('This photo could not be reduced enough. Please choose another photo.'));
        };
        image.src = source;
      };
      reader.readAsDataURL(file);
    });
  };
  var cropProfilePhoto = function cropProfilePhoto(source, _ref30) {
    var zoom = _ref30.zoom,
      x = _ref30.x,
      y = _ref30.y;
    return new Promise(function (resolve, reject) {
      var image = new Image();
      image.onerror = function () {
        return reject(Error('Profile photo could not be adjusted.'));
      };
      image.onload = function () {
        var size = 512,
          scale = Math.max(size / image.naturalWidth, size / image.naturalHeight) * zoom,
          sourceWidth = size / scale,
          sourceHeight = size / scale,
          maxX = Math.max(0, image.naturalWidth - sourceWidth),
          maxY = Math.max(0, image.naturalHeight - sourceHeight),
          canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        canvas.getContext('2d').drawImage(image, maxX * x / 100, maxY * y / 100, sourceWidth, sourceHeight, 0, 0, size, size);
        for (var quality = .9; quality >= .5; quality -= .1) {
          var result = canvas.toDataURL('image/jpeg', quality);
          if (result.length <= 1450000) {
            resolve(result);
            return;
          }
        }
        reject(Error('Profile photo could not be reduced enough.'));
      };
      image.src = source;
    });
  };
  function saveProfile(_x40) {
    return _saveProfile.apply(this, arguments);
  }
  function _saveProfile() {
    _saveProfile = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee60(event) {
      var owner, version, current, form, payload, existingDraft, response, _result25, _t67;
      return _regenerator().w(function (_context63) {
        while (1) switch (_context63.p = _context63.n) {
          case 0:
            event.preventDefault();
            if (!(busy || !session)) {
              _context63.n = 1;
              break;
            }
            return _context63.a(2);
          case 1:
            owner = session.username, version = sessionVersion, current = function current() {
              var _session69;
              return ((_session69 = session) === null || _session69 === void 0 ? void 0 : _session69.username) === owner && sessionVersion === version;
            }, form = new FormData(event.currentTarget), payload = {
              displayName: form.get('displayName'),
              email: form.get('email'),
              phone: form.get('phone') || ''
            };
            existingDraft = orderDraft && draftOwner === owner ? orderDraft : savedDraft();
            if (existingDraft && !existingDraft.contactDefaults) {
              existingDraft.contactDefaults = siteOrderContactDefaults();
              if (existingDraft === orderDraft) writeDraft();else try {
                deviceStorage.setItem(DRAFT_KEY + owner, JSON.stringify(existingDraft));
              } catch (_unused18) {}
            }
            userDetailsDraft = _objectSpread({
              owner: owner
            }, payload);
            busy = true;
            message = '';
            render();
            _context63.p = 2;
            if (!selectedProfilePhoto) {
              _context63.n = 4;
              break;
            }
            _context63.n = 3;
            return cropProfilePhoto(selectedProfilePhoto, profileAdjustment);
          case 3:
            payload.profilePhoto = _context63.v;
          case 4:
            if (current()) {
              _context63.n = 5;
              break;
            }
            return _context63.a(2);
          case 5:
            _context63.n = 6;
            return api('/profile', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(payload)
            });
          case 6:
            response = _context63.v;
            _context63.n = 7;
            return response.json();
          case 7:
            _result25 = _context63.v;
            if (current()) {
              _context63.n = 8;
              break;
            }
            return _context63.a(2);
          case 8:
            if (response.ok) {
              _context63.n = 9;
              break;
            }
            throw Error(_result25.error || 'User details could not be saved.');
          case 9:
            profile = _result25.profile;
            userDetailsDraft = null;
            selectedProfilePhoto = null;
            profileAdjustment = {
              zoom: 1,
              x: 50,
              y: 50
            };
            message = 'User details saved.';
            _context63.n = 11;
            break;
          case 10:
            _context63.p = 10;
            _t67 = _context63.v;
            if (current()) message = _t67.message || 'Could not reach the server.';
          case 11:
            _context63.p = 11;
            if (current()) {
              busy = false;
              render();
            }
            return _context63.f(11);
          case 12:
            return _context63.a(2);
        }
      }, _callee60, null, [[2, 10, 11, 12]]);
    }));
    return _saveProfile.apply(this, arguments);
  }
  function wireProfilePhoto() {
    root.addEventListener('change', /*#__PURE__*/function () {
      var _ref31 = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee4(event) {
        var _event$target$files;
        var file, _t7;
        return _regenerator().w(function (_context4) {
          while (1) switch (_context4.p = _context4.n) {
            case 0:
              if (event.target.matches('[data-profile-photo]')) {
                _context4.n = 1;
                break;
              }
              return _context4.a(2);
            case 1:
              file = (_event$target$files = event.target.files) === null || _event$target$files === void 0 ? void 0 : _event$target$files[0];
              if (file) {
                _context4.n = 2;
                break;
              }
              return _context4.a(2);
            case 2:
              message = 'Preparing photo…';
              _context4.p = 3;
              _context4.n = 4;
              return readPhoto(file);
            case 4:
              selectedProfilePhoto = _context4.v;
              profileAdjustment = {
                zoom: 1,
                x: 50,
                y: 50
              };
              message = '';
              _context4.n = 6;
              break;
            case 5:
              _context4.p = 5;
              _t7 = _context4.v;
              message = _t7.message || 'Profile photo could not be prepared.';
            case 6:
              render();
            case 7:
              return _context4.a(2);
          }
        }, _callee4, null, [[3, 5]]);
      }));
      return function (_x41) {
        return _ref31.apply(this, arguments);
      };
    }());
    root.addEventListener('input', function (event) {
      if (!event.target.matches('[data-photo-adjust]')) return;
      profileAdjustment[event.target.dataset.photoAdjust] = Number(event.target.value);
      var image = root.querySelector('[data-photo-preview]');
      if (image) {
        image.style.objectPosition = "".concat(profileAdjustment.x, "% ").concat(profileAdjustment.y, "%");
        image.style.transform = "scale(".concat(profileAdjustment.zoom, ")");
      }
    });
    root.addEventListener('click', function (event) {
      if (!event.target.closest('[data-cancel-photo]')) return;
      selectedProfilePhoto = null;
      profileAdjustment = {
        zoom: 1,
        x: 50,
        y: 50
      };
      message = '';
      render();
    });
  }
  wireProfilePhoto();
  root.addEventListener('click', function (event) {
    var _profile5, _root$querySelector22;
    if (event.target.closest('[data-adjust-current]') && (_profile5 = profile) !== null && _profile5 !== void 0 && _profile5.profilePhoto) {
      selectedProfilePhoto = profile.profilePhoto;
      profileAdjustment = {
        zoom: 1,
        x: 50,
        y: 50
      };
      message = '';
      render();
      return;
    }
    if (event.target.closest('[data-save-photo]')) (_root$querySelector22 = root.querySelector('[data-profile]')) === null || _root$querySelector22 === void 0 || _root$querySelector22.requestSubmit();
  });
  var clampPhoto = function clampPhoto(value, min, max) {
      return Math.min(max, Math.max(min, value));
    },
    zoomPhoto = function zoomPhoto(delta) {
      profileAdjustment.zoom = clampPhoto(profileAdjustment.zoom + delta, 1, 2.5);
      render();
    };
  root.addEventListener('pointerdown', function (event) {
    var target = event.target.closest('[data-photo-gesture]');
    if (!target || !selectedProfilePhoto) return;
    target.setPointerCapture(event.pointerId);
    profileGesture.pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY
    });
    profileAdjustment.zoom = Math.max(1.1, profileAdjustment.zoom);
    var image = target.querySelector('[data-photo-preview]');
    if (image) image.style.transform = "scale(".concat(profileAdjustment.zoom, ")");
  });
  root.addEventListener('pointermove', function (event) {
    var target = event.target.closest('[data-photo-gesture]');
    if (!target || !selectedProfilePhoto || !profileGesture.pointers.has(event.pointerId)) return;
    var previous = profileGesture.pointers.get(event.pointerId);
    profileGesture.pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY
    });
    if (profileGesture.pointers.size === 1) {
      var box = target.getBoundingClientRect();
      profileAdjustment.x = clampPhoto(profileAdjustment.x - (event.clientX - previous.x) / box.width * 100, 0, 100);
      profileAdjustment.y = clampPhoto(profileAdjustment.y - (event.clientY - previous.y) / box.height * 100, 0, 100);
    } else {
      var _ref32 = _toConsumableArray(profileGesture.pointers.values()),
        a = _ref32[0],
        b = _ref32[1],
        distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (profileGesture.distance) profileAdjustment.zoom = clampPhoto(profileAdjustment.zoom + (distance - profileGesture.distance) / 120, 1, 2.5);
      profileGesture.distance = distance;
    }
    var image = target.querySelector('[data-photo-preview]');
    if (image) {
      image.style.objectPosition = "".concat(profileAdjustment.x, "% ").concat(profileAdjustment.y, "%");
      image.style.transformOrigin = "".concat(profileAdjustment.x, "% ").concat(profileAdjustment.y, "%");
      image.style.transform = "scale(".concat(profileAdjustment.zoom, ")");
    }
  });
  var endPhotoGesture = function endPhotoGesture(event) {
    profileGesture.pointers.delete(event.pointerId);
    profileGesture.distance = 0;
  };
  root.addEventListener('pointerup', endPhotoGesture);
  root.addEventListener('pointercancel', endPhotoGesture);
  root.addEventListener('wheel', function (event) {
    if (!event.target.closest('[data-photo-gesture]') || !selectedProfilePhoto) return;
    event.preventDefault();
    zoomPhoto(event.deltaY < 0 ? .1 : -.1);
  }, {
    passive: false
  });
  function removeProfilePhoto() {
    return _removeProfilePhoto.apply(this, arguments);
  }
  function _removeProfilePhoto() {
    _removeProfilePhoto = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee61() {
      var _profile6;
      var response, _result26, _t68;
      return _regenerator().w(function (_context64) {
        while (1) switch (_context64.p = _context64.n) {
          case 0:
            if ((_profile6 = profile) !== null && _profile6 !== void 0 && _profile6.profilePhoto) {
              _context64.n = 1;
              break;
            }
            return _context64.a(2);
          case 1:
            busy = true;
            message = '';
            _context64.p = 2;
            _context64.n = 3;
            return api('/profile', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                displayName: profile.displayName || session.username,
                email: profile.email || '',
                profilePhoto: ''
              })
            });
          case 3:
            response = _context64.v;
            _context64.n = 4;
            return response.json();
          case 4:
            _result26 = _context64.v;
            if (response.ok) {
              _context64.n = 5;
              break;
            }
            throw Error(_result26.error || 'Profile photo could not be removed.');
          case 5:
            profile = _result26.profile;
            message = 'Profile photo removed.';
            _context64.n = 7;
            break;
          case 6:
            _context64.p = 6;
            _t68 = _context64.v;
            message = _t68.message || 'Could not reach the server.';
          case 7:
            _context64.p = 7;
            busy = false;
            render();
            return _context64.f(7);
          case 8:
            return _context64.a(2);
        }
      }, _callee61, null, [[2, 6, 7, 8]]);
    }));
    return _removeProfilePhoto.apply(this, arguments);
  }
  function submitSupport(_x42) {
    return _submitSupport.apply(this, arguments);
  }
  function _submitSupport() {
    _submitSupport = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee62(event) {
      var form, response, _result27, _t69;
      return _regenerator().w(function (_context65) {
        while (1) switch (_context65.p = _context65.n) {
          case 0:
            event.preventDefault();
            busy = true;
            message = '';
            form = new FormData(event.currentTarget);
            _context65.p = 1;
            _context65.n = 2;
            return api('/support', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                subject: form.get('subject'),
                category: form.get('category'),
                priority: form.get('priority'),
                description: form.get('description'),
                photo: supportPhoto
              })
            });
          case 2:
            response = _context65.v;
            _context65.n = 3;
            return response.json();
          case 3:
            _result27 = _context65.v;
            if (response.ok) {
              _context65.n = 4;
              break;
            }
            throw Error(_result27.error || 'Ticket could not be submitted.');
          case 4:
            supportTickets = _result27.tickets || [];
            supportSelected = _result27.ticket.id;
            supportPhoto = '';
            message = 'Support ticket submitted.';
            _context65.n = 6;
            break;
          case 5:
            _context65.p = 5;
            _t69 = _context65.v;
            message = _t69.message || 'Ticket could not be submitted.';
          case 6:
            _context65.p = 6;
            busy = false;
            render();
            return _context65.f(6);
          case 7:
            return _context65.a(2);
        }
      }, _callee62, null, [[1, 5, 6, 7]]);
    }));
    return _submitSupport.apply(this, arguments);
  }
  function replySupport(_x43) {
    return _replySupport.apply(this, arguments);
  }
  function _replySupport() {
    _replySupport = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee63(event) {
      var form, response, _result28, _t70;
      return _regenerator().w(function (_context66) {
        while (1) switch (_context66.p = _context66.n) {
          case 0:
            event.preventDefault();
            busy = true;
            message = '';
            form = new FormData(event.currentTarget);
            _context66.p = 1;
            _context66.n = 2;
            return api("/support/".concat(supportSelected, "/reply"), {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                message: form.get('message'),
                photo: supportReplyPhoto
              })
            });
          case 2:
            response = _context66.v;
            _context66.n = 3;
            return response.json();
          case 3:
            _result28 = _context66.v;
            if (response.ok) {
              _context66.n = 4;
              break;
            }
            throw Error(_result28.error || 'Reply could not be sent.');
          case 4:
            supportTickets = _result28.tickets || [];
            supportReplyPhoto = '';
            message = 'Reply sent.';
            _context66.n = 6;
            break;
          case 5:
            _context66.p = 5;
            _t70 = _context66.v;
            message = _t70.message || 'Reply could not be sent.';
          case 6:
            _context66.p = 6;
            busy = false;
            render();
            return _context66.f(6);
          case 7:
            return _context66.a(2);
        }
      }, _callee63, null, [[1, 5, 6, 7]]);
    }));
    return _replySupport.apply(this, arguments);
  }
  function updateSupportStatus(_x44) {
    return _updateSupportStatus.apply(this, arguments);
  }
  function _updateSupportStatus() {
    _updateSupportStatus = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee64(status) {
      var response, _result29, _t71;
      return _regenerator().w(function (_context67) {
        while (1) switch (_context67.p = _context67.n) {
          case 0:
            busy = true;
            message = '';
            _context67.p = 1;
            _context67.n = 2;
            return api("/support/".concat(supportSelected, "/status"), {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                status: status
              })
            });
          case 2:
            response = _context67.v;
            _context67.n = 3;
            return response.json();
          case 3:
            _result29 = _context67.v;
            if (response.ok) {
              _context67.n = 4;
              break;
            }
            throw Error(_result29.error || 'Status could not be updated.');
          case 4:
            supportTickets = _result29.tickets || [];
            _context67.n = 6;
            break;
          case 5:
            _context67.p = 5;
            _t71 = _context67.v;
            message = _t71.message || 'Status could not be updated.';
          case 6:
            _context67.p = 6;
            busy = false;
            render();
            return _context67.f(6);
          case 7:
            return _context67.a(2);
        }
      }, _callee64, null, [[1, 5, 6, 7]]);
    }));
    return _updateSupportStatus.apply(this, arguments);
  }
  function logout() {
    return _logout.apply(this, arguments);
  }
  function _logout() {
    _logout = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee65() {
      var _session70;
      var token, response, _t72;
      return _regenerator().w(function (_context68) {
        while (1) switch (_context68.p = _context68.n) {
          case 0:
            token = (_session70 = session) === null || _session70 === void 0 ? void 0 : _session70.token;
            clearAccountState();
            busy = true;
            message = 'Signing out…';
            render();
            _context68.p = 1;
            if (!token) {
              _context68.n = 3;
              break;
            }
            _context68.n = 2;
            return fetch(API + '/logout', {
              method: 'POST',
              headers: {
                'Authorization': 'Bearer ' + token,
                'Content-Type': 'application/json'
              },
              body: '{}',
              cache: 'no-store',
              signal: AbortSignal.timeout(5000)
            });
          case 2:
            response = _context68.v;
            if (!(!response.ok && response.status !== 401)) {
              _context68.n = 3;
              break;
            }
            throw Error('Server sign-out was not confirmed');
          case 3:
            message = 'Signed out.';
            _context68.n = 5;
            break;
          case 4:
            _context68.p = 4;
            _t72 = _context68.v;
            message = 'Signed out on this device. Server sign-out could not be confirmed; the session may remain valid until it expires.';
          case 5:
            _context68.p = 5;
            busy = false;
            render();
            return _context68.f(5);
          case 6:
            return _context68.a(2);
        }
      }, _callee65, null, [[1, 4, 5, 6]]);
    }));
    return _logout.apply(this, arguments);
  }
  root.addEventListener('click', function (event) {
    var button = event.target.closest('[data-remove-order-file]');
    if (button) {
      if (busy) return;
      var removed = selectedOrderFiles.filter(function (file) {
        return file.id === button.dataset.removeOrderFile;
      });
      selectedOrderFiles = selectedOrderFiles.filter(function (file) {
        return file.id !== button.dataset.removeOrderFile;
      });
      captureDraft();
      renderSelectedOrderFiles();
      if (!draftNotice.startsWith('Draft could not')) void attachmentDb('delete', removed).catch(function () {});
    }
  });
  function wireOtherOrderType() {
    var select = root.querySelector('[name=orderType]'),
      field = root.querySelector('[data-other-type]');
    if (!select || !field) return;
    var sync = function sync() {
      var visible = select.value === 'Other';
      field.style.display = visible ? '' : 'none';
      var input = field.querySelector('input');
      input.disabled = !visible;
      input.required = visible;
    };
    select.addEventListener('change', sync);
    sync();
  }
  function wire() {
    var _root$querySelector23, _root$querySelector24, _root$querySelector25, _root$querySelector26, _root$querySelector27, _root$querySelector28, _root$querySelector29, _root$querySelector30, _root$querySelector31, _root$querySelector32, _root$querySelector33, _root$querySelector34, _root$querySelector35, _root$querySelector37, _root$querySelector38, _root$querySelector39, _root$querySelector40, _root$querySelector41, _root$querySelector42, _root$querySelector43, _root$querySelector44, _root$querySelector45, _root$querySelector46, _root$querySelector47, _root$querySelector48, _root$querySelector49, _root$querySelector50, _root$querySelector51, _root$querySelector52, _root$querySelector53, _root$querySelector54;
    wireOrderTypeCorrection();
    wireOrderDelivery();
    wireGateProgress();
    wirePanelDrawing();
    root.querySelectorAll('[data-production-tracker]').forEach(function (button) {
      return button.onclick = function () {
        return downloadProductionTracker(button);
      };
    });
    (_root$querySelector23 = root.querySelector('[data-open-attention]')) === null || _root$querySelector23 === void 0 || _root$querySelector23.addEventListener('click', function () {
      view = 'order-attention';
      attentionFilter = 'all';
      message = '';
      render();
    });
    (_root$querySelector24 = root.querySelector('[data-attention-back]')) === null || _root$querySelector24 === void 0 || _root$querySelector24.addEventListener('click', function () {
      view = 'orders';
      message = '';
      render();
    });
    (_root$querySelector25 = root.querySelector('[data-refresh-attention]')) === null || _root$querySelector25 === void 0 || _root$querySelector25.addEventListener('click', function () {
      void refreshAttention();
    });
    root.querySelectorAll('[data-attention-filter]').forEach(function (button) {
      return button.onclick = function () {
        attentionFilter = button.dataset.attentionFilter;
        render();
      };
    });
    root.querySelectorAll('[data-attention-sync]').forEach(function (button) {
      return button.onclick = function () {
        void flush();
      };
    });
    (_root$querySelector26 = root.querySelector('[data-retry-notification-order]')) === null || _root$querySelector26 === void 0 || _root$querySelector26.addEventListener('click', function () {
      void loadNotificationOrder(selectedOrderId);
    });
    (_root$querySelector27 = root.querySelector('[data-refresh-production]')) === null || _root$querySelector27 === void 0 || _root$querySelector27.addEventListener('click', function () {
      void loadProductionProgress(selectedOrderId);
    });
    root.querySelectorAll('[data-delete-device-draft]').forEach(function (button) {
      return button.onclick = function () {
        return deleteDeviceDraft(button.dataset.deleteDeviceDraft);
      };
    });
    (_root$querySelector28 = root.querySelector('[data-keep-device-draft]')) === null || _root$querySelector28 === void 0 || _root$querySelector28.addEventListener('click', function () {
      deviceDiscardId = '';
      render();
    });
    (_root$querySelector29 = root.querySelector('[data-new-empty]')) === null || _root$querySelector29 === void 0 || _root$querySelector29.addEventListener('click', startNewSiteDraft);
    (_root$querySelector30 = root.querySelector('[data-copy-order]')) === null || _root$querySelector30 === void 0 || _root$querySelector30.addEventListener('click', function (event) {
      void copyOrderToDraft(event.currentTarget.dataset.copyOrder);
    });
    (_root$querySelector31 = root.querySelector('[data-open-drafts]')) === null || _root$querySelector31 === void 0 || _root$querySelector31.addEventListener('click', function () {
      view = 'drafts';
      message = '';
      render();
      void loadCloudDrafts().then(render);
    });
    (_root$querySelector32 = root.querySelector('[data-refresh-drafts]')) === null || _root$querySelector32 === void 0 || _root$querySelector32.addEventListener('click', function () {
      void loadCloudDrafts().then(render);
    });
    root.querySelectorAll('[data-cloud-draft]').forEach(function (button) {
      return button.onclick = function () {
        return openCloudDraft(button.dataset.cloudDraft);
      };
    });
    root.querySelectorAll('[data-delete-cloud-draft]').forEach(function (button) {
      return button.onclick = function () {
        return deleteCloudDraft(button.dataset.deleteCloudDraft);
      };
    });
    (_root$querySelector33 = root.querySelector('[data-keep-cloud-draft]')) === null || _root$querySelector33 === void 0 || _root$querySelector33.addEventListener('click', function () {
      cloudDiscardId = '';
      render();
    });
    (_root$querySelector34 = root.querySelector('[data-save-cloud-draft]')) === null || _root$querySelector34 === void 0 || _root$querySelector34.addEventListener('click', saveCloudDraft);
    (_root$querySelector35 = root.querySelector('[data-open-order-search]')) === null || _root$querySelector35 === void 0 || _root$querySelector35.addEventListener('click', function () {
      var _root$querySelector36;
      view = 'order-search';
      message = '';
      render();
      (_root$querySelector36 = root.querySelector('[data-order-search]')) === null || _root$querySelector36 === void 0 || _root$querySelector36.focus();
    });
    (_root$querySelector37 = root.querySelector('[data-order-results]')) === null || _root$querySelector37 === void 0 || _root$querySelector37.addEventListener('click', function () {
      view = orderReturnView;
      message = '';
      render();
    });
    wireReceipts();
    wireOrderComments();
    (_root$querySelector38 = root.querySelector('[data-retry-status]')) === null || _root$querySelector38 === void 0 || _root$querySelector38.addEventListener('click', function () {
      if (statusConflict) void changeOrderStatus(statusConflict.order, statusConflict.status);
    });
    (_root$querySelector39 = root.querySelector('[data-cancel-status]')) === null || _root$querySelector39 === void 0 || _root$querySelector39.addEventListener('click', function () {
      if (statusConflict) delete statusChoices[statusConflict.order.id];
      statusConflict = null;
      void refresh().then(render);
    });
    wireOrderAlerts();
    wireSubmissionRecovery();
    (_root$querySelector40 = root.querySelector('[data-history-retry]')) === null || _root$querySelector40 === void 0 || _root$querySelector40.addEventListener('click', function () {
      return loadOrderHistory(selectedOrderId);
    });
    root.querySelectorAll('[data-order-files]').forEach(function (input) {
      return input.onchange = chooseOrderFiles;
    });
    root.querySelectorAll('[data-attach-order]').forEach(function (input) {
      return input.onchange = queueExistingOrderFiles;
    });
    root.querySelectorAll('[data-order-file]').forEach(function (button) {
      return button.onclick = function () {
        return downloadOrderFile(button);
      };
    });
    renderSelectedOrderFiles();
    (_root$querySelector41 = root.querySelector('[data-order-type]')) === null || _root$querySelector41 === void 0 || _root$querySelector41.addEventListener('submit', saveOrderType);
    (_root$querySelector42 = root.querySelector('[data-logout]')) === null || _root$querySelector42 === void 0 || _root$querySelector42.addEventListener('click', logout);
    (_root$querySelector43 = root.querySelector('[data-remove-photo]')) === null || _root$querySelector43 === void 0 || _root$querySelector43.addEventListener('click', removeProfilePhoto);
    root.querySelectorAll('[data-orders]').forEach(function (button) {
      return button.addEventListener('click', function () {
        view = 'orders';
        message = '';
        render();
      });
    });
    (_root$querySelector44 = root.querySelector('[data-cnc]')) === null || _root$querySelector44 === void 0 || _root$querySelector44.addEventListener('click', function () {
      view = 'cnc';
      message = '';
      render();
    });
    (_root$querySelector45 = root.querySelector('[data-support]')) === null || _root$querySelector45 === void 0 || _root$querySelector45.addEventListener('click', function () {
      view = 'support';
      supportSelected = '';
      message = '';
      render();
    });
    (_root$querySelector46 = root.querySelector('[data-settings]')) === null || _root$querySelector46 === void 0 || _root$querySelector46.addEventListener('click', function () {
      view = 'settings';
      message = '';
      render();
    });
    (_root$querySelector47 = root.querySelector('[data-refresh]')) === null || _root$querySelector47 === void 0 || _root$querySelector47.addEventListener('click', function () {
      message = '';
      void refresh().then(render);
    });
    (_root$querySelector48 = root.querySelector('[data-open-shared]')) === null || _root$querySelector48 === void 0 || _root$querySelector48.addEventListener('click', function () {
      void resumeSharedDraft();
    });
    (_root$querySelector49 = root.querySelector('[data-dismiss-shared]')) === null || _root$querySelector49 === void 0 || _root$querySelector49.addEventListener('click', function () {
      history.replaceState(null, '', location.pathname + location.search);
      render();
    });
    (_root$querySelector50 = root.querySelector('[data-load-sharing]')) === null || _root$querySelector50 === void 0 || _root$querySelector50.addEventListener('click', loadSharingKeys);
    root.querySelectorAll('[data-sharing-key]').forEach(function (form) {
      return form.addEventListener('submit', updateSharingKey);
    });
    (_root$querySelector51 = root.querySelector('[data-sharing-secret]')) === null || _root$querySelector51 === void 0 || _root$querySelector51.addEventListener('click', function (event) {
      return event.currentTarget.select();
    });
    (_root$querySelector52 = root.querySelector('[data-profile]')) === null || _root$querySelector52 === void 0 || _root$querySelector52.addEventListener('submit', saveProfile);
    var detailsForm = root.querySelector('[data-profile]');
    if (detailsForm) {
      var owner = session.username,
        version = sessionVersion;
      detailsForm.addEventListener('input', function () {
        var _session30;
        if (busy || ((_session30 = session) === null || _session30 === void 0 ? void 0 : _session30.username) !== owner || sessionVersion !== version) return;
        var fields = new FormData(detailsForm);
        userDetailsDraft = {
          owner: owner,
          displayName: fields.get('displayName') || '',
          email: fields.get('email') || '',
          phone: fields.get('phone') || ''
        };
      });
    }
    root.querySelectorAll('[data-new]').forEach(function (button) {
      return button.addEventListener('click', openDraft);
    });
    (_root$querySelector53 = root.querySelector('[data-cancel]')) === null || _root$querySelector53 === void 0 || _root$querySelector53.addEventListener('click', function () {
      view = 'orders';
      message = '';
      render();
    });
    (_root$querySelector54 = root.querySelector('[data-retry]')) === null || _root$querySelector54 === void 0 || _root$querySelector54.addEventListener('click', function () {
      return flush();
    });
    root.querySelectorAll('[data-export]').forEach(function (button) {
      return button.onclick = function () {
        return downloadOrder(button);
      };
    });
    root.querySelectorAll('[data-date-picker]').forEach(function (button) {
      return button.onclick = function () {
        return openDatePicker(root.querySelector('[name=requestedDeliveryDate]'), button, function () {
          return syncOrderValidation();
        });
      };
    });
    root.querySelectorAll('[data-status]').forEach(function (select) {
      var order = orders.find(function (order) {
          return order.id === select.dataset.status;
        }),
        button = _toConsumableArray(root.querySelectorAll('[data-apply-status]')).find(function (button) {
          return button.dataset.applyStatus === select.dataset.status;
        });
      if (button) button.disabled = statusSaving || select.value === (order === null || order === void 0 ? void 0 : order.status);
      select.onchange = function () {
        statusChoices[select.dataset.status] = select.value;
        if (button) button.disabled = statusSaving || select.value === (order === null || order === void 0 ? void 0 : order.status);
      };
      if (button) button.onclick = function () {
        if (order) void changeOrderStatus(order, select.value);
      };
    });
    root.querySelectorAll('[data-order-details]').forEach(function (button) {
      return button.onclick = function () {
        orderReturnView = view === 'order-attention' ? 'order-attention' : view === 'order-search' ? 'order-search' : 'orders';
        selectedOrderId = button.dataset.orderDetails;
        view = 'order';
        message = '';
        historyState = {};
        render();
        productionState = {};
        if (!pendingOrders().some(function (order) {
          return order.id === selectedOrderId;
        })) {
          void loadOrderHistory(selectedOrderId);
          void loadProductionProgress(selectedOrderId);
        }
      };
    });
    if (view === 'new') {
      var _root$querySelector55;
      root.querySelector('[data-add]').onclick = function () {
        return addItem(true);
      };
      root.querySelector('[data-order]').onsubmit = submitOrder;
      root.querySelectorAll('[data-discard-draft]').forEach(function (button) {
        return button.onclick = discardDraft;
      });
      (_root$querySelector55 = root.querySelector('[data-keep-draft]')) === null || _root$querySelector55 === void 0 || _root$querySelector55.addEventListener('click', function () {
        discardDraftArmed = false;
        render();
      });
      restoreDraftForm();
      wireOtherOrderType();
      wireOrderValidation();
    }
  }
  function wireCnc() {
    var _root$querySelector56, _root$querySelector57;
    var search = root.querySelector('[data-cnc-search]');
    search === null || search === void 0 || search.addEventListener('input', function (event) {
      cncQuery = event.target.value;
      render();
      var next = root.querySelector('[data-cnc-search]');
      next.focus();
      next.setSelectionRange(cncQuery.length, cncQuery.length);
    });
    root.querySelectorAll('[data-cnc-filter]').forEach(function (button) {
      return button.onclick = function () {
        cncFilter = button.dataset.cncFilter;
        render();
      };
    });
    root.querySelectorAll('[data-cnc-key]').forEach(function (details) {
      return details.ontoggle = function () {
        if (details.open) cncExpanded.add(details.dataset.cncKey);else cncExpanded.delete(details.dataset.cncKey);
      };
    });
    (_root$querySelector56 = root.querySelector('[data-cnc-expand]')) === null || _root$querySelector56 === void 0 || _root$querySelector56.addEventListener('click', function () {
      root.querySelectorAll('[data-cnc-key]').forEach(function (details) {
        details.open = true;
        cncExpanded.add(details.dataset.cncKey);
      });
    });
    (_root$querySelector57 = root.querySelector('[data-cnc-collapse]')) === null || _root$querySelector57 === void 0 || _root$querySelector57.addEventListener('click', function () {
      root.querySelectorAll('[data-cnc-key]').forEach(function (details) {
        details.open = false;
        cncExpanded.delete(details.dataset.cncKey);
      });
    });
  }
  function wireOrders() {
    var _root$querySelector58, _root$querySelector60;
    root.querySelectorAll('[data-order-filter]').forEach(function (button) {
      return button.onclick = function () {
        orderFilter = button.dataset.orderFilter;
        render();
      };
    });
    var search = root.querySelector('[data-order-search]');
    if (search) search.oninput = function () {
      orderQuery = search.value;
      var position = search.selectionStart;
      render();
      var next = root.querySelector('[data-order-search]');
      next === null || next === void 0 || next.focus();
      if (position !== null) next === null || next === void 0 || next.setSelectionRange(position, position);
    };
    var _loop3 = function _loop3() {
      var _arr$_i = _slicedToArray(_arr[_i5], 2),
        selector = _arr$_i[0],
        set = _arr$_i[1];
      var input = root.querySelector('[data-order-' + selector + ']');
      if (input) input.onchange = function () {
        set(input.value);
        render();
      };
    };
    for (var _i5 = 0, _arr = [['project', function (value) {
        return orderProject = value;
      }], ['requester', function (value) {
        return orderRequester = value;
      }], ['delivery', function (value) {
        return orderDelivery = value;
      }]]; _i5 < _arr.length; _i5++) {
      _loop3();
    }
    (_root$querySelector58 = root.querySelector('[data-my-orders]')) === null || _root$querySelector58 === void 0 || _root$querySelector58.addEventListener('click', function () {
      orderRequester = session.username;
      render();
    });
    var _loop4 = function _loop4() {
      var _root$querySelector59;
      var _arr2$_i = _slicedToArray(_arr2[_i6], 2),
        selector = _arr2$_i[0],
        value = _arr2$_i[1];
      (_root$querySelector59 = root.querySelector('[data-' + selector + ']')) === null || _root$querySelector59 === void 0 || _root$querySelector59.addEventListener('click', function () {
        orderDelivery = value;
        orderFilter = 'active';
        render();
      });
    };
    for (var _i6 = 0, _arr2 = [['due-week', 'week'], ['overdue', 'overdue']]; _i6 < _arr2.length; _i6++) {
      _loop4();
    }
    (_root$querySelector60 = root.querySelector('[data-clear-order-filters]')) === null || _root$querySelector60 === void 0 || _root$querySelector60.addEventListener('click', function () {
      orderQuery = '';
      orderProject = '';
      orderRequester = '';
      orderDelivery = '';
      orderFilter = 'active';
      render();
    });
  }
  function wireSupport() {
    var _root$querySelector61, _root$querySelector62, _root$querySelector63, _root$querySelector64, _root$querySelector65;
    (_root$querySelector61 = root.querySelector('[data-support-back]')) === null || _root$querySelector61 === void 0 || _root$querySelector61.addEventListener('click', function () {
      supportSelected = '';
      message = '';
      render();
    });
    root.querySelectorAll('[data-support-ticket]').forEach(function (button) {
      return button.onclick = function () {
        supportSelected = button.dataset.supportTicket;
        message = '';
        render();
      };
    });
    (_root$querySelector62 = root.querySelector('[data-support-create]')) === null || _root$querySelector62 === void 0 || _root$querySelector62.addEventListener('submit', submitSupport);
    (_root$querySelector63 = root.querySelector('[data-support-reply]')) === null || _root$querySelector63 === void 0 || _root$querySelector63.addEventListener('submit', replySupport);
    var status = root.querySelector('[data-support-status]'),
      ticket = supportTickets.find(function (value) {
        return value.id === supportSelected;
      });
    if (status && ticket) {
      status.value = ticket.status;
      status.onchange = function () {
        return updateSupportStatus(status.value);
      };
    }
    (_root$querySelector64 = root.querySelector('[data-support-photo]')) === null || _root$querySelector64 === void 0 || _root$querySelector64.addEventListener('change', /*#__PURE__*/function () {
      var _ref33 = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee5(event) {
        var _event$target$files2;
        var file, _t8;
        return _regenerator().w(function (_context5) {
          while (1) switch (_context5.p = _context5.n) {
            case 0:
              file = (_event$target$files2 = event.target.files) === null || _event$target$files2 === void 0 ? void 0 : _event$target$files2[0];
              if (file) {
                _context5.n = 1;
                break;
              }
              return _context5.a(2);
            case 1:
              message = 'Preparing attachment…';
              render();
              _context5.p = 2;
              _context5.n = 3;
              return readPhoto(file);
            case 3:
              supportPhoto = _context5.v;
              message = '';
              _context5.n = 5;
              break;
            case 4:
              _context5.p = 4;
              _t8 = _context5.v;
              message = _t8.message || 'Attachment could not be prepared.';
            case 5:
              render();
            case 6:
              return _context5.a(2);
          }
        }, _callee5, null, [[2, 4]]);
      }));
      return function (_x45) {
        return _ref33.apply(this, arguments);
      };
    }());
    (_root$querySelector65 = root.querySelector('[data-support-reply-photo]')) === null || _root$querySelector65 === void 0 || _root$querySelector65.addEventListener('change', /*#__PURE__*/function () {
      var _ref34 = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee6(event) {
        var _event$target$files3;
        var file, _t9;
        return _regenerator().w(function (_context6) {
          while (1) switch (_context6.p = _context6.n) {
            case 0:
              file = (_event$target$files3 = event.target.files) === null || _event$target$files3 === void 0 ? void 0 : _event$target$files3[0];
              if (file) {
                _context6.n = 1;
                break;
              }
              return _context6.a(2);
            case 1:
              message = 'Preparing attachment…';
              render();
              _context6.p = 2;
              _context6.n = 3;
              return readPhoto(file);
            case 3:
              supportReplyPhoto = _context6.v;
              message = '';
              _context6.n = 5;
              break;
            case 4:
              _context6.p = 4;
              _t9 = _context6.v;
              message = _t9.message || 'Attachment could not be prepared.';
            case 5:
              render();
            case 6:
              return _context6.a(2);
          }
        }, _callee6, null, [[2, 4]]);
      }));
      return function (_x46) {
        return _ref34.apply(this, arguments);
      };
    }());
  }
  function downloadProductionTracker(_x47) {
    return _downloadProductionTracker.apply(this, arguments);
  } // Keep screen IDs in browser history; drafts, files and credentials stay in their existing stores.
  function _downloadProductionTracker() {
    _downloadProductionTracker = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee66(button) {
      var version, original, response, _result30, link, _t73;
      return _regenerator().w(function (_context69) {
        while (1) switch (_context69.p = _context69.n) {
          case 0:
            if (!(button.disabled || !session || !can('site.cnc.view'))) {
              _context69.n = 1;
              break;
            }
            return _context69.a(2);
          case 1:
            version = sessionVersion, original = button.innerHTML;
            button.disabled = true;
            button.textContent = 'Downloading…';
            _context69.p = 2;
            _context69.n = 3;
            return api('/cnc-share');
          case 3:
            response = _context69.v;
            _context69.n = 4;
            return response.json();
          case 4:
            _result30 = _context69.v;
            if (!(version !== sessionVersion)) {
              _context69.n = 5;
              break;
            }
            return _context69.a(2);
          case 5:
            if (response.ok) {
              _context69.n = 6;
              break;
            }
            throw Error(_result30.error || 'Production Tracker could not be downloaded.');
          case 6:
            if (_result30.token) {
              _context69.n = 7;
              break;
            }
            throw Error('Production Tracker is currently unavailable.');
          case 7:
            link = document.createElement('a');
            link.href = 'https://cnc.panelstockhq.com/cnc-tracker?token=' + encodeURIComponent(_result30.token);
            link.download = 'PRODUCTION_TRACKER.xlsx';
            link.rel = 'noreferrer';
            link.referrerPolicy = 'no-referrer';
            document.body.appendChild(link);
            link.click();
            link.remove();
            _context69.n = 9;
            break;
          case 8:
            _context69.p = 8;
            _t73 = _context69.v;
            if (version === sessionVersion) {
              message = _t73.message || 'Could not reach the server. Connect and try again.';
              render();
            }
          case 9:
            _context69.p = 9;
            if (button.isConnected) {
              button.disabled = false;
              button.innerHTML = original;
            }
            return _context69.f(9);
          case 10:
            return _context69.a(2);
        }
      }, _callee66, null, [[2, 8, 9, 10]]);
    }));
    return _downloadProductionTracker.apply(this, arguments);
  }
  var siteNavOwner = null,
    siteNavKey = '',
    siteNavRestoring = false;
  function siteHistoryEnabled() {
    return !mobileHost && window.history && typeof window.history.pushState === 'function' && typeof window.history.replaceState === 'function';
  }
  function siteInstalled() {
    return navigator.standalone === true || !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  }
  function siteHomeScreen() {
    return can('site.orders.view') ? 'orders' : can('site.cnc.view') ? 'cnc' : 'settings';
  }
  function siteScreen() {
    return {
      view: view,
      orderId: ['order', 'deliveries'].includes(view) ? selectedOrderId : '',
      supportId: view === 'support' ? supportSelected : '',
      draftId: view === 'new' && orderDraft ? orderDraft.id : '',
      orderReturnView: orderReturnView
    };
  }
  function siteScreenKey(screen) {
    return JSON.stringify([screen.view, screen.orderId || '', screen.supportId || '', screen.draftId || '']);
  }
  function syncSiteNavigation() {
    if (!siteHistoryEnabled()) return;
    if (!session) {
      siteNavOwner = null;
      siteNavKey = '';
      return;
    }
    var screen = siteScreen(),
      key = siteScreenKey(screen),
      previous = window.history.state;
    var step = previous && previous.panelstockSite === 1 && previous.owner === session.username && previous.step >= 0 ? previous.step : 0;
    var entry = {
      panelstockSite: 1,
      owner: session.username,
      screen: screen,
      step: step,
      guard: false
    };
    if (siteNavOwner !== session.username) {
      siteNavOwner = session.username;
      entry.step = 0;
      if (siteInstalled()) {
        // A spare home entry keeps Back at the installed app's first screen inside the app.
        window.history.replaceState({
          panelstockSite: 1,
          owner: session.username,
          screen: {
            view: siteHomeScreen()
          },
          step: -1,
          guard: true
        }, '');
        window.history.pushState(entry, '');
      } else window.history.replaceState(entry, '');
    } else if (!siteNavRestoring && key !== siteNavKey) {
      entry.step = step + 1;
      window.history.pushState(entry, '');
    } else window.history.replaceState(entry, '');
    siteNavKey = key;
  }
  function restoreSiteNavigation(event) {
    if (!siteHistoryEnabled()) return;
    if (!session) {
      syncSiteNavigation();
      return;
    }
    var entry = event.state,
      owned = entry && entry.panelstockSite === 1 && entry.owner === session.username;
    if (!owned && !siteInstalled()) return;
    var screen = owned && entry.screen || {
      view: siteHomeScreen()
    };
    captureGateProgress();
    capturePanelDrawing();
    captureOrderDelivery();
    captureComment();
    captureReceipt();
    captureDraft();
    document.querySelectorAll('.date-overlay').forEach(function (overlay) {
      overlay.remove();
    });
    view = ['orders', 'order-search', 'order-attention', 'new', 'drafts', 'order', 'deliveries', 'cnc', 'support', 'settings', 'notifications'].indexOf(screen.view) >= 0 ? screen.view : siteHomeScreen();
    selectedOrderId = ['order', 'deliveries'].includes(view) && typeof screen.orderId === 'string' ? screen.orderId : '';
    supportSelected = view === 'support' && typeof screen.supportId === 'string' ? screen.supportId : '';
    orderReturnView = ['orders', 'order-search', 'order-attention', 'notifications'].indexOf(screen.orderReturnView) >= 0 ? screen.orderReturnView : 'orders';
    // A submitted/discarded draft must not reappear as an empty, sendable order via Forward.
    if (view === 'new' && (!orderDraft || draftOwner !== session.username || orderDraft.id !== screen.draftId)) view = 'drafts';
    if (view === 'order' && !selectedOrderId) view = siteHomeScreen();
    message = '';
    discardDraftArmed = false;
    clearNotificationsArmed = false;
    historyState = {};
    productionState = {};
    siteNavRestoring = true;
    try {
      render();
    } finally {
      siteNavRestoring = false;
    }
    if (siteInstalled() && (!owned || entry.guard)) {
      var home = window.history.state;
      window.history.replaceState({
        panelstockSite: 1,
        owner: session.username,
        screen: home.screen,
        step: -1,
        guard: true
      }, '');
      window.history.pushState({
        panelstockSite: 1,
        owner: session.username,
        screen: home.screen,
        step: 0,
        guard: false
      }, '');
    }
    if (view === 'order' && can('site.orders.view') && !pendingOrders().some(function (order) {
      return order.id === selectedOrderId;
    })) {
      if (!orders.some(function (order) {
        return order.id === selectedOrderId;
      })) void loadNotificationOrder(selectedOrderId);else {
        void loadOrderHistory(selectedOrderId);
        void loadProductionProgress(selectedOrderId);
      }
    }
  }
  window.addEventListener('popstate', restoreSiteNavigation);
  // The app's own Back buttons consume the same entry instead of adding a back-and-forth loop.
  root.addEventListener('click', function (event) {
    if (!siteHistoryEnabled() || !session) return;
    var entry = window.history.state,
      target = event.target;
    if (!entry || entry.panelstockSite !== 1 || entry.owner !== session.username || !(entry.step > 0)) return;
    while (target && target !== root) {
      if (target.hasAttribute && (target.hasAttribute('data-order-results') || target.hasAttribute('data-attention-back') || target.hasAttribute('data-support-back') || target.hasAttribute('data-delivery-back') && !!selectedOrderId)) {
        event.preventDefault();
        event.stopPropagation();
        window.history.back();
        return;
      }
      target = target.parentNode;
    }
  }, true);
  function render() {
    var _receiptPad4;
    if (!editorReady) return;
    captureOrderTypeCorrection();
    captureGateProgress();
    capturePanelDrawing();
    captureOrderDelivery();
    captureComment();
    if (view !== 'order') commentVisibleId = '';
    captureReceipt();
    captureDraft();
    if (receiptPhotoPreviewUrl) URL.revokeObjectURL(receiptPhotoPreviewUrl);
    receiptPhotoPreviewUrl = '';
    (_receiptPad4 = receiptPad) === null || _receiptPad4 === void 0 || _receiptPad4.destroy();
    receiptPad = null;
    if (!session) {
      syncSiteNavigation();
      if (mobileHost) root.textContent = 'Sign in again in the mobile app to open Site Orders.';else loginScreen();
      return;
    }
    if ((view === 'deliveries' || view === 'orders' || view === 'order-attention' || view === 'order-search' || view === 'new' || view === 'order' || view === 'drafts') && !can('site.orders.view')) view = can('site.cnc.view') ? 'cnc' : 'settings';
    if ((view === 'new' || view === 'drafts') && !can('site.orders.create')) view = 'orders';
    if (view === 'cnc' && !can('site.cnc.view')) view = can('site.orders.view') ? 'orders' : 'settings';
    syncSiteNavigation();
    var content = view === 'deliveries' ? deliveryWorkspace() : view === 'notifications' ? orderAlertsView() : view === 'drafts' ? cloudDraftView() : view === 'order-attention' ? orderAttentionView() : view === 'new' ? newOrder() : view === 'order' ? orderDetails() : view === 'cnc' ? cncView() : view === 'support' ? supportView() : view === 'settings' ? settingsView() : orderList();
    root.innerHTML = shell(content);
    wire();
    if (view === 'orders' || view === 'order-search') wireOrders();
    if (view === 'cnc') wireCnc();
    if (view === 'support') wireSupport();
  }
  if (mobileHost) window.PanelStockMobileOrdersCapture = function () {
    if (!editorReady) return;
    captureDraft();
    captureComment();
    captureReceipt();
  };
  function pullRefreshReason() {
    var _commentStates$select;
    if (busy || statusSaving || receiptSaving || receiptPhotoBusy || gateSaving || deliverySaving || (_commentStates$select = commentStates[selectedOrderId]) !== null && _commentStates$select !== void 0 && _commentStates$select.saving) return 'Wait for the current save to finish.';
    if ((view === 'settings' || view === 'support') && root.querySelector('form,textarea')) return 'Save or close the form before refreshing.';
    return true;
  }
  function refreshSitePage() {
    return _refreshSitePage.apply(this, arguments);
  }
  function _refreshSitePage() {
    _refreshSitePage = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee67() {
      var allowed, owner, version, oldView, oldId, ok;
      return _regenerator().w(function (_context70) {
        while (1) switch (_context70.n) {
          case 0:
            if (session) {
              _context70.n = 1;
              break;
            }
            return _context70.a(2, false);
          case 1:
            allowed = pullRefreshReason();
            if (!(allowed !== true)) {
              _context70.n = 2;
              break;
            }
            message = allowed;
            return _context70.a(2, false);
          case 2:
            owner = session.username, version = sessionVersion, oldView = view, oldId = selectedOrderId;
            captureGateProgress();
            captureOrderDelivery();
            captureComment();
            captureReceipt();
            captureDraft();
            _context70.n = 3;
            return refresh();
          case 3:
            ok = _context70.v;
            if (!(!session || session.username !== owner || version !== sessionVersion || view !== oldView || selectedOrderId !== oldId)) {
              _context70.n = 4;
              break;
            }
            return _context70.a(2, false);
          case 4:
            render();
            if (!(ok && view === 'order' && !pendingOrders().some(function (order) {
              return order.id === selectedOrderId;
            }))) {
              _context70.n = 5;
              break;
            }
            _context70.n = 5;
            return Promise.all([loadOrderHistory(oldId), loadProductionProgress(oldId), loadOrderComments(oldId)]);
          case 5:
            return _context70.a(2, ok);
        }
      }, _callee67);
    }));
    return _refreshSitePage.apply(this, arguments);
  }
  window.PanelStockSiteRefresh = refreshSitePage;
  (_window$PanelStockPul = window.PanelStockPullRefresh) === null || _window$PanelStockPul === void 0 || _window$PanelStockPul.mount({
    enabled: function enabled() {
      return !!session && (!mobileHost || mobileHost.isCurrent());
    },
    allowForms: true,
    allowFiles: true,
    canRefresh: pullRefreshReason,
    refresh: refreshSitePage
  });
  window.addEventListener('hashchange', function () {
    void resumeSharedDraft();
  });
  window.addEventListener('pagehide', function () {
    if (!editorReady) return;
    captureDraft();
    captureComment();
  });
  window.addEventListener('online', function () {
    if (!editorReady) return;
    updateCommentUI(selectedOrderId);
    message = 'Connection restored.';
    void flush();
  });
  if (!mobileHost && 'serviceWorker' in navigator) navigator.serviceWorker.register('/site/sw.js', {
    updateViaCache: 'none'
  }).then(function (registration) {
    return registration.update();
  }).catch(function () {});
  window.setInterval(function () {
    if (editorReady) void pollOrderAlerts();
  }, 60000);
  (_document$addEventLis = (_document = document).addEventListener) === null || _document$addEventLis === void 0 || _document$addEventLis.call(_document, 'visibilitychange', function () {
    if (editorReady && !document.hidden) void pollOrderAlerts();
  });
  editorReady = false;
  function startSiteEditor() {
    var refreshData = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : true;
    // Load only this page’s queue after claiming its durable workspace.
    // Other pages can keep working in their own workspaces.
    outbox = read(OUTBOX_KEY, {
      owner: null,
      queue: []
    });
    editorReady = true;
    render();
    if (session && refreshData) {
      void refresh().then(/*#__PURE__*/_asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee7() {
        return _regenerator().w(function (_context7) {
          while (1) switch (_context7.n) {
            case 0:
              render();
              _context7.n = 1;
              return flush();
            case 1:
              _context7.n = 2;
              return resumeSharedDraft();
            case 2:
              return _context7.a(2);
          }
        }, _callee7);
      })));
    }
  }
  function editorUnavailable(message) {
    root.textContent = message;
  }
  function openSiteWorkspace() {
    return _openSiteWorkspace.apply(this, arguments);
  }
  function _openSiteWorkspace() {
    _openSiteWorkspace = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee69() {
      var _session71, _session72;
      var refreshData,
        owner,
        version,
        request,
        workspace,
        previous,
        _args73 = arguments,
        _t74;
      return _regenerator().w(function (_context73) {
        while (1) switch (_context73.p = _context73.n) {
          case 0:
            refreshData = _args73.length > 0 && _args73[0] !== undefined ? _args73[0] : true;
            if ((_session71 = session) !== null && _session71 !== void 0 && _session71.username) {
              _context73.n = 1;
              break;
            }
            return _context73.a(2);
          case 1:
            if (!(siteWorkspace && workspaceOwner === session.username)) {
              _context73.n = 2;
              break;
            }
            return _context73.a(2);
          case 2:
            owner = session.username, version = sessionVersion, request = ++workspaceRequest;
            editorReady = false;
            _context73.p = 3;
            _context73.n = 4;
            return window.PanelStockWorkspaces.acquire({
              locks: navigator.locks,
              storage: localStorage,
              sessionStorage: sessionStorage,
              key: OUTBOX_KEY,
              legacyLock: 'panelstock-site-orders-editor-v1',
              owner: owner,
              read: function () {
                var _read2 = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee68(key) {
                  var _saved$queue;
                  var raw, saved, suffix, prefixes, _loop8, _ret2, index;
                  return _regenerator().w(function (_context72) {
                    while (1) switch (_context72.n) {
                      case 0:
                        raw = localStorage.getItem(key), saved = raw ? JSON.parse(raw) : null;
                        if (!(saved !== null && saved !== void 0 && (_saved$queue = saved.queue) !== null && _saved$queue !== void 0 && _saved$queue.length)) {
                          _context72.n = 1;
                          break;
                        }
                        return _context72.a(2, raw);
                      case 1:
                        suffix = key === OUTBOX_KEY ? '' : ':workspace:' + key.slice(OUTBOX_KEY.length + 5);
                        prefixes = workspacePrefixes.map(function (prefix, index) {
                          return prefix + owner + (index === 0 ? '' : ':');
                        });
                        _loop8 = /*#__PURE__*/_regenerator().m(function _loop8() {
                          var name;
                          return _regenerator().w(function (_context71) {
                            while (1) switch (_context71.n) {
                              case 0:
                                name = localStorage.key(index);
                                if (!(prefixes.some(function (prefix, index) {
                                  return index === 0 ? name === prefix + suffix : name.startsWith(prefix);
                                }) && (suffix ? name.endsWith(suffix) : !name.includes(':workspace:')) && localStorage.getItem(name))) {
                                  _context71.n = 1;
                                  break;
                                }
                                return _context71.a(2, {
                                  v: JSON.stringify({
                                    owner: owner,
                                    draft: true
                                  })
                                });
                              case 1:
                                return _context71.a(2);
                            }
                          }, _loop8);
                        });
                        index = 0;
                      case 2:
                        if (!(index < localStorage.length)) {
                          _context72.n = 5;
                          break;
                        }
                        return _context72.d(_regeneratorValues(_loop8()), 3);
                      case 3:
                        _ret2 = _context72.v;
                        if (!_ret2) {
                          _context72.n = 4;
                          break;
                        }
                        return _context72.a(2, _ret2.v);
                      case 4:
                        index++;
                        _context72.n = 2;
                        break;
                      case 5:
                        return _context72.a(2, raw);
                    }
                  }, _callee68);
                }));
                function read(_x53) {
                  return _read2.apply(this, arguments);
                }
                return read;
              }()
            });
          case 4:
            workspace = _context73.v;
            _context73.n = 6;
            break;
          case 5:
            _context73.p = 5;
            _t74 = _context73.v;
            if (request === workspaceRequest) editorUnavailable(_t74.message);
            throw _t74;
          case 6:
            if (!(request !== workspaceRequest || ((_session72 = session) === null || _session72 === void 0 ? void 0 : _session72.username) !== owner || version !== sessionVersion)) {
              _context73.n = 8;
              break;
            }
            _context73.n = 7;
            return workspace.release();
          case 7:
            if (request === workspaceRequest && !session) {
              editorReady = true;
              render();
            }
            return _context73.a(2);
          case 8:
            previous = siteWorkspace;
            siteWorkspace = workspace;
            workspaceOwner = owner;
            deviceStorage = window.PanelStockWorkspaces.scopedStorage(localStorage, OUTBOX_KEY, workspace.key, workspacePrefixes);
            startSiteEditor(refreshData);
            if (!previous) {
              _context73.n = 9;
              break;
            }
            _context73.n = 9;
            return previous.release();
          case 9:
            return _context73.a(2);
        }
      }, _callee69, null, [[3, 5]]);
    }));
    return _openSiteWorkspace.apply(this, arguments);
  }
  if (window.PanelStockWorkspaces) {
    if (session) void openSiteWorkspace().catch(function (error) {
      return editorUnavailable(error.message);
    });else {
      editorReady = true;
      render();
    }
  } else if (navigator.locks) {
    void navigator.locks.request('panelstock-site-orders-editor-v1', {
      ifAvailable: true
    }, function (lock) {
      if (!lock) {
        editorUnavailable('Site Orders is already open in another tab. Use that tab, or close it and reload this page.');
        return;
      }
      startSiteEditor();
      return new Promise(function () {});
    }).catch(function () {
      return editorUnavailable('Site Orders could not secure device storage. Reload this page before editing.');
    });
  } else {
    editorUnavailable('This browser cannot safely coordinate saved orders. Open Site Orders in an up-to-date browser.');
  }
})();
