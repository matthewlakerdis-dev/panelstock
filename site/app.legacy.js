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

function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
var _brandLogo = require("../worker/src/brand-logo.js");
var _excluded = ["file", "missing"],
  _excluded2 = ["file", "missing"],
  _excluded3 = ["file"],
  _excluded4 = ["file"];
function _regeneratorValues(e) { if (null != e) { var t = e["function" == typeof Symbol && Symbol.iterator || "@@iterator"], r = 0; if (t) return t.call(e); if ("function" == typeof e.next) return e; if (!isNaN(e.length)) return { next: function next() { return e && r >= e.length && (e = void 0), { value: e && e[r++], done: !e }; } }; } throw new TypeError(_typeof(e) + " is not iterable"); }
function _regenerator() { /*! regenerator-runtime -- Copyright (c) 2014-present, Facebook, Inc. -- license (MIT): https://github.com/babel/babel/blob/main/packages/babel-helpers/LICENSE */ var e, t, r = "function" == typeof Symbol ? Symbol : {}, n = r.iterator || "@@iterator", o = r.toStringTag || "@@toStringTag"; function i(r, n, o, i) { var c = n && n.prototype instanceof Generator ? n : Generator, u = Object.create(c.prototype); return _regeneratorDefine2(u, "_invoke", function (r, n, o) { var i, c, u, f = 0, p = o || [], y = !1, G = { p: 0, n: 0, v: e, a: d, f: d.bind(e, 4), d: function d(t, r) { return i = t, c = 0, u = e, G.n = r, a; } }; function d(r, n) { for (c = r, u = n, t = 0; !y && f && !o && t < p.length; t++) { var o, i = p[t], d = G.p, l = i[2]; r > 3 ? (o = l === n) && (u = i[(c = i[4]) ? 5 : (c = 3, 3)], i[4] = i[5] = e) : i[0] <= d && ((o = r < 2 && d < i[1]) ? (c = 0, G.v = n, G.n = i[1]) : d < l && (o = r < 3 || i[0] > n || n > l) && (i[4] = r, i[5] = n, G.n = l, c = 0)); } if (o || r > 1) return a; throw y = !0, n; } return function (o, p, l) { if (f > 1) throw TypeError("Generator is already running"); for (y && 1 === p && d(p, l), c = p, u = l; (t = c < 2 ? e : u) || !y;) { i || (c ? c < 3 ? (c > 1 && (G.n = -1), d(c, u)) : G.n = u : G.v = u); try { if (f = 2, i) { if (c || (o = "next"), t = i[o]) { if (!(t = t.call(i, u))) throw TypeError("iterator result is not an object"); if (!t.done) return t; u = t.value, c < 2 && (c = 0); } else 1 === c && (t = i.return) && t.call(i), c < 2 && (u = TypeError("The iterator does not provide a '" + o + "' method"), c = 1); i = e; } else if ((t = (y = G.n < 0) ? u : r.call(n, G)) !== a) break; } catch (t) { i = e, c = 1, u = t; } finally { f = 1; } } return { value: t, done: y }; }; }(r, o, i), !0), u; } var a = {}; function Generator() {} function GeneratorFunction() {} function GeneratorFunctionPrototype() {} t = Object.getPrototypeOf; var c = [][n] ? t(t([][n]())) : (_regeneratorDefine2(t = {}, n, function () { return this; }), t), u = GeneratorFunctionPrototype.prototype = Generator.prototype = Object.create(c); function f(e) { return Object.setPrototypeOf ? Object.setPrototypeOf(e, GeneratorFunctionPrototype) : (e.__proto__ = GeneratorFunctionPrototype, _regeneratorDefine2(e, o, "GeneratorFunction")), e.prototype = Object.create(u), e; } return GeneratorFunction.prototype = GeneratorFunctionPrototype, _regeneratorDefine2(u, "constructor", GeneratorFunctionPrototype), _regeneratorDefine2(GeneratorFunctionPrototype, "constructor", GeneratorFunction), GeneratorFunction.displayName = "GeneratorFunction", _regeneratorDefine2(GeneratorFunctionPrototype, o, "GeneratorFunction"), _regeneratorDefine2(u), _regeneratorDefine2(u, o, "Generator"), _regeneratorDefine2(u, n, function () { return this; }), _regeneratorDefine2(u, "toString", function () { return "[object Generator]"; }), (_regenerator = function _regenerator() { return { w: i, m: f }; })(); }
function _regeneratorDefine2(e, r, n, t) { var i = Object.defineProperty; try { i({}, "", {}); } catch (e) { i = 0; } _regeneratorDefine2 = function _regeneratorDefine(e, r, n, t) { function o(r, n) { _regeneratorDefine2(e, r, function (e) { return this._invoke(r, n, e); }); } r ? i ? i(e, r, { value: n, enumerable: !t, configurable: !t, writable: !t }) : e[r] = n : (o("next", 0), o("throw", 1), o("return", 2)); }, _regeneratorDefine2(e, r, n, t); }
function ownKeys(e, r) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r).enumerable; })), t.push.apply(t, o); } return t; }
function _objectSpread(e) { for (var r = 1; r < arguments.length; r++) { var t = null != arguments[r] ? arguments[r] : {}; r % 2 ? ownKeys(Object(t), !0).forEach(function (r) { _defineProperty(e, r, t[r]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function (r) { Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r)); }); } return e; }
function _defineProperty(e, r, t) { return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == _typeof(i) ? i : i + ""; }
function _toPrimitive(t, e) { if ("object" != _typeof(t) || !t) return t; var r; if ("undefined" != typeof Symbol && void 0 !== (r = t[Symbol.toPrimitive])) { var i = r.call(t, e || "default"); if ("object" != _typeof(i)) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === e ? String : Number)(t); }
function _createForOfIteratorHelper(r, e) { var t = "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"]; if (!t) { if (Array.isArray(r) || (t = _unsupportedIterableToArray(r)) || e && r && "number" == typeof r.length) { t && (r = t); var _n = 0, F = function F() {}; return { s: F, n: function n() { return _n >= r.length ? { done: !0 } : { done: !1, value: r[_n++] }; }, e: function e(r) { throw r; }, f: F }; } throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); } var o, a, u = !0; return { s: function s() { t = t.call(r); }, n: function n() { u = !0; var r = t.next(); return r.done ? { done: !0 } : { value: r.value, done: u = !1 }; }, e: function e(r) { o = !0, a = r; }, f: function f() { try { u || null == t.return || t.return(); } finally { if (o) throw a; } } }; }
function _slicedToArray(r, e) { return _arrayWithHoles(r) || _iterableToArrayLimit(r, e) || _unsupportedIterableToArray(r, e) || _nonIterableRest(); }
function _nonIterableRest() { throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _iterableToArrayLimit(r, l) { var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"]; if (null != t) { var e, n, i, u, a = [], f = !0, o = !1; try { if (i = (t = t.call(r)).next, 0 === l) { if (Object(t) !== t) return; f = !1; } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0); } catch (r) { o = !0, n = r; } finally { try { if (!f && null != t.return && (u = t.return(), Object(u) !== u)) return; } finally { if (o) throw n; } } return a; } }
function _arrayWithHoles(r) { if (Array.isArray(r)) return r; }
function _objectWithoutProperties(e, t) { if (null == e) return {}; var o, r, i = _objectWithoutPropertiesLoose(e, t); if (Object.getOwnPropertySymbols) { var n = Object.getOwnPropertySymbols(e); for (r = 0; r < n.length; r++) o = n[r], -1 === t.indexOf(o) && {}.propertyIsEnumerable.call(e, o) && (i[o] = e[o]); } return i; }
function _objectWithoutPropertiesLoose(r, e) { if (null == r) return {}; var t = {}; for (var n in r) if ({}.hasOwnProperty.call(r, n)) { if (-1 !== e.indexOf(n)) continue; t[n] = r[n]; } return t; }
function _toConsumableArray(r) { return _arrayWithoutHoles(r) || _iterableToArray(r) || _unsupportedIterableToArray(r) || _nonIterableSpread(); }
function _nonIterableSpread() { throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _unsupportedIterableToArray(r, a) { if (r) { if ("string" == typeof r) return _arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1); return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0; } }
function _iterableToArray(r) { if ("undefined" != typeof Symbol && null != r[Symbol.iterator] || null != r["@@iterator"]) return Array.from(r); }
function _arrayWithoutHoles(r) { if (Array.isArray(r)) return _arrayLikeToArray(r); }
function _arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }
function asyncGeneratorStep(n, t, e, r, o, a, c) { try { var i = n[a](c), u = i.value; } catch (n) { return void e(n); } i.done ? t(u) : Promise.resolve(u).then(r, o); }
function _asyncToGenerator(n) { return function () { var t = this, e = arguments; return new Promise(function (r, o) { var a = n.apply(t, e); function _next(n) { asyncGeneratorStep(a, r, o, _next, _throw, "next", n); } function _throw(n) { asyncGeneratorStep(a, r, o, _next, _throw, "throw", n); } _next(void 0); }); }; }
(function (_session, _session2, _session6, _document$addEventLis, _document) {
  'use strict';

  var API = 'https://panelstock-reports.matthewlakerdis.workers.dev';
  var SESSION_KEY = 'panelstock:site-orders:session:v1',
    OUTBOX_KEY = 'panelstock:site-orders:outbox:v1',
    PROJECTS_KEY = 'panelstock:site-orders:projects:v1',
    USERNAME_KEY = 'panelstock:site-orders:remembered-username:v2';
  var root = document.getElementById('app');
  var session = read(SESSION_KEY, null),
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
  function draftApi(_x, _x2) {
    return _draftApi.apply(this, arguments);
  }
  function _draftApi() {
    _draftApi = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee4(path, body) {
      var response, result;
      return _regenerator().w(function (_context4) {
        while (1) switch (_context4.n) {
          case 0:
            _context4.n = 1;
            return api('/order-drafts' + path, body === undefined ? {} : {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(body)
            });
          case 1:
            response = _context4.v;
            _context4.n = 2;
            return response.json();
          case 2:
            result = _context4.v;
            if (response.ok) {
              _context4.n = 3;
              break;
            }
            throw Error(result.error || 'Draft could not be saved.');
          case 3:
            return _context4.a(2, result);
        }
      }, _callee4);
    }));
    return _draftApi.apply(this, arguments);
  }
  function loadCloudDrafts() {
    return _loadCloudDrafts.apply(this, arguments);
  }
  function _loadCloudDrafts() {
    _loadCloudDrafts = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee5() {
      var version, result, _t4;
      return _regenerator().w(function (_context5) {
        while (1) switch (_context5.p = _context5.n) {
          case 0:
            if (can('site.orders.create')) {
              _context5.n = 1;
              break;
            }
            cloudDrafts = [];
            return _context5.a(2);
          case 1:
            version = sessionVersion;
            _context5.p = 2;
            _context5.n = 3;
            return draftApi('');
          case 3:
            result = _context5.v;
            if (!(version !== sessionVersion)) {
              _context5.n = 4;
              break;
            }
            return _context5.a(2);
          case 4:
            cloudDrafts = result.drafts || [];
            cloudDraftError = '';
            _context5.n = 6;
            break;
          case 5:
            _context5.p = 5;
            _t4 = _context5.v;
            if (version === sessionVersion) cloudDraftError = _t4.message;
          case 6:
            return _context5.a(2);
        }
      }, _callee5, null, [[2, 5]]);
    }));
    return _loadCloudDrafts.apply(this, arguments);
  }
  function persistCloudDraft() {
    return _persistCloudDraft.apply(this, arguments);
  }
  function _persistCloudDraft() {
    _persistCloudDraft = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee6() {
      var _session0;
      var draft, owner, version, selected, order, result, remember, _iterator4, _step4, _loop4, _t5;
      return _regenerator().w(function (_context7) {
        while (1) switch (_context7.p = _context7.n) {
          case 0:
            captureDraft();
            draft = orderDraft && draftOwner === ((_session0 = session) === null || _session0 === void 0 ? void 0 : _session0.username) ? orderDraft : savedDraft();
            if (draft) {
              _context7.n = 1;
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
            _context7.n = 2;
            return draftApi('/' + draft.id, {
              order: order,
              attachmentIds: (draft.attachments || []).map(function (file) {
                return file.id;
              }),
              expectedUpdatedAt: draft.cloudUpdatedAt || ''
            });
          case 2:
            result = _context7.v;
            remember = function remember() {
              var _session1;
              if (((_session1 = session) === null || _session1 === void 0 ? void 0 : _session1.username) !== owner || sessionVersion !== version) throw Error('Your account changed.');
              draft.cloudUpdatedAt = result.draft.updatedAt;
              orderDraft = draft;
              draftOwner = owner;
              if (!writeDraft()) throw Error(draftNotice);
            };
            remember();
            _iterator4 = _createForOfIteratorHelper(draft.attachments || []);
            _context7.p = 3;
            _loop4 = /*#__PURE__*/_regenerator().m(function _loop4() {
              var _session10;
              var metadata, file, data;
              return _regenerator().w(function (_context6) {
                while (1) switch (_context6.n) {
                  case 0:
                    metadata = _step4.value;
                    if (!result.draft.attachments.some(function (file) {
                      return file.id === metadata.id;
                    })) {
                      _context6.n = 1;
                      break;
                    }
                    return _context6.a(2, 1);
                  case 1:
                    _context6.n = 2;
                    return attachmentDb('get', metadata.id);
                  case 2:
                    file = _context6.v;
                    if (file) {
                      _context6.n = 3;
                      break;
                    }
                    throw Error('A saved file is unavailable. Reattach it before saving to your account.');
                  case 3:
                    _context6.n = 4;
                    return attachmentData(file);
                  case 4:
                    data = _context6.v;
                    if (!(((_session10 = session) === null || _session10 === void 0 ? void 0 : _session10.username) !== owner || sessionVersion !== version)) {
                      _context6.n = 5;
                      break;
                    }
                    throw Error('Your account changed.');
                  case 5:
                    _context6.n = 6;
                    return draftApi('/' + draft.id + '/files', {
                      id: metadata.id,
                      name: metadata.name,
                      data: data,
                      expectedUpdatedAt: result.draft.updatedAt
                    });
                  case 6:
                    result = _context6.v;
                    remember();
                  case 7:
                    return _context6.a(2);
                }
              }, _loop4);
            });
            _iterator4.s();
          case 4:
            if ((_step4 = _iterator4.n()).done) {
              _context7.n = 7;
              break;
            }
            return _context7.d(_regeneratorValues(_loop4()), 5);
          case 5:
            if (!_context7.v) {
              _context7.n = 6;
              break;
            }
            return _context7.a(3, 6);
          case 6:
            _context7.n = 4;
            break;
          case 7:
            _context7.n = 9;
            break;
          case 8:
            _context7.p = 8;
            _t5 = _context7.v;
            _iterator4.e(_t5);
          case 9:
            _context7.p = 9;
            _iterator4.f();
            return _context7.f(9);
          case 10:
            _context7.n = 11;
            return loadCloudDrafts();
          case 11:
            return _context7.a(2, draft);
        }
      }, _callee6, null, [[3, 8, 9, 10]]);
    }));
    return _persistCloudDraft.apply(this, arguments);
  }
  function saveCloudDraft() {
    return _saveCloudDraft.apply(this, arguments);
  }
  function _saveCloudDraft() {
    _saveCloudDraft = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee7() {
      var _session11;
      var _t6;
      return _regenerator().w(function (_context8) {
        while (1) switch (_context8.p = _context8.n) {
          case 0:
            if (!busy) {
              _context8.n = 1;
              break;
            }
            return _context8.a(2);
          case 1:
            captureDraft();
            if (orderDraft && draftOwner === ((_session11 = session) === null || _session11 === void 0 ? void 0 : _session11.username)) orderDraft.explicitlySaved = true;
            if (navigator.onLine) {
              _context8.n = 3;
              break;
            }
            if (writeDraft()) {
              _context8.n = 2;
              break;
            }
            message = draftNotice;
            render();
            return _context8.a(2);
          case 2:
            message = 'Draft saved on this device. Connect and save again to make it available on Web.';
            discardDraftArmed = false;
            view = 'orders';
            render();
            return _context8.a(2);
          case 3:
            busy = true;
            render();
            _context8.p = 4;
            _context8.n = 5;
            return persistCloudDraft();
          case 5:
            message = 'Draft saved to your account, including files and photos.';
            discardDraftArmed = false;
            view = 'orders';
            _context8.n = 7;
            break;
          case 6:
            _context8.p = 6;
            _t6 = _context8.v;
            message = _t6.message;
          case 7:
            _context8.p = 7;
            busy = false;
            render();
            return _context8.f(7);
          case 8:
            return _context8.a(2);
        }
      }, _callee7, null, [[4, 6, 7, 8]]);
    }));
    return _saveCloudDraft.apply(this, arguments);
  }
  function openCloudDraft(_x3) {
    return _openCloudDraft.apply(this, arguments);
  }
  function _openCloudDraft() {
    _openCloudDraft = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee8(id) {
      var owner, version, local, _session12, saved, files, _iterator5, _step5, metadata, _result, _t7, _t8;
      return _regenerator().w(function (_context9) {
        while (1) switch (_context9.p = _context9.n) {
          case 0:
            if (!busy) {
              _context9.n = 1;
              break;
            }
            return _context9.a(2);
          case 1:
            if (navigator.onLine) {
              _context9.n = 2;
              break;
            }
            message = 'Connect to open account drafts. Your device draft is available offline.';
            render();
            return _context9.a(2);
          case 2:
            captureDraft();
            owner = session.username, version = sessionVersion, local = listedDeviceDraft();
            if (!((local === null || local === void 0 ? void 0 : local.id) === id)) {
              _context9.n = 4;
              break;
            }
            _context9.n = 3;
            return openDraft();
          case 3:
            return _context9.a(2);
          case 4:
            busy = true;
            _context9.p = 5;
            if (!local) {
              _context9.n = 6;
              break;
            }
            _context9.n = 6;
            return persistCloudDraft();
          case 6:
            _context9.n = 7;
            return draftApi('/' + id);
          case 7:
            saved = _context9.v.draft;
            files = [];
            _iterator5 = _createForOfIteratorHelper(saved.attachments);
            _context9.p = 8;
            _iterator5.s();
          case 9:
            if ((_step5 = _iterator5.n()).done) {
              _context9.n = 12;
              break;
            }
            metadata = _step5.value;
            _context9.n = 10;
            return draftApi('/' + id + '/files/' + metadata.id);
          case 10:
            _result = _context9.v;
            files.push(_objectSpread(_objectSpread({}, metadata), {}, {
              file: new Blob([Uint8Array.from(atob(_result.file.data), function (c) {
                return c.charCodeAt(0);
              })], {
                type: 'application/octet-stream'
              })
            }));
          case 11:
            _context9.n = 9;
            break;
          case 12:
            _context9.n = 14;
            break;
          case 13:
            _context9.p = 13;
            _t7 = _context9.v;
            _iterator5.e(_t7);
          case 14:
            _context9.p = 14;
            _iterator5.f();
            return _context9.f(14);
          case 15:
            _context9.n = 16;
            return attachmentDb('put', files);
          case 16:
            if (!(sessionVersion !== version || ((_session12 = session) === null || _session12 === void 0 ? void 0 : _session12.username) !== owner)) {
              _context9.n = 17;
              break;
            }
            return _context9.a(2);
          case 17:
            orderDraft = {
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
            draftOwner = session.username;
            selectedOrderFiles = files;
            writeDraft();
            discardDraftArmed = false;
            view = 'new';
            message = 'Account draft restored.';
            draftNotice = 'Saved to your account';
            _context9.n = 19;
            break;
          case 18:
            _context9.p = 18;
            _t8 = _context9.v;
            message = _t8.message;
          case 19:
            _context9.p = 19;
            busy = false;
            render();
            return _context9.f(19);
          case 20:
            return _context9.a(2);
        }
      }, _callee8, null, [[8, 13, 14, 15], [5, 18, 19, 20]]);
    }));
    return _openCloudDraft.apply(this, arguments);
  }
  function deleteCloudDraft(_x4) {
    return _deleteCloudDraft.apply(this, arguments);
  }
  function _deleteCloudDraft() {
    _deleteCloudDraft = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee9(id) {
      var draft, owner, version, local, _session13, _t9;
      return _regenerator().w(function (_context0) {
        while (1) switch (_context0.p = _context0.n) {
          case 0:
            if (!busy) {
              _context0.n = 1;
              break;
            }
            return _context0.a(2);
          case 1:
            if (!(cloudDiscardId !== id)) {
              _context0.n = 2;
              break;
            }
            cloudDiscardId = id;
            render();
            return _context0.a(2);
          case 2:
            draft = cloudDrafts.find(function (item) {
              return item.id === id;
            }), owner = session.username, version = sessionVersion;
            if (draft) {
              _context0.n = 3;
              break;
            }
            return _context0.a(2);
          case 3:
            busy = true;
            _context0.p = 4;
            _context0.n = 5;
            return draftApi('/' + id + '/discard', {
              expectedUpdatedAt: draft.updatedAt
            });
          case 5:
            local = savedDraft();
            if (!((local === null || local === void 0 ? void 0 : local.id) === id)) {
              _context0.n = 8;
              break;
            }
            _context0.n = 6;
            return attachmentDb('delete', local.attachments || []);
          case 6:
            if (!(sessionVersion !== version || ((_session13 = session) === null || _session13 === void 0 ? void 0 : _session13.username) !== owner)) {
              _context0.n = 7;
              break;
            }
            return _context0.a(2);
          case 7:
            localStorage.removeItem(DRAFT_KEY + owner);
            orderDraft = null;
            draftOwner = '';
            selectedOrderFiles = [];
          case 8:
            cloudDiscardId = '';
            _context0.n = 9;
            return loadCloudDrafts();
          case 9:
            message = 'Draft deleted.';
            _context0.n = 11;
            break;
          case 10:
            _context0.p = 10;
            _t9 = _context0.v;
            message = _t9.message;
          case 11:
            _context0.p = 11;
            busy = false;
            render();
            return _context0.f(11);
          case 12:
            return _context0.a(2);
        }
      }, _callee9, null, [[4, 10, 11, 12]]);
    }));
    return _deleteCloudDraft.apply(this, arguments);
  }
  function startNewSiteDraft() {
    return _startNewSiteDraft.apply(this, arguments);
  }
  function _startNewSiteDraft() {
    _startNewSiteDraft = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee0() {
      var local, _t0;
      return _regenerator().w(function (_context1) {
        while (1) switch (_context1.p = _context1.n) {
          case 0:
            if (!busy) {
              _context1.n = 1;
              break;
            }
            return _context1.a(2);
          case 1:
            busy = true;
            _context1.p = 2;
            local = listedDeviceDraft();
            if (!local) {
              _context1.n = 4;
              break;
            }
            if (navigator.onLine) {
              _context1.n = 3;
              break;
            }
            throw Error('Save or discard the current device draft before starting another offline.');
          case 3:
            _context1.n = 4;
            return persistCloudDraft();
          case 4:
            localStorage.removeItem(DRAFT_KEY + session.username);
            orderDraft = null;
            draftOwner = '';
            selectedOrderFiles = [];
            busy = false;
            _context1.n = 5;
            return openDraft();
          case 5:
            _context1.n = 7;
            break;
          case 6:
            _context1.p = 6;
            _t0 = _context1.v;
            busy = false;
            message = _t0.message;
            render();
          case 7:
            return _context1.a(2);
        }
      }, _callee0, null, [[2, 6]]);
    }));
    return _startNewSiteDraft.apply(this, arguments);
  }
  var TRASH_ICON = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6"/></svg>';
  function listedDeviceDraft() {
    var _profile;
    var draft = savedDraft();
    if (!draft) return null;
    var fields = draft.fields || {},
      defaults = ((_profile = profile) === null || _profile === void 0 ? void 0 : _profile.siteOrderDefaults) || {};
    var edited = ['projectId', 'orderTypeOther', 'requestedDeliveryTime', 'locationNotes'].some(function (name) {
      return String(fields[name] || '').trim();
    }) || ['siteContact', 'phone'].some(function (name) {
      return String(fields[name] || '').trim() && fields[name] !== defaults[name];
    }) || (draft.items || []).some(function (item) {
      return String(item.description || '').trim();
    }) || (draft.attachments || []).length;
    return draft.explicitlySaved || draft.cloudUpdatedAt || edited ? draft : null;
  }
  function deleteDeviceDraft(_x5) {
    return _deleteDeviceDraft.apply(this, arguments);
  }
  function _deleteDeviceDraft() {
    _deleteDeviceDraft = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee1(id) {
      var draft, owner, version, _t1;
      return _regenerator().w(function (_context10) {
        while (1) switch (_context10.p = _context10.n) {
          case 0:
            if (!busy) {
              _context10.n = 1;
              break;
            }
            return _context10.a(2);
          case 1:
            draft = savedDraft();
            if (!(!draft || draft.id !== id)) {
              _context10.n = 2;
              break;
            }
            return _context10.a(2);
          case 2:
            if (!(deviceDiscardId !== id)) {
              _context10.n = 3;
              break;
            }
            deviceDiscardId = id;
            render();
            return _context10.a(2);
          case 3:
            owner = session.username, version = sessionVersion;
            _context10.p = 4;
            localStorage.removeItem(DRAFT_KEY + owner);
            _context10.n = 6;
            break;
          case 5:
            _context10.p = 5;
            _t1 = _context10.v;
            message = 'Could not delete this device draft. Try again.';
            render();
            return _context10.a(2);
          case 6:
            orderDraft = null;
            draftOwner = '';
            selectedOrderFiles = [];
            deviceDiscardId = '';
            message = 'Draft deleted.';
            render();
            _context10.n = 7;
            return attachmentDb('delete', draft.attachments || []).catch(function () {});
          case 7:
            if (!(version !== sessionVersion)) {
              _context10.n = 8;
              break;
            }
            return _context10.a(2);
          case 8:
            return _context10.a(2);
        }
      }, _callee1, null, [[4, 5]]);
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
    var _session3;
    if (!orderDraft || draftOwner !== ((_session3 = session) === null || _session3 === void 0 ? void 0 : _session3.username)) return false;
    try {
      localStorage.setItem(DRAFT_KEY + draftOwner, JSON.stringify(orderDraft));
      draftNotice = 'Draft saved on this device';
      return true;
    } catch (_unused) {
      draftNotice = 'Draft could not be saved. Keep this page open and free up device storage.';
      return false;
    }
  }
  function captureDraft() {
    var _session4;
    var form = root.querySelector('[data-order]');
    if (!form || restoringDraft || !orderDraft || draftOwner !== ((_session4 = session) === null || _session4 === void 0 ? void 0 : _session4.username)) return;
    orderDraft.fields = Object.fromEntries(draftFields.map(function (name) {
      var _form$querySelector;
      return [name, ((_form$querySelector = form.querySelector('[name="' + name + '"]')) === null || _form$querySelector === void 0 ? void 0 : _form$querySelector.value) || ''];
    }));
    orderDraft.items = _toConsumableArray(form.querySelectorAll('.item')).map(function (row) {
      return {
        quantity: row.querySelector('[name=quantity]').value,
        description: row.querySelector('[name=description]').value
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
    _openDraft = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee11() {
      var owner, version, _session14, _draft, files;
      return _regenerator().w(function (_context12) {
        while (1) switch (_context12.p = _context12.n) {
          case 0:
            if (!busy) {
              _context12.n = 1;
              break;
            }
            return _context12.a(2);
          case 1:
            owner = session.username, version = sessionVersion;
            busy = true;
            _context12.p = 2;
            _draft = orderDraft && draftOwner === owner ? orderDraft : savedDraft();
            orderDraft = _draft || {
              id: crypto.randomUUID(),
              owner: owner,
              fields: {},
              items: [{
                quantity: '1',
                description: ''
              }],
              attachments: [],
              updatedAt: new Date().toISOString()
            };
            draftOwner = owner;
            _context12.n = 3;
            return Promise.all((orderDraft.attachments || []).map(/*#__PURE__*/function () {
              var _ref15 = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee10(metadata) {
                var file, _t10;
                return _regenerator().w(function (_context11) {
                  while (1) switch (_context11.p = _context11.n) {
                    case 0:
                      _context11.p = 0;
                      _context11.n = 1;
                      return attachmentDb('get', metadata.id);
                    case 1:
                      file = _context11.v;
                      return _context11.a(2, _objectSpread(_objectSpread({}, metadata), {}, {
                        file: file,
                        missing: !file
                      }));
                    case 2:
                      _context11.p = 2;
                      _t10 = _context11.v;
                      return _context11.a(2, _objectSpread(_objectSpread({}, metadata), {}, {
                        missing: true
                      }));
                  }
                }, _callee10, null, [[0, 2]]);
              }));
              return function (_x26) {
                return _ref15.apply(this, arguments);
              };
            }()));
          case 3:
            files = _context12.v;
            if (!(sessionVersion !== version || ((_session14 = session) === null || _session14 === void 0 ? void 0 : _session14.username) !== owner)) {
              _context12.n = 4;
              break;
            }
            return _context12.a(2);
          case 4:
            selectedOrderFiles = files;
            discardDraftArmed = false;
            view = 'new';
            message = files.some(function (file) {
              return file.missing;
            }) ? 'Some saved files are unavailable. Remove them and attach them again before submitting.' : '';
            draftNotice = _draft ? 'Restored draft from this device' : 'Your draft saves automatically on this device';
            busy = false;
            render();
            captureDraft();
          case 5:
            _context12.p = 5;
            busy = false;
            return _context12.f(5);
          case 6:
            return _context12.a(2);
        }
      }, _callee11, null, [[2,, 5, 6]]);
    }));
    return _openDraft.apply(this, arguments);
  }
  function restoreDraftForm() {
    var form = root.querySelector('[data-order]');
    if (!form) return;
    restoringDraft = true;
    try {
      var _orderDraft2;
      var _loop = function _loop() {
        var _Object$entries$_i = _slicedToArray(_Object$entries[_i], 2),
          name = _Object$entries$_i[0],
          value = _Object$entries$_i[1];
        var input = form.querySelector('[name="' + name + '"]');
        if (!input) return 1; // continue
        if (input.tagName === 'SELECT' && value && !_toConsumableArray(input.options).some(function (option) {
          return option.value === value;
        })) {
          var option = document.createElement('option');
          option.value = value;
          option.textContent = value + ' (unavailable — choose another)';
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
      if (date !== null && date !== void 0 && date.value && label) label.textContent = formatDate(date.value);
      var _iterator = _createForOfIteratorHelper(((_orderDraft2 = orderDraft) === null || _orderDraft2 === void 0 ? void 0 : _orderDraft2.items) || [{
          quantity: '1',
          description: ''
        }]),
        _step;
      try {
        for (_iterator.s(); !(_step = _iterator.n()).done;) {
          var item = _step.value;
          var row = addItem();
          row.querySelector('[name=quantity]').value = item.quantity;
          row.querySelector('[name=description]').value = item.description;
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
    _discardDraft = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee12() {
      var _orderDraft3;
      var owner, version, files, _t11, _t12;
      return _regenerator().w(function (_context13) {
        while (1) switch (_context13.p = _context13.n) {
          case 0:
            if (!busy) {
              _context13.n = 1;
              break;
            }
            return _context13.a(2);
          case 1:
            if (discardDraftArmed) {
              _context13.n = 2;
              break;
            }
            discardDraftArmed = true;
            render();
            return _context13.a(2);
          case 2:
            owner = draftOwner, version = sessionVersion, files = selectedOrderFiles;
            captureDraft();
            if (!((_orderDraft3 = orderDraft) !== null && _orderDraft3 !== void 0 && _orderDraft3.cloudUpdatedAt)) {
              _context13.n = 7;
              break;
            }
            _context13.p = 3;
            _context13.n = 4;
            return draftApi('/' + orderDraft.id + '/discard', {
              expectedUpdatedAt: orderDraft.cloudUpdatedAt
            });
          case 4:
            _context13.n = 5;
            return loadCloudDrafts();
          case 5:
            _context13.n = 7;
            break;
          case 6:
            _context13.p = 6;
            _t11 = _context13.v;
            message = _t11.message;
            render();
            return _context13.a(2);
          case 7:
            _context13.p = 7;
            localStorage.removeItem(DRAFT_KEY + owner);
            _context13.n = 9;
            break;
          case 8:
            _context13.p = 8;
            _t12 = _context13.v;
            draftNotice = 'Could not discard the saved draft. Try again.';
            render();
            return _context13.a(2);
          case 9:
            orderDraft = null;
            draftOwner = '';
            selectedOrderFiles = [];
            discardDraftArmed = false;
            view = 'orders';
            message = 'Draft discarded.';
            render();
            _context13.n = 10;
            return attachmentDb('delete', files).catch(function () {});
          case 10:
            return _context13.a(2);
        }
      }, _callee12, null, [[7, 8], [3, 6]]);
    }));
    return _discardDraft.apply(this, arguments);
  }
  function pendingOrders() {
    return outbox.owner === session.username ? outbox.queue.map(function (packet) {
      return _objectSpread(_objectSpread({}, packet.order), {}, {
        id: packet.localId,
        orderNumber: packet.orderId ? packet.order.orderNumber : 'Pending',
        status: packet.orderId ? 'uploading files' : 'waiting to sync',
        createdAt: packet.createdAt,
        attachments: packet.attachments || [],
        local: true
      });
    }) : [];
  }
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
    _pollOrderAlerts = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee13() {
      var showError,
        version,
        request,
        response,
        _result2,
        _args14 = arguments,
        _t13;
      return _regenerator().w(function (_context14) {
        while (1) switch (_context14.p = _context14.n) {
          case 0:
            showError = _args14.length > 0 && _args14[0] !== undefined ? _args14[0] : false;
            if (!(!session || document.hidden || notificationBusy)) {
              _context14.n = 1;
              break;
            }
            return _context14.a(2);
          case 1:
            version = sessionVersion, request = ++notificationRequest;
            _context14.p = 2;
            _context14.n = 3;
            return api('/notifications');
          case 3:
            response = _context14.v;
            _context14.n = 4;
            return response.json();
          case 4:
            _result2 = _context14.v;
            if (response.ok) {
              _context14.n = 5;
              break;
            }
            throw Error(_result2.error || 'Notifications could not be loaded.');
          case 5:
            if (!(version !== sessionVersion || request !== notificationRequest)) {
              _context14.n = 6;
              break;
            }
            return _context14.a(2);
          case 6:
            orderAlerts = _result2.notifications || [];
            notificationLoaded = true;
            notificationError = '';
            updateNotificationUI();
            _context14.n = 8;
            break;
          case 7:
            _context14.p = 7;
            _t13 = _context14.v;
            if (version === sessionVersion && request === notificationRequest && showError) {
              notificationError = _t13.message;
              updateNotificationUI();
            }
          case 8:
            return _context14.a(2);
        }
      }, _callee13, null, [[2, 7]]);
    }));
    return _pollOrderAlerts.apply(this, arguments);
  }
  function markNotifications(_x6) {
    return _markNotifications.apply(this, arguments);
  }
  function _markNotifications() {
    _markNotifications = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee14(id) {
      var version, response, _result3, _t14;
      return _regenerator().w(function (_context15) {
        while (1) switch (_context15.p = _context15.n) {
          case 0:
            if (!(notificationBusy || !session)) {
              _context15.n = 1;
              break;
            }
            return _context15.a(2, false);
          case 1:
            version = sessionVersion;
            notificationBusy = true;
            notificationRequest++;
            notificationError = '';
            render();
            _context15.p = 2;
            _context15.n = 3;
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
            response = _context15.v;
            _context15.n = 4;
            return response.json();
          case 4:
            _result3 = _context15.v;
            if (response.ok) {
              _context15.n = 5;
              break;
            }
            throw Error(_result3.error || 'Could not mark notifications read.');
          case 5:
            if (!(version !== sessionVersion)) {
              _context15.n = 6;
              break;
            }
            return _context15.a(2, false);
          case 6:
            orderAlerts = _result3.notifications || [];
            return _context15.a(2, true);
          case 7:
            _context15.p = 7;
            _t14 = _context15.v;
            if (version === sessionVersion) notificationError = _t14.message;
            return _context15.a(2, false);
          case 8:
            _context15.p = 8;
            if (version === sessionVersion) {
              notificationBusy = false;
              render();
            }
            return _context15.f(8);
          case 9:
            return _context15.a(2);
        }
      }, _callee14, null, [[2, 7, 8, 9]]);
    }));
    return _markNotifications.apply(this, arguments);
  }
  function clearNotifications() {
    return _clearNotifications.apply(this, arguments);
  }
  function _clearNotifications() {
    _clearNotifications = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee15() {
      var version, response, _result4, _t15;
      return _regenerator().w(function (_context16) {
        while (1) switch (_context16.p = _context16.n) {
          case 0:
            if (!(notificationBusy || !session)) {
              _context16.n = 1;
              break;
            }
            return _context16.a(2);
          case 1:
            if (clearNotificationsArmed) {
              _context16.n = 2;
              break;
            }
            clearNotificationsArmed = true;
            render();
            return _context16.a(2);
          case 2:
            version = sessionVersion;
            notificationBusy = true;
            notificationRequest++;
            render();
            _context16.p = 3;
            _context16.n = 4;
            return api('/notifications/clear', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: '{}'
            });
          case 4:
            response = _context16.v;
            _context16.n = 5;
            return response.json();
          case 5:
            _result4 = _context16.v;
            if (response.ok) {
              _context16.n = 6;
              break;
            }
            throw Error(_result4.error || 'Notifications could not be cleared.');
          case 6:
            if (!(version !== sessionVersion)) {
              _context16.n = 7;
              break;
            }
            return _context16.a(2);
          case 7:
            orderAlerts = _result4.notifications || [];
            clearNotificationsArmed = false;
            notificationError = '';
            _context16.n = 9;
            break;
          case 8:
            _context16.p = 8;
            _t15 = _context16.v;
            if (version === sessionVersion) notificationError = _t15.message;
          case 9:
            _context16.p = 9;
            if (version === sessionVersion) {
              notificationBusy = false;
              render();
            }
            return _context16.f(9);
          case 10:
            return _context16.a(2);
        }
      }, _callee15, null, [[3, 8, 9, 10]]);
    }));
    return _clearNotifications.apply(this, arguments);
  }
  function notificationTarget(item) {
    var link = item.link || item.kind;
    return link === 'orders' && can('site.orders.view') ? 'orders' : link === 'cnc' && can('site.cnc.view') ? 'cnc' : link === 'support' ? 'support' : link === 'settings' ? 'settings' : '';
  }
  function openNotification(_x7) {
    return _openNotification.apply(this, arguments);
  }
  function _openNotification() {
    _openNotification = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee16(id) {
      var item, version, target, _t16;
      return _regenerator().w(function (_context17) {
        while (1) switch (_context17.n) {
          case 0:
            item = orderAlerts.find(function (value) {
              return value.id === id;
            }), version = sessionVersion;
            if (!(!item || notificationBusy)) {
              _context17.n = 1;
              break;
            }
            return _context17.a(2);
          case 1:
            _t16 = !item.read;
            if (!_t16) {
              _context17.n = 3;
              break;
            }
            _context17.n = 2;
            return markNotifications(id);
          case 2:
            _t16 = !_context17.v;
          case 3:
            if (!_t16) {
              _context17.n = 4;
              break;
            }
            return _context17.a(2);
          case 4:
            if (!(version !== sessionVersion)) {
              _context17.n = 5;
              break;
            }
            return _context17.a(2);
          case 5:
            target = notificationTarget(item);
            if (target) {
              view = target;
              message = '';
              if (target === 'support') supportSelected = '';
              render();
            }
          case 6:
            return _context17.a(2);
        }
      }, _callee16);
    }));
    return _openNotification.apply(this, arguments);
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
    return "<section class=\"site-notifications\"><header class=\"site-notifications-header\"><div class=\"site-notifications-heading\"><span class=\"site-notifications-heading-icon\">".concat(BELL_ICON, "</span><div><h2>Notifications</h2><p>Schedule changes, support updates and important account activity</p></div></div></header><div class=\"site-notifications-tools\"><span>").concat(unread ? unread + ' unread' : "You’re up to date", "</span><div class=\"actions\">").concat(unread ? "<button data-read-all-alerts ".concat(notificationBusy ? 'disabled' : '', ">Mark all as read</button>") : '').concat(orderAlerts.length ? "<button class=\"site-notifications-clear\" data-clear-notifications ".concat(notificationBusy ? 'disabled' : '', ">").concat(clearNotificationsArmed ? 'Yes, clear all' : 'Clear', "</button>") : '', "</div></div>").concat(notificationError ? "<div class=\"notice\" role=\"alert\">".concat(esc(notificationError), " <button data-refresh-notifications>Retry</button></div>") : '').concat(clearNotificationsArmed ? "<div class=\"notice\" role=\"alert\">Permanently remove all notifications from your account? This cannot be undone. <button data-keep-notifications>Keep notifications</button></div>" : '', "<div class=\"site-notifications-list\">").concat(orderAlerts.map(function (item) {
      return "<button type=\"button\" class=\"site-notification-card ".concat(item.read ? 'is-read' : 'is-unread', " ").concat(item.priority === 'urgent' ? 'is-urgent' : item.priority === 'important' ? 'is-important' : '', "\" data-open-notification=\"").concat(esc(item.id), "\" ").concat(notificationBusy ? 'disabled' : '', "><span class=\"site-notification-title\"><strong>").concat(esc(item.title), "</strong>").concat(!item.read ? '<span class="site-unread-dot" aria-label="Unread"></span>' : '', "</span><span class=\"site-notification-message\">").concat(esc(item.message), "</span><time>").concat(esc(new Date(item.createdAt).toLocaleString('en-AU', {
        timeZone: 'Australia/Brisbane'
      })), "</time></button>");
    }).join('') || "<div class=\"card empty ".concat(!notificationLoaded && !notificationError ? 'site-notifications-loading' : '', "\">").concat(notificationLoaded ? 'No notifications yet.' : notificationError ? 'Connect and retry to load notifications.' : 'Loading notifications…', "</div>"), "</div></section>");
  }
  function statusConflictView() {
    if (!statusConflict) return '';
    var _statusConflict = statusConflict,
      order = _statusConflict.order,
      status = _statusConflict.status;
    return "<section class=\"card\" role=\"alert\"><h3>Order changed</h3><p>#".concat(esc(order.orderNumber), " was updated by ").concat(esc(order.updatedBy || 'another user'), ". Current status: <strong>").concat(esc(order.status), "</strong>. Your choice: <strong>").concat(esc(status), "</strong>.</p>").concat(deliverySummary(order), "<p>Your status change has not been saved.</p>").concat(order.status === 'completed' ? '<p>Completed order status is locked and cannot be changed.</p>' : '<button data-retry-status>Apply my status to this version</button>', "<button data-cancel-status>Keep latest status</button></section>");
  }
  function changeOrderStatus(_x8, _x9) {
    return _changeOrderStatus.apply(this, arguments);
  }
  function _changeOrderStatus() {
    _changeOrderStatus = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee17(order, status) {
      var version, response, _result5, _t17;
      return _regenerator().w(function (_context18) {
        while (1) switch (_context18.p = _context18.n) {
          case 0:
            if (!(statusSaving || isPanelOrder(order) || order.status === 'completed' || status === order.status)) {
              _context18.n = 1;
              break;
            }
            return _context18.a(2);
          case 1:
            statusSaving = true;
            root.querySelectorAll('[data-status],[data-apply-status],[data-retry-status]').forEach(function (control) {
              return control.disabled = true;
            });
            version = sessionVersion;
            _context18.p = 2;
            _context18.n = 3;
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
            response = _context18.v;
            _context18.n = 4;
            return response.json();
          case 4:
            _result5 = _context18.v;
            if (!(version !== sessionVersion)) {
              _context18.n = 5;
              break;
            }
            return _context18.a(2);
          case 5:
            if (!(response.status === 409 && _result5.code === 'ORDER_CONFLICT')) {
              _context18.n = 6;
              break;
            }
            statusConflict = {
              order: _result5.order,
              status: status
            };
            render();
            return _context18.a(2);
          case 6:
            if (response.ok) {
              _context18.n = 7;
              break;
            }
            throw Error(_result5.error || 'Status update failed');
          case 7:
            statusConflict = null;
            delete statusChoices[order.id];
            message = status === 'completed' ? 'Order completed and ready for dispatch.' : 'Order status updated.';
            _context18.n = 8;
            return refresh();
          case 8:
            _context18.n = 10;
            break;
          case 9:
            _context18.p = 9;
            _t17 = _context18.v;
            if (version === sessionVersion) message = _t17.message;
          case 10:
            _context18.p = 10;
            if (version === sessionVersion) {
              statusSaving = false;
              render();
            }
            return _context18.f(10);
          case 11:
            return _context18.a(2);
        }
      }, _callee17, null, [[2, 9, 10, 11]]);
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
      active = !order.local && ['submitted', 'approved', 'ordered', 'in_stock'].includes(order.status);
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
    }))).join(' ').toLowerCase().includes(query)) && (!orderProject || String(order.projectId || order.project) === orderProject) && (!orderRequester || (order.requestedBy || (order.local ? session.username : '')) === orderRequester) && (!orderDelivery || (orderDelivery === 'overdue' ? info.overdue : orderDelivery === 'week' ? !order.local && !['completed', 'cancelled'].includes(order.status) && info.date >= today && info.date <= end.toISOString().slice(0, 10) : !order.scheduledDeliveryDate));
  }
  function orderDates(order) {
    return "<div class=\"site-order-dates\"><div><small>Requested delivery</small><strong>".concat(esc(order.requestedDeliveryDate ? formatDate(order.requestedDeliveryDate) : 'Not set'), "</strong>").concat(order.scheduledDeliveryDate ? "<small>Confirmed: ".concat(esc(formatDate(order.scheduledDeliveryDate)), "</small>") : '', "</div><div><small>Completed</small><strong>").concat(esc(order.status === 'completed' ? order.completedAt ? new Date(order.completedAt).toLocaleDateString('en-AU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'Australia/Brisbane'
    }) : 'Date unavailable' : 'Not completed'), "</strong></div></div>");
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
    }).map(function (_ref2) {
      var _ref3 = _slicedToArray(_ref2, 2),
        id = _ref3[0],
        name = _ref3[1];
      return "<option value=\"".concat(esc(id), "\" ").concat(orderProject === id ? 'selected' : '', ">").concat(esc(name), "</option>");
    }).join(''), "</select></label><label>Requested by<select data-order-requester><option value=\"\">Everyone</option>").concat(requesters.map(function (name) {
      return "<option value=\"".concat(esc(name), "\" ").concat(orderRequester === name ? 'selected' : '', ">").concat(esc(name), "</option>");
    }).join(''), "</select></label><label>Delivery<select data-order-delivery>").concat([['', 'Any delivery'], ['week', 'Due this week'], ['overdue', 'Overdue'], ['unconfirmed', 'Not confirmed']].map(function (_ref4) {
      var _ref5 = _slicedToArray(_ref4, 2),
        id = _ref5[0],
        name = _ref5[1];
      return "<option value=\"".concat(id, "\" ").concat(orderDelivery === id ? 'selected' : '', ">").concat(name, "</option>");
    }).join(''), "</select></label></div><div class=\"actions\"><button data-my-orders>My orders</button><button data-due-week>Due this week</button><button data-overdue>Overdue</button><button data-clear-order-filters>Clear filters</button></div><small>Delivery dates use Brisbane time. Confirmed dates take priority; otherwise requested dates apply.</small></section>");
  }
  function loadOrderHistory(_x0) {
    return _loadOrderHistory.apply(this, arguments);
  }
  function _loadOrderHistory() {
    _loadOrderHistory = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee18(id) {
      var version, response, _result6, _t18;
      return _regenerator().w(function (_context19) {
        while (1) switch (_context19.p = _context19.n) {
          case 0:
            version = sessionVersion;
            historyState = {
              id: id,
              loading: true
            };
            render();
            _context19.p = 1;
            _context19.n = 2;
            return api('/orders/' + encodeURIComponent(id) + '/history');
          case 2:
            response = _context19.v;
            _context19.n = 3;
            return response.json();
          case 3:
            _result6 = _context19.v;
            if (response.ok) {
              _context19.n = 4;
              break;
            }
            throw Error(_result6.error || 'History could not be loaded.');
          case 4:
            if (!(version !== sessionVersion || selectedOrderId !== id)) {
              _context19.n = 5;
              break;
            }
            return _context19.a(2);
          case 5:
            historyState = {
              id: id,
              events: _result6.events || []
            };
            _context19.n = 8;
            break;
          case 6:
            _context19.p = 6;
            _t18 = _context19.v;
            if (!(version !== sessionVersion || selectedOrderId !== id)) {
              _context19.n = 7;
              break;
            }
            return _context19.a(2);
          case 7:
            historyState = {
              id: id,
              error: _t18.message
            };
          case 8:
            if (view === 'order') render();
          case 9:
            return _context19.a(2);
        }
      }, _callee18, null, [[1, 6]]);
    }));
    return _loadOrderHistory.apply(this, arguments);
  }
  function orderTimeline(order) {
    if (order.local) return '<h3>Order history</h3><p>Saved on this device; waiting to finish syncing.</p>';
    var state = historyState.id === order.id ? historyState : {};
    return "<h3>Order history</h3>".concat(state.loading ? '<p>Loading history…</p>' : state.error ? "<p>".concat(esc(state.error), "</p><button data-history-retry>Retry history</button>") : state.events ? "<ol>".concat(state.events.map(function (event) {
      return "<li style=\"padding:8px 0\"><strong>".concat(esc(event.label), "</strong>").concat(event.status ? " \xB7 ".concat(esc(event.status)) : '').concat(event.fileName ? " \xB7 ".concat(esc(event.fileName)) : '', "<br><small>").concat(esc(new Date(event.at).toLocaleString('en-AU', {
        timeZone: 'Australia/Brisbane'
      })), " (Brisbane) \xB7 ").concat(esc(event.actor || 'Unknown user'), "</small></li>");
    }).join(''), "</ol><small>Recorded order events. Older changes may not have a detailed audit entry.</small>") : '<button data-history-retry>Load history</button>');
  }
  var receiptDraft = null,
    receiptConflict = null,
    receiptSaving = false;
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
  function captureReceipt() {
    var _session5;
    var form = root.querySelector('[data-receipt-form]');
    if (!form || !receiptDraft || receiptDraft.owner !== ((_session5 = session) === null || _session5 === void 0 ? void 0 : _session5.username)) return;
    receiptDraft.lines = _toConsumableArray(form.querySelectorAll('[data-receipt-line]')).map(function (row) {
      var _row$querySelector;
      return {
        index: Number(row.dataset.receiptLine),
        accepted: row.querySelector('[name=accepted]').value,
        damaged: row.querySelector('[name=damaged]').value,
        missing: row.querySelector('[name=missing]').value,
        replacementIssueId: ((_row$querySelector = row.querySelector('[name=replacementIssueId]')) === null || _row$querySelector === void 0 ? void 0 : _row$querySelector.value) || ''
      };
    });
    receiptDraft.notes = form.querySelector('[name=receiptNotes]').value;
    receiptDraft.attachmentIds = _toConsumableArray(form.querySelectorAll('[data-receipt-file]:checked')).map(function (input) {
      return input.value;
    });
    try {
      localStorage.setItem(receiptKey(receiptDraft.orderId), JSON.stringify(receiptDraft));
    } catch (_unused2) {}
  }
  function deliveryReceipts(order) {
    if (order.local) return '';
    var totals = receiptTotals(order),
      allowed = session.isAdmin || can('site.orders.manage') || can('site.orders.create') && order.requestedBy === session.username;
    if (allowed && (!receiptDraft || receiptDraft.orderId !== order.id || receiptDraft.owner !== session.username)) {
      var _saved;
      receiptConflict = null;
      var saved;
      try {
        saved = JSON.parse(localStorage.getItem(receiptKey(order.id)) || 'null');
      } catch (_unused3) {}
      receiptDraft = ((_saved = saved) === null || _saved === void 0 ? void 0 : _saved.owner) === session.username && saved.orderId === order.id ? saved : {
        owner: session.username,
        orderId: order.id,
        id: crypto.randomUUID(),
        expectedUpdatedAt: order.updatedAt || order.createdAt || '',
        lines: [],
        notes: '',
        attachmentIds: []
      };
      if ((order.receipts || []).some(function (receipt) {
        return receipt.id === receiptDraft.id;
      })) {
        try {
          localStorage.removeItem(receiptKey(order.id));
        } catch (_unused4) {}
        receiptDraft = {
          owner: session.username,
          orderId: order.id,
          id: crypto.randomUUID(),
          expectedUpdatedAt: order.updatedAt || order.createdAt || '',
          lines: [],
          notes: '',
          attachmentIds: []
        };
      }
    }
    var history = (order.receipts || []).map(function (receipt) {
      return "<article style=\"border-top:1px solid #ddd;padding:12px 0\"><strong>".concat(esc(new Date(receipt.at).toLocaleString('en-AU')), " \xB7 ").concat(esc(receipt.by), "</strong>").concat(receipt.lines.filter(function (line) {
        return line.accepted || line.damaged || line.missing;
      }).map(function (line) {
        return "<p>".concat(esc(line.description), ": ").concat(esc(line.accepted), " accepted \xB7 ").concat(esc(line.damaged), " damaged \xB7 ").concat(esc(line.missing), " missing</p>");
      }).join(''), "<p style=\"white-space:pre-wrap\">").concat(esc(receipt.notes), "</p>").concat((receipt.amendments || []).map(function (amendment) {
        return "<details><summary>Corrected by ".concat(esc(amendment.by), " \xB7 ").concat(esc(new Date(amendment.at).toLocaleString('en-AU')), "</summary><p>").concat(esc(amendment.reason), "</p>").concat(amendment.after.map(function (line) {
          var old = amendment.before.find(function (item) {
            return item.index === line.index;
          });
          return "<p>".concat(esc(line.description), ": accepted ").concat(esc(old.accepted), " \u2192 ").concat(esc(line.accepted), ", damaged ").concat(esc(old.damaged), " \u2192 ").concat(esc(line.damaged), ", missing ").concat(esc(old.missing), " \u2192 ").concat(esc(line.missing), "</p>");
        }).join(''), "</details>");
      }).join('')).concat(receipt.attachmentIds.map(function (id) {
        var file = (order.attachments || []).find(function (file) {
          return file.id === id;
        });
        return file ? "<button type=\"button\" data-order-file=\"".concat(esc(id), "\" data-order-id=\"").concat(esc(order.id), "\">").concat(esc(file.name), "</button>") : '';
      }).join(''), "</article>");
    }).join('');
    return "<section><h3>Delivery issues</h3>".concat((order.deliveryIssues || []).map(function (issue) {
      return "<p><strong>".concat(esc(issue.description), " \xB7 ").concat(esc(issue.status.replace(/_/g, ' ')), "</strong><br>").concat(esc(issue.received), " / ").concat(esc(issue.quantity), " replacements received \xB7 Assigned to ").concat(esc(issue.assignedTo || 'Unassigned')).concat(issue.replacementDate ? ' · Due ' + esc(formatDate(issue.replacementDate)) : '', "<br>").concat(esc(issue.notes), " ").concat(esc(issue.resolutionNote), "</p>");
    }).join('') || '<p>No delivery issues.</p>', "<h3>Delivery receipts</h3>").concat(totals.map(function (line) {
      return "<p>".concat(esc(line.description), ": <strong>").concat(esc(line.accepted), " / ").concat(esc(line.quantity), " accepted \xB7 ").concat(esc(line.outstanding), " outstanding</strong></p>");
    }).join(''), "<p>Damaged and missing items remain outstanding. Record quantities for this delivery only.</p>").concat(history || '<p>No deliveries recorded.</p>').concat(allowed && order.status !== 'cancelled' && totals.some(function (line) {
      return line.outstanding > 0;
    }) ? "<details ".concat(receiptConflict ? 'open' : '', "><summary>Record a delivery</summary><form data-receipt-form>").concat(totals.map(function (line) {
      var draft = receiptDraft.lines.find(function (item) {
        return item.index === line.index;
      }) || {};
      return "<fieldset data-receipt-line=\"".concat(line.index, "\" style=\"margin:12px 0\"><legend>").concat(esc(line.description), " \xB7 ").concat(esc(line.outstanding), " outstanding</legend><div class=\"grid\">").concat(['accepted', 'damaged', 'missing'].map(function (key) {
        return "<label>".concat(key[0].toUpperCase() + key.slice(1), "<input name=\"").concat(key, "\" type=\"number\" min=\"0\" max=\"").concat(line.outstanding, "\" step=\"any\" value=\"").concat(esc(draft[key] || '0'), "\" required></label>");
      }).join(''), "</div><label>Replacement for<select name=\"replacementIssueId\"><option value=\"\">Normal delivery</option>").concat((order.deliveryIssues || []).filter(function (issue) {
        return issue.index === line.index && issue.status !== 'resolved' && issue.remaining > 0;
      }).map(function (issue) {
        return "<option value=\"".concat(esc(issue.id), "\" ").concat(draft.replacementIssueId === issue.id ? 'selected' : '', ">").concat(esc(issue.quantity), " reported \xB7 ").concat(esc(issue.remaining), " awaiting replacement \xB7 ").concat(esc(formatDate(issue.reportedAt.slice(0, 10))), "</option>");
      }).join(''), "</select></label></fieldset>");
    }).join(''), "<label>Delivery notes<textarea name=\"receiptNotes\" maxlength=\"1000\">").concat(esc(receiptDraft.notes), "</textarea></label><p>Upload delivery photos using Files and photos above, then select them here.</p>").concat((order.attachments || []).map(function (file) {
      return "<label style=\"display:block\"><input style=\"width:auto\" type=\"checkbox\" data-receipt-file value=\"".concat(esc(file.id), "\" ").concat(receiptDraft.attachmentIds.includes(file.id) ? 'checked' : '', "> ").concat(esc(file.name), "</label>");
    }).join('')).concat(receiptConflict ? '<p role="alert">This order changed. Your entries are retained. Review the latest quantities before saving.</p><button type="button" data-review-receipt>Review latest quantities</button>' : '', "<button type=\"submit\" ").concat(receiptSaving || receiptConflict ? 'disabled' : '', ">").concat(receiptSaving ? 'Saving…' : 'Record delivery', "</button><p data-receipt-error role=\"alert\"></p></form></details>") : '', "</section>");
  }
  function saveReceipt(_x1) {
    return _saveReceipt.apply(this, arguments);
  }
  function _saveReceipt() {
    _saveReceipt = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee19(event) {
      var version, draft, _root$querySelector42, response, _result7, node, button, _t19;
      return _regenerator().w(function (_context20) {
        while (1) switch (_context20.p = _context20.n) {
          case 0:
            event.preventDefault();
            if (!receiptSaving) {
              _context20.n = 1;
              break;
            }
            return _context20.a(2);
          case 1:
            captureReceipt();
            version = sessionVersion, draft = receiptDraft;
            receiptSaving = true;
            event.currentTarget.querySelector('[type=submit]').disabled = true;
            _context20.p = 2;
            _context20.n = 3;
            return api('/orders/' + draft.orderId + '/receipts', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(draft)
            });
          case 3:
            response = _context20.v;
            _context20.n = 4;
            return response.json();
          case 4:
            _result7 = _context20.v;
            if (!(version !== sessionVersion)) {
              _context20.n = 5;
              break;
            }
            return _context20.a(2);
          case 5:
            if (!(response.status === 409 && _result7.code === 'ORDER_CONFLICT')) {
              _context20.n = 6;
              break;
            }
            receiptConflict = _result7.order;
            render();
            return _context20.a(2);
          case 6:
            if (response.ok) {
              _context20.n = 7;
              break;
            }
            throw Error(_result7.error || 'Delivery could not be recorded.');
          case 7:
            orders = orders.map(function (order) {
              return order.id === _result7.order.id ? _result7.order : order;
            });
            try {
              localStorage.removeItem(receiptKey(draft.orderId));
            } catch (_unused9) {}
            (_root$querySelector42 = root.querySelector('[data-receipt-form]')) === null || _root$querySelector42 === void 0 || _root$querySelector42.remove();
            receiptDraft = null;
            receiptConflict = null;
            message = 'Delivery recorded. Order managers have been notified.';
            render();
            _context20.n = 9;
            break;
          case 8:
            _context20.p = 8;
            _t19 = _context20.v;
            if (version === sessionVersion) {
              node = root.querySelector('[data-receipt-error]');
              if (node) node.textContent = _t19.message;
            }
          case 9:
            _context20.p = 9;
            receiptSaving = false;
            button = root.querySelector('[data-receipt-form] [type=submit]');
            if (button) button.disabled = !!receiptConflict;
            return _context20.f(9);
          case 10:
            return _context20.a(2);
        }
      }, _callee19, null, [[2, 8, 9, 10]]);
    }));
    return _saveReceipt.apply(this, arguments);
  }
  function wireReceipts() {
    var _root$querySelector6;
    var form = root.querySelector('[data-receipt-form]');
    if (form) {
      form.onsubmit = saveReceipt;
      form.addEventListener('input', captureReceipt);
      form.addEventListener('change', captureReceipt);
    }
    (_root$querySelector6 = root.querySelector('[data-review-receipt]')) === null || _root$querySelector6 === void 0 || _root$querySelector6.addEventListener('click', function () {
      var _root$querySelector7;
      captureReceipt();
      orders = orders.map(function (order) {
        return order.id === receiptConflict.id ? receiptConflict : order;
      });
      receiptDraft.expectedUpdatedAt = receiptConflict.updatedAt || receiptConflict.createdAt || '';
      receiptConflict = null;
      render();
      (_root$querySelector7 = root.querySelector('[data-receipt-form]')) === null || _root$querySelector7 === void 0 || (_root$querySelector7 = _root$querySelector7.closest('details')) === null || _root$querySelector7 === void 0 || _root$querySelector7.setAttribute('open', '');
    });
  }
  function orderDetails() {
    var _order$items;
    var order = [].concat(_toConsumableArray(pendingOrders()), _toConsumableArray(orders)).find(function (order) {
      return order.id === selectedOrderId;
    });
    if (!order) return "<div class=\"toolbar\"><h2>Order unavailable</h2><button data-order-results>".concat(orderReturnView === 'order-search' ? 'Back to search results' : 'Back to orders', "</button></div><p>Refresh the order list and try again.</p>");
    var field = function field(label, value) {
      return "<div><small>".concat(esc(label), "</small><div style=\"white-space:pre-wrap;overflow-wrap:anywhere\">").concat(esc(value || 'Not provided'), "</div></div>");
    };
    var delivery = function delivery(date, time) {
      return date ? formatDate(date) + (time ? ' · ' + time : '') : 'Not confirmed';
    };
    return "<div class=\"toolbar\"><div><h2 style=\"margin:0\">Order #".concat(esc(order.orderNumber), "</h2><small>").concat(esc(order.project), " \xB7 ").concat(esc(order.status), "</small></div><button data-order-results>").concat(orderReturnView === 'order-search' ? 'Back to search results' : 'Back to orders', "</button></div>").concat(message ? "<div class=\"notice\">".concat(esc(message), "</div>") : '', "<section class=\"card\"><h3>Order information</h3><div class=\"grid\">").concat(field('Order type', order.orderType === 'Other' && order.orderTypeOther ? 'Other: ' + order.orderTypeOther : order.orderType)).concat(field('Requested by', order.requestedBy || session.username)).concat(field('Site contact', order.siteContact)).concat(field('Phone', order.phone)).concat(field('Requested delivery', delivery(order.requestedDeliveryDate, order.requestedDeliveryTime))).concat(field('Confirmed delivery', delivery(order.scheduledDeliveryDate, order.scheduledDeliveryTime)), "<div class=\"wide\">").concat(field('Location / notes', order.locationNotes), "</div></div>").concat(deliverySummary(order), "<h3>Items (").concat(((_order$items = order.items) === null || _order$items === void 0 ? void 0 : _order$items.length) || 0, ")</h3>").concat((order.items || []).map(function (item) {
      return "<div style=\"display:flex;gap:16px;padding:12px 0;border-bottom:1px solid #e2e8f0\"><strong style=\"min-width:48px\">".concat(esc(item.quantity), " \xD7</strong><span style=\"overflow-wrap:anywhere\">").concat(esc(item.description), "</span></div>");
    }).join('')).concat(order.local ? "<h3>Files waiting to upload</h3>".concat((order.attachments || []).map(function (file) {
      return "<p>".concat(esc(file.name), "</p>");
    }).join('') || '<p>No files attached.</p>', "<p>This request is saved on this device. It is not fully synced yet.</p>") : orderAttachmentControls(order)).concat(!order.local ? "<div class=\"actions\"><button data-export=\"pdf\" data-order-id=\"".concat(esc(order.id), "\">PDF</button><button data-export=\"xlsx\" data-order-id=\"").concat(esc(order.id), "\">Excel</button></div>") : '').concat(deliveryReceipts(order)).concat(orderTimeline(order), "</section>");
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
          var _iterator2 = _createForOfIteratorHelper(files),
            _step2;
          try {
            for (_iterator2.s(); !(_step2 = _iterator2.n()).done;) {
              var item = _step2.value;
              if (action === 'put') store.put(item.file, item.id);else store.delete(item.id);
            }
          } catch (err) {
            _iterator2.e(err);
          } finally {
            _iterator2.f();
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
  function chooseOrderFiles(_x10) {
    return _chooseOrderFiles.apply(this, arguments);
  }
  function _chooseOrderFiles() {
    _chooseOrderFiles = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee20(event) {
      var owner, version, _session15, _selectedOrderFiles, added, errorNode, _session16, _errorNode, _t20;
      return _regenerator().w(function (_context21) {
        while (1) switch (_context21.p = _context21.n) {
          case 0:
            if (!busy) {
              _context21.n = 1;
              break;
            }
            return _context21.a(2);
          case 1:
            captureDraft();
            owner = session.username, version = sessionVersion;
            busy = true;
            _context21.p = 2;
            added = Array.from(event.target.files || []).map(function (file) {
              return {
                id: crypto.randomUUID(),
                name: file.name,
                size: file.size,
                file: file
              };
            });
            validateOrderFiles(added, selectedOrderFiles);
            _context21.n = 3;
            return attachmentDb('put', added);
          case 3:
            if (!(sessionVersion !== version || ((_session15 = session) === null || _session15 === void 0 ? void 0 : _session15.username) !== owner)) {
              _context21.n = 4;
              break;
            }
            return _context21.a(2);
          case 4:
            (_selectedOrderFiles = selectedOrderFiles).push.apply(_selectedOrderFiles, _toConsumableArray(added));
            if (orderDraft) {
              orderDraft.attachments = selectedOrderFiles.map(function (_ref16) {
                var file = _ref16.file,
                  missing = _ref16.missing,
                  metadata = _objectWithoutProperties(_ref16, _excluded2);
                return metadata;
              });
              writeDraft();
            }
            captureDraft();
            renderSelectedOrderFiles();
            errorNode = root.querySelector('[data-file-error]');
            if (errorNode) errorNode.textContent = '';
            _context21.n = 6;
            break;
          case 5:
            _context21.p = 5;
            _t20 = _context21.v;
            _errorNode = root.querySelector('[data-file-error]');
            if (((_session16 = session) === null || _session16 === void 0 ? void 0 : _session16.username) === owner && _errorNode) _errorNode.textContent = _t20.message;
          case 6:
            _context21.p = 6;
            busy = false;
            event.target.value = '';
            return _context21.f(6);
          case 7:
            return _context21.a(2);
        }
      }, _callee20, null, [[2, 5, 6, 7]]);
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
  function queueExistingOrderFiles(_x11) {
    return _queueExistingOrderFiles.apply(this, arguments);
  }
  function _queueExistingOrderFiles() {
    _queueExistingOrderFiles = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee21(event) {
      var order, files, owner, packet, _session17, _t21;
      return _regenerator().w(function (_context22) {
        while (1) switch (_context22.p = _context22.n) {
          case 0:
            if (!busy) {
              _context22.n = 1;
              break;
            }
            return _context22.a(2);
          case 1:
            order = orders.find(function (item) {
              return item.id === event.target.dataset.attachOrder;
            });
            if (order) {
              _context22.n = 2;
              break;
            }
            return _context22.a(2);
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
              _context22.n = 3;
              break;
            }
            return _context22.a(2);
          case 3:
            owner = session.username;
            busy = true;
            _context22.p = 4;
            validateOrderFiles(files, order.attachments || []);
            if (!(outbox.queue.length && outbox.owner !== owner)) {
              _context22.n = 5;
              break;
            }
            throw Error('Sync the previous user’s saved requests first.');
          case 5:
            _context22.n = 6;
            return attachmentDb('put', files);
          case 6:
            if (!(((_session17 = session) === null || _session17 === void 0 ? void 0 : _session17.username) !== owner)) {
              _context22.n = 7;
              break;
            }
            throw Error('Your account changed. Select the files again.');
          case 7:
            packet = {
              localId: crypto.randomUUID(),
              idempotencyKey: crypto.randomUUID(),
              orderId: order.id,
              order: order,
              attachments: files.map(function (_ref17) {
                var file = _ref17.file,
                  metadata = _objectWithoutProperties(_ref17, _excluded3);
                return metadata;
              }),
              createdAt: new Date().toISOString()
            };
            outbox.owner = owner;
            outbox.queue.push(packet);
            saveOutbox();
            event.target.value = '';
            message = 'Files saved on this device, waiting to upload.';
            _context22.n = 9;
            break;
          case 8:
            _context22.p = 8;
            _t21 = _context22.v;
            if (packet) outbox.queue = outbox.queue.filter(function (item) {
              return item !== packet;
            });
            message = _t21.message;
          case 9:
            _context22.p = 9;
            busy = false;
            render();
            return _context22.f(9);
          case 10:
            void flush();
          case 11:
            return _context22.a(2);
        }
      }, _callee21, null, [[4, 8, 9, 10]]);
    }));
    return _queueExistingOrderFiles.apply(this, arguments);
  }
  function downloadOrderFile(_x12) {
    return _downloadOrderFile.apply(this, arguments);
  }
  function _downloadOrderFile() {
    _downloadOrderFile = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee22(button) {
      var response, _result8, url, link, _t22;
      return _regenerator().w(function (_context23) {
        while (1) switch (_context23.p = _context23.n) {
          case 0:
            button.disabled = true;
            _context23.p = 1;
            _context23.n = 2;
            return api('/orders/' + button.dataset.orderId + '/attachments/' + button.dataset.orderFile);
          case 2:
            response = _context23.v;
            _context23.n = 3;
            return response.json();
          case 3:
            _result8 = _context23.v;
            if (response.ok) {
              _context23.n = 4;
              break;
            }
            throw Error(_result8.error || 'Attachment could not be downloaded.');
          case 4:
            url = URL.createObjectURL(new Blob([Uint8Array.from(atob(_result8.file.data), function (c) {
              return c.charCodeAt(0);
            })], {
              type: 'application/octet-stream'
            })), link = document.createElement('a');
            link.href = url;
            link.download = _result8.file.name;
            document.body.append(link);
            link.click();
            link.remove();
            setTimeout(function () {
              return URL.revokeObjectURL(url);
            }, 60000);
            _context23.n = 6;
            break;
          case 5:
            _context23.p = 5;
            _t22 = _context23.v;
            message = _t22.message;
            render();
          case 6:
            _context23.p = 6;
            button.disabled = false;
            return _context23.f(6);
          case 7:
            return _context23.a(2);
        }
      }, _callee22, null, [[1, 5, 6, 7]]);
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
  if (((_session6 = session) === null || _session6 === void 0 ? void 0 : _session6.expiresAt) <= Date.now()) clearAccountState();
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
  function openDatePicker(input, trigger) {
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
  var CNC_ICON = '<svg class="nav-svg" viewBox="0 0 64 64" fill="none" aria-hidden="true"><path d="M6 42V9L10 5H25V13H14V36L10 46Z M39 5H54L58 9V42L54 46L50 36V13H39Z" fill="currentColor"/><rect x="26" y="3" width="12" height="17" rx="1.5" fill="currentColor"/><path d="M27 22H37V26H27Z M29 28H35V32H29Z" fill="currentColor"/><path d="M14 35H50L60 56V60H4V56Z" fill="currentColor"/><path d="M32 33V39" stroke="white" stroke-width="5" stroke-linecap="round"/><path d="M32 33V39" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M24 41V47H34V53H49" stroke="white" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var SETTINGS_ICON = '<svg class="nav-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
  var SUPPORT_ICON = '<svg class="nav-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 13v-2a8 8 0 0 1 16 0v2"/><path d="M4 12H3a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h2v-6Z"/><path d="M20 12h1a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-2v-6Z"/><path d="M19 18a7 7 0 0 1-5 3"/><circle cx="12.5" cy="21" r="1"/></svg>';
  function read(key, fallback) {
    try {
      return JSON.parse((key === SESSION_KEY ? sessionStorage : localStorage).getItem(key) || 'null') || fallback;
    } catch (_unused5) {
      return fallback;
    }
  }
  function saveOutbox() {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox));
  }
  function readProjects(owner) {
    var saved = read(PROJECTS_KEY, {});
    return owner && saved.owner === owner && Array.isArray(saved.projects) ? saved.projects : [];
  }
  function clearAccountState() {
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
    sessionStorage.removeItem(SESSION_KEY);
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
    orderFilter = 'active';
    cncFilter = 'all';
    cncQuery = '';
    localStorage.removeItem(PROJECTS_KEY);
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
    orderAlerts = [];
    statusConflict = null;
    statusChoices = {};
    statusSaving = false;
    historyState = {};
    orderReturnView = 'orders';
    orderQuery = '';
    orderProject = '';
    orderRequester = '';
    orderDelivery = '';
  }
  function api(_x13) {
    return _api.apply(this, arguments);
  }
  function _api() {
    _api = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee24(path) {
      var _session18;
      var options,
        version,
        token,
        headers,
        current,
        response,
        json,
        _args25 = arguments;
      return _regenerator().w(function (_context25) {
        while (1) switch (_context25.n) {
          case 0:
            options = _args25.length > 1 && _args25[1] !== undefined ? _args25[1] : {};
            version = sessionVersion, token = ((_session18 = session) === null || _session18 === void 0 ? void 0 : _session18.token) || null, headers = new Headers(options.headers || {});
            if (token) headers.set('Authorization', 'Bearer ' + token);
            current = function current() {
              var _session19;
              return version === sessionVersion && token === (((_session19 = session) === null || _session19 === void 0 ? void 0 : _session19.token) || null);
            };
            _context25.n = 1;
            return fetch(API + path, _objectSpread(_objectSpread({}, options), {}, {
              headers: headers,
              cache: 'no-store',
              signal: options.signal || AbortSignal.timeout(20000)
            }));
          case 1:
            response = _context25.v;
            if (current()) {
              _context25.n = 2;
              break;
            }
            throw Error('Session changed. Please sign in again.');
          case 2:
            if (!(response.status === 401 && token)) {
              _context25.n = 3;
              break;
            }
            clearAccountState();
            message = 'Your session expired. Sign in again; saved requests remain on this device.';
            render();
            throw Error(message);
          case 3:
            // A response arriving or finishing JSON decoding after logout cannot restore old account data.
            json = response.json.bind(response);
            response.json = /*#__PURE__*/_asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee23() {
              var data;
              return _regenerator().w(function (_context24) {
                while (1) switch (_context24.n) {
                  case 0:
                    _context24.n = 1;
                    return json();
                  case 1:
                    data = _context24.v;
                    if (current()) {
                      _context24.n = 2;
                      break;
                    }
                    throw Error('Session changed. Please sign in again.');
                  case 2:
                    return _context24.a(2, data);
                }
              }, _callee23);
            }));
            return _context25.a(2, response);
        }
      }, _callee24);
    }));
    return _api.apply(this, arguments);
  }
  function login(_x14) {
    return _login.apply(this, arguments);
  }
  function _login() {
    _login = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee25(event) {
      var form, remember, response, _result9, _t23;
      return _regenerator().w(function (_context26) {
        while (1) switch (_context26.p = _context26.n) {
          case 0:
            event.preventDefault();
            if (!busy) {
              _context26.n = 1;
              break;
            }
            return _context26.a(2);
          case 1:
            busy = true;
            message = '';
            form = new FormData(event.currentTarget), remember = form.get('remember');
            render();
            _context26.p = 2;
            _context26.n = 3;
            return api('/login', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                username: form.get('username'),
                pin: form.get('pin')
              })
            });
          case 3:
            response = _context26.v;
            _context26.n = 4;
            return response.json();
          case 4:
            _result9 = _context26.v;
            if (response.ok) {
              _context26.n = 5;
              break;
            }
            throw Error(_result9.error || 'Login failed');
          case 5:
            if (!_result9.mustChangePin) {
              _context26.n = 6;
              break;
            }
            pendingSetup = {
              username: form.get('username'),
              pin: form.get('pin'),
              remember: !!remember
            };
            return _context26.a(2);
          case 6:
            session = {
              token: _result9.token,
              username: _result9.username,
              isAdmin: _result9.isAdmin,
              taskAccess: _result9.taskAccess || {},
              expiresAt: _result9.expiresAt
            };
            sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
            if (remember) localStorage.setItem(USERNAME_KEY, _result9.username);else localStorage.removeItem(USERNAME_KEY);
            _context26.n = 7;
            return refresh();
          case 7:
            _context26.n = 8;
            return flush();
          case 8:
            _context26.n = 10;
            break;
          case 9:
            _context26.p = 9;
            _t23 = _context26.v;
            message = _t23.message || 'Could not reach the server — check your connection.';
          case 10:
            _context26.p = 10;
            busy = false;
            render();
            return _context26.f(10);
          case 11:
            return _context26.a(2);
        }
      }, _callee25, null, [[2, 9, 10, 11]]);
    }));
    return _login.apply(this, arguments);
  }
  function register(_x15) {
    return _register.apply(this, arguments);
  }
  function _register() {
    _register = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee26(event) {
      var form, response, _result0, _t24;
      return _regenerator().w(function (_context27) {
        while (1) switch (_context27.p = _context27.n) {
          case 0:
            event.preventDefault();
            if (!busy) {
              _context27.n = 1;
              break;
            }
            return _context27.a(2);
          case 1:
            busy = true;
            message = '';
            form = new FormData(event.currentTarget);
            if (!(form.get('newPin') !== form.get('confirmPin'))) {
              _context27.n = 2;
              break;
            }
            busy = false;
            message = 'The new PINs do not match.';
            render();
            return _context27.a(2);
          case 2:
            _context27.p = 2;
            _context27.n = 3;
            return api('/set-pin', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                username: pendingSetup.username,
                oldPin: pendingSetup.pin,
                newPin: form.get('newPin')
              })
            });
          case 3:
            response = _context27.v;
            _context27.n = 4;
            return response.json();
          case 4:
            _result0 = _context27.v;
            if (response.ok) {
              _context27.n = 5;
              break;
            }
            throw Error(_result0.error || 'PIN could not be set');
          case 5:
            session = {
              token: _result0.token,
              username: _result0.username,
              isAdmin: _result0.isAdmin,
              taskAccess: _result0.taskAccess || {},
              expiresAt: _result0.expiresAt
            };
            sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
            if (pendingSetup.remember) localStorage.setItem(USERNAME_KEY, _result0.username);
            pendingSetup = null;
            _context27.n = 6;
            return refresh();
          case 6:
            _context27.n = 8;
            break;
          case 7:
            _context27.p = 7;
            _t24 = _context27.v;
            message = _t24.message || 'Could not reach the server.';
          case 8:
            _context27.p = 8;
            busy = false;
            render();
            return _context27.f(8);
          case 9:
            return _context27.a(2);
        }
      }, _callee26, null, [[2, 7, 8, 9]]);
    }));
    return _register.apply(this, arguments);
  }
  var can = function can(task) {
    var _session7, _session8;
    return ((_session7 = session) === null || _session7 === void 0 ? void 0 : _session7.isAdmin) || ((_session8 = session) === null || _session8 === void 0 || (_session8 = _session8.taskAccess) === null || _session8 === void 0 ? void 0 : _session8[task]) !== false;
  };
  function refresh() {
    return _refresh.apply(this, arguments);
  }
  function _refresh() {
    _refresh = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee31() {
      var version, sessionResponse, current, requests, _t27;
      return _regenerator().w(function (_context32) {
        while (1) switch (_context32.p = _context32.n) {
          case 0:
            if (session) {
              _context32.n = 1;
              break;
            }
            return _context32.a(2);
          case 1:
            version = sessionVersion;
            _context32.p = 2;
            _context32.n = 3;
            return api('/session');
          case 3:
            sessionResponse = _context32.v;
            if (!sessionResponse.ok) {
              _context32.n = 5;
              break;
            }
            _context32.n = 4;
            return sessionResponse.json();
          case 4:
            current = _context32.v;
            session = _objectSpread(_objectSpread({}, session), {}, {
              isAdmin: current.isAdmin,
              taskAccess: current.taskAccess || {}
            });
            sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
          case 5:
            requests = [can('site.orders.create') ? loadCloudDrafts() : Promise.resolve(), pollOrderAlerts(), api('/profile').then(/*#__PURE__*/function () {
              var _ref19 = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee27(response) {
                return _regenerator().w(function (_context28) {
                  while (1) switch (_context28.n) {
                    case 0:
                      if (!response.ok) {
                        _context28.n = 2;
                        break;
                      }
                      _context28.n = 1;
                      return response.json();
                    case 1:
                      profile = _context28.v.profile;
                    case 2:
                      return _context28.a(2);
                  }
                }, _callee27);
              }));
              return function (_x27) {
                return _ref19.apply(this, arguments);
              };
            }()), api('/support').then(/*#__PURE__*/function () {
              var _ref20 = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee28(response) {
                var _t25;
                return _regenerator().w(function (_context29) {
                  while (1) switch (_context29.n) {
                    case 0:
                      if (!response.ok) {
                        _context29.n = 3;
                        break;
                      }
                      _context29.n = 1;
                      return response.json();
                    case 1:
                      _t25 = _context29.v.tickets;
                      if (_t25) {
                        _context29.n = 2;
                        break;
                      }
                      _t25 = [];
                    case 2:
                      supportTickets = _t25;
                    case 3:
                      return _context29.a(2);
                  }
                }, _callee28);
              }));
              return function (_x28) {
                return _ref20.apply(this, arguments);
              };
            }()), can('site.orders.view') ? api('/orders').then(/*#__PURE__*/function () {
              var _ref21 = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee29(response) {
                var _result1;
                return _regenerator().w(function (_context30) {
                  while (1) switch (_context30.n) {
                    case 0:
                      if (!response.ok) {
                        _context30.n = 2;
                        break;
                      }
                      _context30.n = 1;
                      return response.json();
                    case 1:
                      _result1 = _context30.v;
                      orders = _result1.orders || [];
                      orderTypes = Array.isArray(_result1.orderTypes) ? _result1.orderTypes : [].concat(DEFAULT_ORDER_TYPES);
                      projects = (_result1.projectRecords || (_result1.projects || []).map(function (name) {
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
                      localStorage.setItem(PROJECTS_KEY, JSON.stringify({
                        owner: session.username,
                        projects: projects,
                        orderTypes: orderTypes
                      }));
                    case 2:
                      return _context30.a(2);
                  }
                }, _callee29);
              }));
              return function (_x29) {
                return _ref21.apply(this, arguments);
              };
            }()) : Promise.resolve(), can('site.cnc.view') ? api('/site/cnc').then(/*#__PURE__*/function () {
              var _ref22 = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee30(response) {
                var _t26;
                return _regenerator().w(function (_context31) {
                  while (1) switch (_context31.n) {
                    case 0:
                      if (!response.ok) {
                        _context31.n = 3;
                        break;
                      }
                      _context31.n = 1;
                      return response.json();
                    case 1:
                      _t26 = _context31.v.cncPanels;
                      if (_t26) {
                        _context31.n = 2;
                        break;
                      }
                      _t26 = [];
                    case 2:
                      cncPanels = _t26;
                    case 3:
                      return _context31.a(2);
                  }
                }, _callee30);
              }));
              return function (_x30) {
                return _ref22.apply(this, arguments);
              };
            }()) : Promise.resolve()];
            _context32.n = 6;
            return Promise.all(requests);
          case 6:
            _context32.n = 8;
            break;
          case 7:
            _context32.p = 7;
            _t27 = _context32.v;
            if (version === sessionVersion) message = 'Showing saved information. Connect to refresh.';
          case 8:
            return _context32.a(2);
        }
      }, _callee31, null, [[2, 7]]);
    }));
    return _refresh.apply(this, arguments);
  }
  function flush() {
    return _flush.apply(this, arguments);
  }
  function _flush() {
    _flush = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee32() {
      var owner, version, current, packet, response, _result10, _iterator6, _step6, metadata, file, data, _response, _result11, _t28, _t29, _t30, _t31;
      return _regenerator().w(function (_context33) {
        while (1) switch (_context33.p = _context33.n) {
          case 0:
            if (!(busy || !session || !navigator.onLine || !outbox.queue.length || outbox.owner !== session.username)) {
              _context33.n = 1;
              break;
            }
            return _context33.a(2);
          case 1:
            owner = session.username, version = sessionVersion;
            busy = true;
            render();
            current = function current() {
              var _session20;
              if (((_session20 = session) === null || _session20 === void 0 ? void 0 : _session20.username) !== owner || version !== sessionVersion) throw Error('Your account changed. Sign back in to finish uploading.');
            };
            _context33.p = 2;
          case 3:
            if (!outbox.queue.length) {
              _context33.n = 28;
              break;
            }
            current();
            packet = outbox.queue[0];
            if (packet.orderId) {
              _context33.n = 7;
              break;
            }
            _context33.n = 4;
            return api('/orders', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                idempotencyKey: packet.idempotencyKey,
                order: packet.order
              })
            });
          case 4:
            response = _context33.v;
            _context33.n = 5;
            return response.json();
          case 5:
            _result10 = _context33.v;
            current();
            if (response.ok) {
              _context33.n = 6;
              break;
            }
            throw Error(_result10.error || 'Order submission failed');
          case 6:
            packet.orderId = _result10.order.id;
            saveOutbox();
          case 7:
            _iterator6 = _createForOfIteratorHelper(packet.attachments || []);
            _context33.p = 8;
            _iterator6.s();
          case 9:
            if ((_step6 = _iterator6.n()).done) {
              _context33.n = 16;
              break;
            }
            metadata = _step6.value;
            _context33.n = 10;
            return attachmentDb('get', metadata.id);
          case 10:
            file = _context33.v;
            current();
            if (file) {
              _context33.n = 11;
              break;
            }
            throw Error('A saved attachment is unavailable on this device. The order has been submitted; add the file again.');
          case 11:
            _context33.n = 12;
            return attachmentData(file);
          case 12:
            data = _context33.v;
            current();
            _context33.n = 13;
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
          case 13:
            _response = _context33.v;
            _context33.n = 14;
            return _response.json();
          case 14:
            _result11 = _context33.v;
            current();
            if (_response.ok) {
              _context33.n = 15;
              break;
            }
            throw Error(_result11.error || 'Attachment upload failed. Retry when connected.');
          case 15:
            _context33.n = 9;
            break;
          case 16:
            _context33.n = 18;
            break;
          case 17:
            _context33.p = 17;
            _t28 = _context33.v;
            _iterator6.e(_t28);
          case 18:
            _context33.p = 18;
            _iterator6.f();
            return _context33.f(18);
          case 19:
            if (!packet.cloudDraftId) {
              _context33.n = 23;
              break;
            }
            _context33.p = 20;
            _context33.n = 21;
            return draftApi('/' + packet.cloudDraftId + '/discard', {
              expectedUpdatedAt: packet.cloudDraftVersion
            });
          case 21:
            _context33.n = 23;
            break;
          case 22:
            _context33.p = 22;
            _t29 = _context33.v;
            if (!/not found/i.test(_t29.message)) {
              retainedDraft = true;
            }
          case 23:
            outbox.queue.shift();
            _context33.p = 24;
            saveOutbox();
            _context33.n = 26;
            break;
          case 25:
            _context33.p = 25;
            _t30 = _context33.v;
            outbox.queue.unshift(packet);
            throw _t30;
          case 26:
            _context33.n = 27;
            return attachmentDb('delete', packet.attachments || []);
          case 27:
            _context33.n = 3;
            break;
          case 28:
            message = retainedDraft ? 'Order request and attachments submitted. A saved draft was retained; check Drafts.' : 'Order request and attachments submitted.';
            _context33.n = 29;
            return refresh();
          case 29:
            _context33.n = 31;
            break;
          case 30:
            _context33.p = 30;
            _t31 = _context33.v;
            message = _t31.message || 'Request and files remain saved on this device.';
          case 31:
            _context33.p = 31;
            busy = false;
            render();
            return _context33.f(31);
          case 32:
            return _context33.a(2);
        }
      }, _callee32, null, [[24, 25], [20, 22], [8, 17, 18, 19], [2, 30, 31, 32]]);
    }));
    return _flush.apply(this, arguments);
  }
  function shell(content) {
    return "<main class=\"shell ".concat(view === 'notifications' ? 'site-notifications-screen' : '', "\"><header class=\"topbar\"><div class=\"brand\"><img src=\"/icon-512.png\" alt=\"Lennox Facades\"></div>").concat(notificationBell(), "</header><div class=\"content\">").concat(content, "</div><nav class=\"bottom-nav\">").concat(can('site.orders.view') ? "<button data-orders class=\"".concat(view === 'orders' || view === 'order-search' || view === 'new' || view === 'order' || view === 'drafts' ? 'active' : '', "\"><span class=\"nav-icon\">\u25A4</span><span>Orders</span></button>") : '').concat(can('site.cnc.view') ? "<button data-cnc class=\"".concat(view === 'cnc' ? 'active' : '', "\"><span class=\"nav-icon\">").concat(CNC_ICON, "</span><span>CNC</span></button>") : '', "<button data-support class=\"").concat(view === 'support' ? 'active' : '', "\"><span class=\"nav-icon\">").concat(SUPPORT_ICON, "</span><span>Support</span></button><button data-settings class=\"").concat(view === 'settings' ? 'active' : '', "\"><span class=\"nav-icon\">").concat(SETTINGS_ICON, "</span><span>Settings</span></button></nav></main>");
  }
  function loginScreen() {
    var _root$querySelector8, _root$querySelector9;
    var remembered = localStorage.getItem(USERNAME_KEY) || '';
    root.innerHTML = "<section class=\"login\"><div class=\"brand\"><img src=\"/icon-512.png\" alt=\"Lennox Facades\"><div><h1>Site Orders</h1></div></div><h2 class=\"login-title\"><span class=\"person\">\u2659</span>".concat(pendingSetup ? 'Set a new PIN' : 'Log in to PanelStock', "</h2>").concat(message ? "<div class=\"notice\">".concat(esc(message), "</div>") : '').concat(pendingSetup ? "<form data-register><p class=\"login-help\">Your account was created by an administrator. Choose your personal PIN.</p><label>New PIN<input name=\"newPin\" type=\"password\" inputmode=\"numeric\" pattern=\"[0-9]{6,12}\" placeholder=\"6\u201312 digits\" required></label><label>Confirm new PIN<input name=\"confirmPin\" type=\"password\" inputmode=\"numeric\" pattern=\"[0-9]{6,12}\" placeholder=\"Re-enter PIN\" required></label><button class=\"primary\" type=\"submit\" ".concat(busy ? 'disabled' : '', ">").concat(busy ? 'Saving…' : 'Set PIN & continue', "</button></form>") : "<form data-login><label>Username<input name=\"username\" autocomplete=\"username\" value=\"".concat(esc(remembered), "\" placeholder=\"e.g. Sam\" required></label><label>PIN<input name=\"pin\" type=\"password\" inputmode=\"numeric\" autocomplete=\"current-password\" placeholder=\"Your PIN\" required></label><label class=\"remember\"><input name=\"remember\" type=\"checkbox\" checked>Remember my username on this device</label><button class=\"primary\" type=\"submit\" ").concat(busy ? 'disabled' : '', ">").concat(busy ? 'Checking…' : 'Log in', "</button></form>"), "</section>");
    (_root$querySelector8 = root.querySelector('[data-login]')) === null || _root$querySelector8 === void 0 || _root$querySelector8.addEventListener('submit', login);
    (_root$querySelector9 = root.querySelector('[data-register]')) === null || _root$querySelector9 === void 0 || _root$querySelector9.addEventListener('submit', register);
  }
  function orderList() {
    var searchMode = view === 'order-search',
      pending = pendingOrders(),
      all = [].concat(_toConsumableArray(pending), _toConsumableArray(orders)),
      matches = function matches(order) {
        return orderFilter === 'active' ? order.local || ['submitted', 'ordered', 'approved', 'in_stock'].includes(order.status) : order.status === orderFilter;
      },
      shown = all.filter(function (order) {
        return matches(order) && (!searchMode || matchesOrder(order));
      }),
      active = all.filter(function (order) {
        return order.local || ['submitted', 'ordered', 'approved', 'in_stock'].includes(order.status);
      }).length,
      completed = all.filter(function (order) {
        return order.status === 'completed';
      }).length,
      cancelled = all.filter(function (order) {
        return order.status === 'cancelled';
      }).length;
    return "<div class=\"toolbar site-orders-toolbar\"><div><h2 style=\"margin:0\">".concat(searchMode ? 'Search orders' : 'Order requests', "</h2><small>").concat(orders.length, " order").concat(orders.length === 1 ? '' : 's').concat(pending.length ? " \xB7 ".concat(pending.length, " waiting to sync") : '', "</small></div><div class=\"actions\">").concat(searchMode ? '<button data-orders>Back to orders</button>' : '<button data-open-order-search>Search orders</button>').concat(can('site.orders.create') ? "<button data-open-drafts>Drafts (".concat(draftCount(), ")</button><button class=\"primary\" data-new-empty>+ New order</button>") : '', "</div></div>").concat(message ? "<div class=\"notice ".concat(message.includes('submitted') ? 'success' : '', "\">").concat(esc(message)).concat(pending.length ? " <button data-retry>".concat(busy ? 'Syncing…' : 'Retry', "</button>") : '', "</div>") : '').concat(statusConflictView()).concat(searchMode ? orderSearchControls(all) : '', "<div class=\"order-filters\"><button data-order-filter=\"active\" class=\"").concat(orderFilter === 'active' ? 'active' : '', "\"><span class=\"filter-label\">Active</span><span class=\"filter-count\">").concat(active, "</span></button><button data-order-filter=\"completed\" class=\"").concat(orderFilter === 'completed' ? 'active' : '', "\"><span class=\"filter-label\">Completed</span><span class=\"filter-count\">").concat(completed, "</span></button><button data-order-filter=\"cancelled\" class=\"").concat(orderFilter === 'cancelled' ? 'active' : '', "\"><span class=\"filter-label\">Cancelled</span><span class=\"filter-count\">").concat(cancelled, "</span></button></div><p class=\"site-order-count\" role=\"status\">").concat(shown.length, " ").concat(searchMode ? 'matching ' : '', "order").concat(shown.length === 1 ? '' : 's', "</p><section class=\"card site-order-results\">").concat(shown.map(function (order) {
      var _order$items2, _order$items3;
      return "<article class=\"order site-order-tile\"><div class=\"site-order-identity\"><strong>#".concat(esc(order.orderNumber), " \xB7 ").concat(esc(order.project), "</strong><br><small><span class=\"status\">").concat(esc(isPanelOrder(order) || order.local ? order.status : orderStatusLabel(order.status)), "</span> \xB7 ").concat(((_order$items2 = order.items) === null || _order$items2 === void 0 ? void 0 : _order$items2.length) || 0, " item").concat(((_order$items3 = order.items) === null || _order$items3 === void 0 ? void 0 : _order$items3.length) === 1 ? '' : 's', " \xB7 ").concat(esc(new Date(order.createdAt).toLocaleString('en-AU')), "</small>").concat(orderDates(order), "</div><div class=\"actions\"><button data-order-details=\"").concat(esc(order.id), "\">View order</button>").concat(order.local ? '' : "<button class=\"export-button\" data-export=\"pdf\" data-order-id=\"".concat(esc(order.id), "\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" aria-hidden=\"true\"><path d=\"M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v7H6z\"/></svg>PDF</button><button class=\"export-button\" data-export=\"xlsx\" data-order-id=\"").concat(esc(order.id), "\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" aria-hidden=\"true\"><path d=\"M14 2H6a2 2 0 0 0-2 2v16h16V8zM14 2v6h6M8 12h8M8 16h8\"/></svg>Excel</button>")).concat(can('site.orders.manage') && !order.local && !isPanelOrder(order) && order.status !== 'completed' ? "<select data-status=\"".concat(esc(order.id), "\" aria-label=\"Order status\" ").concat(statusSaving ? 'disabled' : '', ">").concat(['submitted', 'approved', 'ordered', 'in_stock', 'completed', 'cancelled'].map(function (status) {
        return "<option value=\"".concat(status, "\" ").concat((statusChoices[order.id] || order.status) === status ? 'selected' : '', ">").concat(orderStatusLabel(status), "</option>");
      }).join(''), "</select><button class=\"primary\" data-apply-status=\"").concat(esc(order.id), "\" disabled>Apply</button>") : order.status === 'completed' ? '<small class="site-order-lock">Completed · Status locked</small>' : '', "</div></article>");
    }).join('') || "<div class=\"empty\"><strong>".concat(searchMode ? 'No matching orders' : orderFilter === 'active' ? 'You’re all caught up' : orderFilter === 'completed' ? 'No completed orders yet' : 'No cancelled orders', "</strong><p>").concat(searchMode ? 'Try another search or clear your filters.' : orderFilter === 'active' ? 'New requests will appear here while they are in progress.' : orderFilter === 'completed' ? 'Orders will appear here when they are completed.' : 'Cancelled requests will appear here.', "</p>").concat(!searchMode && orderFilter === 'active' && completed ? "<button data-order-filter=\"completed\">View completed orders (".concat(completed, ")</button>") : '', "</div>"), "</section>");
  }
  function newOrder() {
    var _profile2;
    var today = dateIso(new Date()),
      defaults = ((_profile2 = profile) === null || _profile2 === void 0 ? void 0 : _profile2.siteOrderDefaults) || {};
    return "<div class=\"toolbar\"><h2 style=\"margin:0\">New site order</h2><button data-cancel>Close</button></div><p data-draft-notice role=\"status\">".concat(esc(draftNotice), "</p>").concat(discardDraftArmed ? '<div class="notice">Discard this unfinished order and its saved files? <button type="button" data-discard-draft>Yes, discard draft</button><button type="button" data-keep-draft>Keep editing</button></div>' : '').concat(message ? "<div class=\"notice\">".concat(esc(message), "</div>") : '', "<form class=\"card site-order-form\" data-order><p class=\"site-required-note\"><span class=\"site-required\" aria-hidden=\"true\">*</span> Required to submit. You can save an incomplete draft.</p><section class=\"site-form-section\"><h3>Order details</h3><div class=\"grid\"><label><span>Project <span class=\"site-required\" aria-hidden=\"true\">*</span></span><select name=\"projectId\" required><option value=\"\">Select a project</option>").concat(projects.map(function (project) {
      return "<option value=\"".concat(esc(project.id || project.name), "\">").concat(esc(project.name), "</option>");
    }).join(''), "</select></label><label><span>Order type <span class=\"site-required\" aria-hidden=\"true\">*</span></span><select name=\"orderType\" required><option value=\"\">Select an order type</option>").concat(_toConsumableArray(orderTypes).sort(function (a, b) {
      return a.localeCompare(b, 'en', {
        sensitivity: 'base'
      });
    }).map(function (type) {
      return "<option value=\"".concat(esc(type), "\">").concat(esc(type), "</option>");
    }).join(''), "</select></label><label class=\"wide\" data-other-type style=\"display:none\"><span>Please specify <span class=\"site-required\" aria-hidden=\"true\">*</span></span><input name=\"orderTypeOther\" maxlength=\"80\" placeholder=\"e.g. Safety signage\"></label></div></section><section class=\"site-form-section\"><h3>Site contact</h3><div class=\"grid\"><label><span>Site contact <span class=\"site-required\" aria-hidden=\"true\">*</span></span><input name=\"siteContact\" maxlength=\"100\" value=\"").concat(esc(defaults.siteContact || ''), "\" required></label><label><span>Phone <span class=\"site-required\" aria-hidden=\"true\">*</span></span><input name=\"phone\" type=\"tel\" inputmode=\"tel\" maxlength=\"40\" value=\"").concat(esc(defaults.phone || ''), "\" required></label></div></section><section class=\"site-form-section\"><h3>Requested delivery</h3><div class=\"site-requested-dates\"><label><span>Requested delivery date <span class=\"site-required\" aria-hidden=\"true\">*</span></span><input name=\"requestedDeliveryDate\" type=\"hidden\" value=\"").concat(today, "\"><button class=\"date-trigger\" data-date-picker type=\"button\"><span>").concat(esc(formatDate(today)), "</span><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><rect x=\"3\" y=\"5\" width=\"18\" height=\"16\" rx=\"2\"></rect><path d=\"M16 3v4M8 3v4M3 10h18\"></path><path d=\"M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01\"></path></svg></button></label><label>Requested delivery time<input name=\"requestedDeliveryTime\" type=\"time\"></label></div></section><section class=\"site-form-section\"><h3>Notes</h3><label class=\"wide\">Location / notes<textarea name=\"locationNotes\" maxlength=\"300\" rows=\"2\"></textarea></label></section>").concat(projects.length ? '' : '<div class="notice">No projects are available yet. Ask an administrator to add one on Web.</div>', "<div class=\"items\"><h3>Items <span class=\"site-required\" aria-hidden=\"true\">*</span></h3><div class=\"site-item-labels\"><span>Qty <span class=\"site-required\" aria-hidden=\"true\">*</span></span><span>Description <span class=\"site-required\" aria-hidden=\"true\">*</span></span></div></div><button data-add type=\"button\" class=\"site-add-item\">Add item</button><section class=\"order-attachments\"><h3>Files and photos</h3><small>Up to 10 files \xB7 5 MB each \xB7 25 MB total</small><div class=\"order-upload-actions\"><label class=\"order-upload-button order-upload-primary\"><svg aria-hidden=\"true\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5\"/></svg>Choose files<input aria-label=\"Choose order files\" type=\"file\" multiple data-order-files></label><label class=\"order-upload-button\"><svg aria-hidden=\"true\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M14 4h-4l-2 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-4z\"/><circle cx=\"12\" cy=\"13\" r=\"4\"/></svg>Take photo<input aria-label=\"Take order photo\" type=\"file\" accept=\"image/*\" capture=\"environment\" data-order-files></label></div><p data-file-error role=\"alert\"></p><div data-selected-order-files></div></section><div class=\"actions site-order-submit\"><button type=\"button\" data-save-cloud-draft ").concat(busy ? 'disabled' : '', ">Save draft</button><button type=\"button\" data-discard-draft>Discard draft</button><button class=\"primary\" type=\"submit\" ").concat(projects.length ? '' : 'disabled', ">Submit request</button></div></form>");
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
    var _iterator3 = _createForOfIteratorHelper(filtered),
      _step3;
    try {
      for (_iterator3.s(); !(_step3 = _iterator3.n()).done;) {
        var panel = _step3.value;
        var job = panel.jobReference || 'No job reference',
          order = panel.orderNumber || 'No order';
        if (!jobs.has(job)) jobs.set(job, new Map());
        if (!jobs.get(job).has(order)) jobs.get(job).set(order, []);
        jobs.get(job).get(order).push(panel);
      }
    } catch (err) {
      _iterator3.e(err);
    } finally {
      _iterator3.f();
    }
    var groups = _toConsumableArray(jobs).map(function (_ref6) {
      var _ref7 = _slicedToArray(_ref6, 2),
        job = _ref7[0],
        jobOrders = _ref7[1];
      var jobCount = _toConsumableArray(jobOrders.values()).reduce(function (count, rows) {
        return count + rows.length;
      }, 0);
      return "<details class=\"cnc-job\" data-cnc-key=\"job:".concat(esc(job), "\" ").concat(cncExpanded.has('job:' + job) || q ? 'open' : '', "><summary><strong>").concat(esc(job), "</strong><span>").concat(jobCount, " panel").concat(jobCount === 1 ? '' : 's', "</span><b>\u203A</b></summary><div>").concat(_toConsumableArray(jobOrders).map(function (_ref8) {
        var _ref9 = _slicedToArray(_ref8, 2),
          order = _ref9[0],
          rows = _ref9[1];
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
    return "<section class=\"cnc-tracker\"><div class=\"cnc-heading\"><div><h2>CNC Tracker</h2><span>Read-only live view</span></div><button data-refresh>Refresh</button></div>".concat(message ? "<div class=\"notice\">".concat(esc(message), "</div>") : '', "<label class=\"cnc-search\"><span>\u2315</span><input data-cnc-search type=\"search\" value=\"").concat(esc(cncQuery), "\" placeholder=\"Search order, job, sheet or panel\u2026\" aria-label=\"Search CNC schedule\"></label><div class=\"cnc-pills\">").concat([['all', 'All', sorted.length], ['pending', 'Pending', pending], ['completed', 'Completed', completed]].map(function (_ref0) {
      var _ref1 = _slicedToArray(_ref0, 3),
        value = _ref1[0],
        label = _ref1[1],
        count = _ref1[2];
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
    var _session9;
    return (_session9 = session) !== null && _session9 !== void 0 && _session9.isAdmin ? "<form class=\"card\" data-order-type><h3>Order types</h3><p>".concat(orderTypes.map(esc).join(' · '), "</p><label>New order type<input name=\"name\" maxlength=\"80\" required></label><button class=\"primary\" type=\"submit\" ").concat(busy ? 'disabled' : '', ">Add order type</button></form>") : '';
  }
  function saveOrderType(_x16) {
    return _saveOrderType.apply(this, arguments);
  }
  function _saveOrderType() {
    _saveOrderType = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee33(event) {
      var _session21;
      var name, button, response, _result12, _t32;
      return _regenerator().w(function (_context34) {
        while (1) switch (_context34.p = _context34.n) {
          case 0:
            event.preventDefault();
            if (!(!((_session21 = session) !== null && _session21 !== void 0 && _session21.isAdmin) || busy)) {
              _context34.n = 1;
              break;
            }
            return _context34.a(2);
          case 1:
            name = new FormData(event.currentTarget).get('name');
            busy = true;
            button = event.currentTarget.querySelector('button');
            button.disabled = true;
            _context34.p = 2;
            _context34.n = 3;
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
            response = _context34.v;
            _context34.n = 4;
            return response.json();
          case 4:
            _result12 = _context34.v;
            if (response.ok) {
              _context34.n = 5;
              break;
            }
            throw Error(_result12.error || 'Order type could not be added.');
          case 5:
            orderTypes = _result12.orderTypes;
            localStorage.setItem(PROJECTS_KEY, JSON.stringify({
              owner: session.username,
              projects: projects,
              orderTypes: orderTypes
            }));
            message = 'Order type added.';
            _context34.n = 7;
            break;
          case 6:
            _context34.p = 6;
            _t32 = _context34.v;
            message = _t32.message;
          case 7:
            _context34.p = 7;
            busy = false;
            render();
            return _context34.f(7);
          case 8:
            return _context34.a(2);
        }
      }, _callee33, null, [[2, 6, 7, 8]]);
    }));
    return _saveOrderType.apply(this, arguments);
  }
  function settingsView() {
    var _current$siteOrderDef, _current$siteOrderDef2;
    var current = profile || {
        displayName: session.username,
        email: '',
        profilePhoto: ''
      },
      shown = current.profilePhoto;
    return "<div class=\"toolbar\"><div><h2 style=\"margin:0\">Settings</h2><small>Account and Site app preferences</small></div></div>".concat(message ? "<div class=\"notice ".concat(message.includes('saved') ? 'success' : '', "\">").concat(esc(message), "</div>") : '', "<div class=\"card account-summary\"><div class=\"account-person\"><div class=\"account-avatar\">").concat(shown ? "<img src=\"".concat(esc(shown), "\" alt=\"\">") : "<span>".concat(esc((current.displayName || session.username || '?').slice(0, 2).toUpperCase()), "</span>"), "</div><div><strong>Signed in as</strong><span>").concat(esc(current.displayName || session.username)).concat(session.isAdmin ? ' · Admin' : '', "</span></div></div></div><form class=\"card\" data-profile><div class=\"grid\"><label>Display name<input name=\"displayName\" maxlength=\"100\" value=\"").concat(esc(current.displayName || session.username), "\" required></label><label>Email<input name=\"email\" type=\"email\" maxlength=\"160\" value=\"").concat(esc(current.email || ''), "\"></label><div class=\"wide\"><h3>Site order defaults</h3><small>These details fill in new orders automatically. You can change them for each order.</small></div><label>Site contact<input name=\"defaultSiteContact\" autocomplete=\"name\" maxlength=\"100\" value=\"").concat(esc(((_current$siteOrderDef = current.siteOrderDefaults) === null || _current$siteOrderDef === void 0 ? void 0 : _current$siteOrderDef.siteContact) || ''), "\" placeholder=\"Contact name for your orders\"></label><label>Site contact phone number<input name=\"defaultSitePhone\" type=\"tel\" inputmode=\"tel\" autocomplete=\"tel\" maxlength=\"40\" value=\"").concat(esc(((_current$siteOrderDef2 = current.siteOrderDefaults) === null || _current$siteOrderDef2 === void 0 ? void 0 : _current$siteOrderDef2.phone) || ''), "\" placeholder=\"e.g. 0400 000 000\"></label><div class=\"wide profile-photo-editor\"><strong>Profile photo</strong><div class=\"profile-photo-preview\">").concat(shown ? "<img src=\"".concat(esc(shown), "\" alt=\"Your profile\">") : "<span>".concat(esc((current.displayName || session.username || '?').slice(0, 2).toUpperCase()), "</span>"), "</div><div class=\"profile-photo-actions\"><label class=\"profile-photo-choose photo-camera\"><svg aria-hidden=\"true\" width=\"20\" height=\"20\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M14 4h-4l-2 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-4z\"/><circle cx=\"12\" cy=\"13\" r=\"4\"/></svg>Take photo<input data-profile-photo type=\"file\" accept=\"image/*\" capture=\"user\" aria-label=\"Take profile photo\"></label><label class=\"profile-photo-choose photo-library\"><svg aria-hidden=\"true\" width=\"20\" height=\"20\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5\"/></svg>Choose photo<input data-profile-photo name=\"profilePhoto\" type=\"file\" accept=\"image/*\" aria-label=\"Choose profile photo\"></label></div>").concat(current.profilePhoto ? '<button data-adjust-current type="button">Adjust current photo</button>' : '', "<small>Take a new photo or choose one from your library. You can adjust it before saving.</small>").concat(current.profilePhoto ? '<button class="danger-button" data-remove-photo type="button">Remove photo</button>' : '', "</div></div><div class=\"actions settings-actions\"><button class=\"primary\" type=\"submit\">Save profile</button><button data-logout type=\"button\">Log out</button></div></form>").concat(orderTypeSettings()).concat(profileEditorOverlay());
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
    var rows = _toConsumableArray(root.querySelectorAll('.item'));
    rows.forEach(function (row) {
      var quantity = row.querySelector('[name=quantity]'),
        description = row.querySelector('[name=description]');
      // Rows without descriptions are omitted when submitting, wherever they appear.
      var hasDescription = !!description.value.trim();
      description.required = false;
      quantity.required = hasDescription;
      quantity.min = hasDescription ? '1' : '';
      quantity.step = hasDescription ? '1' : 'any';
    });
  }
  function addItem() {
    var focus = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : false;
    var list = root.querySelector('.items'),
      row = document.createElement('div');
    row.className = 'item';
    row.innerHTML = '<input name="quantity" type="number" min="1" step="1" value="1" required enterkeyhint="next" aria-label="Quantity"><input name="description" maxlength="180" enterkeyhint="enter" placeholder="Item description" aria-label="Description"><button type="button" aria-label="Remove item">×</button>';
    row.querySelector('button').onclick = function () {
      row.remove();
      updateItemRequirements();
      captureDraft();
    };
    row.addEventListener('input', updateItemRequirements);
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
  function submitOrder(_x17) {
    return _submitOrder.apply(this, arguments);
  }
  function _submitOrder() {
    _submitOrder = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee34(event) {
      var form, orderType, orderTypeOther, _root$querySelector43, _root$querySelector44, selected, items, order, owner, packet, _session22, _orderDraft4, _orderDraft5, _orderDraft6, _t33;
      return _regenerator().w(function (_context35) {
        while (1) switch (_context35.p = _context35.n) {
          case 0:
            event.preventDefault();
            if (!busy) {
              _context35.n = 1;
              break;
            }
            return _context35.a(2);
          case 1:
            captureDraft();
            if (!selectedOrderFiles.some(function (file) {
              return file.missing;
            })) {
              _context35.n = 2;
              break;
            }
            root.querySelector('[data-file-error]').textContent = 'Remove unavailable files and attach them again before submitting.';
            return _context35.a(2);
          case 2:
            form = new FormData(event.currentTarget), orderType = String(form.get('orderType') || '').trim(), orderTypeOther = String(form.get('orderTypeOther') || '').trim();
            if (orderType) {
              _context35.n = 3;
              break;
            }
            message = 'Choose an order type before submitting.';
            render();
            (_root$querySelector43 = root.querySelector('[name=orderType]')) === null || _root$querySelector43 === void 0 || _root$querySelector43.focus();
            return _context35.a(2);
          case 3:
            if (!(orderType === 'Other' && !orderTypeOther)) {
              _context35.n = 4;
              break;
            }
            message = 'Please specify the order type for Other.';
            render();
            (_root$querySelector44 = root.querySelector('[name=orderTypeOther]')) === null || _root$querySelector44 === void 0 || _root$querySelector44.focus();
            return _context35.a(2);
          case 4:
            selected = projects.find(function (project) {
              return (project.id || project.name) === form.get('projectId');
            }), items = _toConsumableArray(root.querySelectorAll('.item')).map(function (row) {
              return {
                quantity: Number(row.querySelector('[name=quantity]').value),
                description: row.querySelector('[name=description]').value.trim()
              };
            }).filter(function (item) {
              return item.quantity > 0 && item.description;
            });
            if (items.length) {
              _context35.n = 5;
              break;
            }
            message = 'Add at least one item.';
            render();
            return _context35.a(2);
          case 5:
            if (!(outbox.queue.length && outbox.owner !== session.username)) {
              _context35.n = 6;
              break;
            }
            message = "Saved requests on this device belong to ".concat(outbox.owner, ".");
            view = 'orders';
            render();
            return _context35.a(2);
          case 6:
            if (selected) {
              _context35.n = 7;
              break;
            }
            message = 'Choose an available project before submitting.';
            render();
            return _context35.a(2);
          case 7:
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
            _context35.p = 8;
            validateOrderFiles(selectedOrderFiles);
            _context35.n = 9;
            return attachmentDb('put', selectedOrderFiles);
          case 9:
            if (!(((_session22 = session) === null || _session22 === void 0 ? void 0 : _session22.username) !== owner)) {
              _context35.n = 10;
              break;
            }
            throw Error('Your account changed. Submit the order again.');
          case 10:
            packet = {
              localId: crypto.randomUUID(),
              idempotencyKey: ((_orderDraft4 = orderDraft) === null || _orderDraft4 === void 0 ? void 0 : _orderDraft4.id) || crypto.randomUUID(),
              cloudDraftId: (_orderDraft5 = orderDraft) !== null && _orderDraft5 !== void 0 && _orderDraft5.cloudUpdatedAt ? orderDraft.id : null,
              cloudDraftVersion: ((_orderDraft6 = orderDraft) === null || _orderDraft6 === void 0 ? void 0 : _orderDraft6.cloudUpdatedAt) || '',
              order: order,
              attachments: selectedOrderFiles.map(function (_ref23) {
                var file = _ref23.file,
                  metadata = _objectWithoutProperties(_ref23, _excluded4);
                return metadata;
              }),
              createdAt: new Date().toISOString()
            };
            outbox.owner = owner;
            outbox.queue.push(packet);
            saveOutbox();
            try {
              localStorage.removeItem(DRAFT_KEY + owner);
            } catch (_unused1) {}
            orderDraft = null;
            draftOwner = '';
            selectedOrderFiles = [];
            _context35.n = 12;
            break;
          case 11:
            _context35.p = 11;
            _t33 = _context35.v;
            if (packet) outbox.queue = outbox.queue.filter(function (item) {
              return item !== packet;
            });
            root.querySelector('[data-file-error]').textContent = _t33.message;
            return _context35.a(2);
          case 12:
            _context35.p = 12;
            busy = false;
            return _context35.f(12);
          case 13:
            view = 'orders';
            message = navigator.onLine ? 'Submitting request…' : 'Request saved on this device and will submit when connected.';
            render();
            void flush();
          case 14:
            return _context35.a(2);
        }
      }, _callee34, null, [[8, 11, 12, 13]]);
    }));
    return _submitOrder.apply(this, arguments);
  }
  function downloadOrder(_x18) {
    return _downloadOrder.apply(this, arguments);
  }
  function _downloadOrder() {
    _downloadOrder = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee36(button) {
      var format, id, original, preview, ticket, _yield$Promise$all, _yield$Promise$all2, previewToken, downloadToken, base, link, fileToken, _t34;
      return _regenerator().w(function (_context37) {
        while (1) switch (_context37.p = _context37.n) {
          case 0:
            format = button.dataset.export, id = button.dataset.orderId, original = button.innerHTML, preview = format === 'pdf' ? window.open('about:blank', '_blank') : null;
            button.disabled = true;
            button.textContent = 'Preparing…';
            if (preview) preview.opener = null;
            ticket = /*#__PURE__*/function () {
              var _ticket = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee35() {
                var response, result;
                return _regenerator().w(function (_context36) {
                  while (1) switch (_context36.n) {
                    case 0:
                      _context36.n = 1;
                      return api('/orders/' + id + '/pdf-link', {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json'
                        },
                        body: '{}'
                      });
                    case 1:
                      response = _context36.v;
                      _context36.n = 2;
                      return response.json();
                    case 2:
                      result = _context36.v;
                      if (!(!response.ok || !result.pdfToken)) {
                        _context36.n = 3;
                        break;
                      }
                      throw Error(result.error || 'Order file could not be generated');
                    case 3:
                      return _context36.a(2, result.pdfToken);
                  }
                }, _callee35);
              }));
              function ticket() {
                return _ticket.apply(this, arguments);
              }
              return ticket;
            }();
            _context37.p = 1;
            if (!(format === 'pdf')) {
              _context37.n = 3;
              break;
            }
            _context37.n = 2;
            return Promise.all([ticket(), ticket()]);
          case 2:
            _yield$Promise$all = _context37.v;
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
            _context37.n = 5;
            break;
          case 3:
            _context37.n = 4;
            return ticket();
          case 4:
            fileToken = _context37.v;
            window.location.assign(API + '/orders/' + id + '/' + format + '?ticket=' + encodeURIComponent(fileToken));
          case 5:
            _context37.n = 7;
            break;
          case 6:
            _context37.p = 6;
            _t34 = _context37.v;
            if (preview && !preview.closed) preview.close();
            message = _t34.message;
            render();
          case 7:
            _context37.p = 7;
            if (button.isConnected) {
              button.disabled = false;
              button.innerHTML = original;
            }
            return _context37.f(7);
          case 8:
            return _context37.a(2);
        }
      }, _callee36, null, [[1, 6, 7, 8]]);
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
  var cropProfilePhoto = function cropProfilePhoto(source, _ref10) {
    var zoom = _ref10.zoom,
      x = _ref10.x,
      y = _ref10.y;
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
  function saveProfile(_x19) {
    return _saveProfile.apply(this, arguments);
  }
  function _saveProfile() {
    _saveProfile = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee37(event) {
      var form, payload, response, _result13, _t35;
      return _regenerator().w(function (_context38) {
        while (1) switch (_context38.p = _context38.n) {
          case 0:
            event.preventDefault();
            busy = true;
            message = '';
            form = new FormData(event.currentTarget);
            _context38.p = 1;
            payload = {
              displayName: form.get('displayName'),
              email: form.get('email'),
              siteOrderDefaults: {
                siteContact: form.get('defaultSiteContact') || '',
                phone: form.get('defaultSitePhone') || ''
              }
            };
            if (!selectedProfilePhoto) {
              _context38.n = 3;
              break;
            }
            _context38.n = 2;
            return cropProfilePhoto(selectedProfilePhoto, profileAdjustment);
          case 2:
            payload.profilePhoto = _context38.v;
          case 3:
            _context38.n = 4;
            return api('/profile', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(payload)
            });
          case 4:
            response = _context38.v;
            _context38.n = 5;
            return response.json();
          case 5:
            _result13 = _context38.v;
            if (response.ok) {
              _context38.n = 6;
              break;
            }
            throw Error(_result13.error || 'Profile could not be saved.');
          case 6:
            profile = _result13.profile;
            selectedProfilePhoto = null;
            profileAdjustment = {
              zoom: 1,
              x: 50,
              y: 50
            };
            message = 'Profile saved.';
            _context38.n = 8;
            break;
          case 7:
            _context38.p = 7;
            _t35 = _context38.v;
            message = _t35.message || 'Could not reach the server.';
          case 8:
            _context38.p = 8;
            busy = false;
            render();
            return _context38.f(8);
          case 9:
            return _context38.a(2);
        }
      }, _callee37, null, [[1, 7, 8, 9]]);
    }));
    return _saveProfile.apply(this, arguments);
  }
  function wireProfilePhoto() {
    root.addEventListener('change', /*#__PURE__*/function () {
      var _ref11 = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee(event) {
        var _event$target$files;
        var file, _t;
        return _regenerator().w(function (_context) {
          while (1) switch (_context.p = _context.n) {
            case 0:
              if (event.target.matches('[data-profile-photo]')) {
                _context.n = 1;
                break;
              }
              return _context.a(2);
            case 1:
              file = (_event$target$files = event.target.files) === null || _event$target$files === void 0 ? void 0 : _event$target$files[0];
              if (file) {
                _context.n = 2;
                break;
              }
              return _context.a(2);
            case 2:
              message = 'Preparing photo…';
              _context.p = 3;
              _context.n = 4;
              return readPhoto(file);
            case 4:
              selectedProfilePhoto = _context.v;
              profileAdjustment = {
                zoom: 1,
                x: 50,
                y: 50
              };
              message = '';
              _context.n = 6;
              break;
            case 5:
              _context.p = 5;
              _t = _context.v;
              message = _t.message || 'Profile photo could not be prepared.';
            case 6:
              render();
            case 7:
              return _context.a(2);
          }
        }, _callee, null, [[3, 5]]);
      }));
      return function (_x20) {
        return _ref11.apply(this, arguments);
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
    var _profile3, _root$querySelector0;
    if (event.target.closest('[data-adjust-current]') && (_profile3 = profile) !== null && _profile3 !== void 0 && _profile3.profilePhoto) {
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
    if (event.target.closest('[data-save-photo]')) (_root$querySelector0 = root.querySelector('[data-profile]')) === null || _root$querySelector0 === void 0 || _root$querySelector0.requestSubmit();
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
      var _ref12 = _toConsumableArray(profileGesture.pointers.values()),
        a = _ref12[0],
        b = _ref12[1],
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
    _removeProfilePhoto = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee38() {
      var _profile4;
      var response, _result14, _t36;
      return _regenerator().w(function (_context39) {
        while (1) switch (_context39.p = _context39.n) {
          case 0:
            if ((_profile4 = profile) !== null && _profile4 !== void 0 && _profile4.profilePhoto) {
              _context39.n = 1;
              break;
            }
            return _context39.a(2);
          case 1:
            busy = true;
            message = '';
            _context39.p = 2;
            _context39.n = 3;
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
            response = _context39.v;
            _context39.n = 4;
            return response.json();
          case 4:
            _result14 = _context39.v;
            if (response.ok) {
              _context39.n = 5;
              break;
            }
            throw Error(_result14.error || 'Profile photo could not be removed.');
          case 5:
            profile = _result14.profile;
            message = 'Profile photo removed.';
            _context39.n = 7;
            break;
          case 6:
            _context39.p = 6;
            _t36 = _context39.v;
            message = _t36.message || 'Could not reach the server.';
          case 7:
            _context39.p = 7;
            busy = false;
            render();
            return _context39.f(7);
          case 8:
            return _context39.a(2);
        }
      }, _callee38, null, [[2, 6, 7, 8]]);
    }));
    return _removeProfilePhoto.apply(this, arguments);
  }
  function submitSupport(_x21) {
    return _submitSupport.apply(this, arguments);
  }
  function _submitSupport() {
    _submitSupport = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee39(event) {
      var form, response, _result15, _t37;
      return _regenerator().w(function (_context40) {
        while (1) switch (_context40.p = _context40.n) {
          case 0:
            event.preventDefault();
            busy = true;
            message = '';
            form = new FormData(event.currentTarget);
            _context40.p = 1;
            _context40.n = 2;
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
            response = _context40.v;
            _context40.n = 3;
            return response.json();
          case 3:
            _result15 = _context40.v;
            if (response.ok) {
              _context40.n = 4;
              break;
            }
            throw Error(_result15.error || 'Ticket could not be submitted.');
          case 4:
            supportTickets = _result15.tickets || [];
            supportSelected = _result15.ticket.id;
            supportPhoto = '';
            message = 'Support ticket submitted.';
            _context40.n = 6;
            break;
          case 5:
            _context40.p = 5;
            _t37 = _context40.v;
            message = _t37.message || 'Ticket could not be submitted.';
          case 6:
            _context40.p = 6;
            busy = false;
            render();
            return _context40.f(6);
          case 7:
            return _context40.a(2);
        }
      }, _callee39, null, [[1, 5, 6, 7]]);
    }));
    return _submitSupport.apply(this, arguments);
  }
  function replySupport(_x22) {
    return _replySupport.apply(this, arguments);
  }
  function _replySupport() {
    _replySupport = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee40(event) {
      var form, response, _result16, _t38;
      return _regenerator().w(function (_context41) {
        while (1) switch (_context41.p = _context41.n) {
          case 0:
            event.preventDefault();
            busy = true;
            message = '';
            form = new FormData(event.currentTarget);
            _context41.p = 1;
            _context41.n = 2;
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
            response = _context41.v;
            _context41.n = 3;
            return response.json();
          case 3:
            _result16 = _context41.v;
            if (response.ok) {
              _context41.n = 4;
              break;
            }
            throw Error(_result16.error || 'Reply could not be sent.');
          case 4:
            supportTickets = _result16.tickets || [];
            supportReplyPhoto = '';
            message = 'Reply sent.';
            _context41.n = 6;
            break;
          case 5:
            _context41.p = 5;
            _t38 = _context41.v;
            message = _t38.message || 'Reply could not be sent.';
          case 6:
            _context41.p = 6;
            busy = false;
            render();
            return _context41.f(6);
          case 7:
            return _context41.a(2);
        }
      }, _callee40, null, [[1, 5, 6, 7]]);
    }));
    return _replySupport.apply(this, arguments);
  }
  function updateSupportStatus(_x23) {
    return _updateSupportStatus.apply(this, arguments);
  }
  function _updateSupportStatus() {
    _updateSupportStatus = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee41(status) {
      var response, _result17, _t39;
      return _regenerator().w(function (_context42) {
        while (1) switch (_context42.p = _context42.n) {
          case 0:
            busy = true;
            message = '';
            _context42.p = 1;
            _context42.n = 2;
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
            response = _context42.v;
            _context42.n = 3;
            return response.json();
          case 3:
            _result17 = _context42.v;
            if (response.ok) {
              _context42.n = 4;
              break;
            }
            throw Error(_result17.error || 'Status could not be updated.');
          case 4:
            supportTickets = _result17.tickets || [];
            _context42.n = 6;
            break;
          case 5:
            _context42.p = 5;
            _t39 = _context42.v;
            message = _t39.message || 'Status could not be updated.';
          case 6:
            _context42.p = 6;
            busy = false;
            render();
            return _context42.f(6);
          case 7:
            return _context42.a(2);
        }
      }, _callee41, null, [[1, 5, 6, 7]]);
    }));
    return _updateSupportStatus.apply(this, arguments);
  }
  function logout() {
    return _logout.apply(this, arguments);
  }
  function _logout() {
    _logout = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee42() {
      var _session23;
      var token, response, _t40;
      return _regenerator().w(function (_context43) {
        while (1) switch (_context43.p = _context43.n) {
          case 0:
            token = (_session23 = session) === null || _session23 === void 0 ? void 0 : _session23.token;
            clearAccountState();
            busy = true;
            message = 'Signing out…';
            render();
            _context43.p = 1;
            if (!token) {
              _context43.n = 3;
              break;
            }
            _context43.n = 2;
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
            response = _context43.v;
            if (!(!response.ok && response.status !== 401)) {
              _context43.n = 3;
              break;
            }
            throw Error('Server sign-out was not confirmed');
          case 3:
            message = 'Signed out.';
            _context43.n = 5;
            break;
          case 4:
            _context43.p = 4;
            _t40 = _context43.v;
            message = 'Signed out on this device. Server sign-out could not be confirmed; the session may remain valid until it expires.';
          case 5:
            _context43.p = 5;
            busy = false;
            render();
            return _context43.f(5);
          case 6:
            return _context43.a(2);
        }
      }, _callee42, null, [[1, 4, 5, 6]]);
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
    var _root$querySelector1, _root$querySelector10, _root$querySelector11, _root$querySelector12, _root$querySelector13, _root$querySelector14, _root$querySelector15, _root$querySelector17, _root$querySelector18, _root$querySelector19, _root$querySelector20, _root$querySelector21, _root$querySelector22, _root$querySelector23, _root$querySelector24, _root$querySelector25, _root$querySelector26, _root$querySelector27, _root$querySelector28, _root$querySelector29, _root$querySelector30;
    root.querySelectorAll('[data-delete-device-draft]').forEach(function (button) {
      return button.onclick = function () {
        return deleteDeviceDraft(button.dataset.deleteDeviceDraft);
      };
    });
    (_root$querySelector1 = root.querySelector('[data-keep-device-draft]')) === null || _root$querySelector1 === void 0 || _root$querySelector1.addEventListener('click', function () {
      deviceDiscardId = '';
      render();
    });
    (_root$querySelector10 = root.querySelector('[data-new-empty]')) === null || _root$querySelector10 === void 0 || _root$querySelector10.addEventListener('click', startNewSiteDraft);
    (_root$querySelector11 = root.querySelector('[data-open-drafts]')) === null || _root$querySelector11 === void 0 || _root$querySelector11.addEventListener('click', function () {
      view = 'drafts';
      message = '';
      render();
      void loadCloudDrafts().then(render);
    });
    (_root$querySelector12 = root.querySelector('[data-refresh-drafts]')) === null || _root$querySelector12 === void 0 || _root$querySelector12.addEventListener('click', function () {
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
    (_root$querySelector13 = root.querySelector('[data-keep-cloud-draft]')) === null || _root$querySelector13 === void 0 || _root$querySelector13.addEventListener('click', function () {
      cloudDiscardId = '';
      render();
    });
    (_root$querySelector14 = root.querySelector('[data-save-cloud-draft]')) === null || _root$querySelector14 === void 0 || _root$querySelector14.addEventListener('click', saveCloudDraft);
    (_root$querySelector15 = root.querySelector('[data-open-order-search]')) === null || _root$querySelector15 === void 0 || _root$querySelector15.addEventListener('click', function () {
      var _root$querySelector16;
      view = 'order-search';
      message = '';
      render();
      (_root$querySelector16 = root.querySelector('[data-order-search]')) === null || _root$querySelector16 === void 0 || _root$querySelector16.focus();
    });
    (_root$querySelector17 = root.querySelector('[data-order-results]')) === null || _root$querySelector17 === void 0 || _root$querySelector17.addEventListener('click', function () {
      view = orderReturnView;
      message = '';
      render();
    });
    wireReceipts();
    (_root$querySelector18 = root.querySelector('[data-retry-status]')) === null || _root$querySelector18 === void 0 || _root$querySelector18.addEventListener('click', function () {
      if (statusConflict) void changeOrderStatus(statusConflict.order, statusConflict.status);
    });
    (_root$querySelector19 = root.querySelector('[data-cancel-status]')) === null || _root$querySelector19 === void 0 || _root$querySelector19.addEventListener('click', function () {
      if (statusConflict) delete statusChoices[statusConflict.order.id];
      statusConflict = null;
      void refresh().then(render);
    });
    wireOrderAlerts();
    (_root$querySelector20 = root.querySelector('[data-history-retry]')) === null || _root$querySelector20 === void 0 || _root$querySelector20.addEventListener('click', function () {
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
    (_root$querySelector21 = root.querySelector('[data-order-type]')) === null || _root$querySelector21 === void 0 || _root$querySelector21.addEventListener('submit', saveOrderType);
    (_root$querySelector22 = root.querySelector('[data-logout]')) === null || _root$querySelector22 === void 0 || _root$querySelector22.addEventListener('click', logout);
    (_root$querySelector23 = root.querySelector('[data-remove-photo]')) === null || _root$querySelector23 === void 0 || _root$querySelector23.addEventListener('click', removeProfilePhoto);
    root.querySelectorAll('[data-orders]').forEach(function (button) {
      return button.addEventListener('click', function () {
        view = 'orders';
        message = '';
        render();
      });
    });
    (_root$querySelector24 = root.querySelector('[data-cnc]')) === null || _root$querySelector24 === void 0 || _root$querySelector24.addEventListener('click', function () {
      view = 'cnc';
      message = '';
      render();
    });
    (_root$querySelector25 = root.querySelector('[data-support]')) === null || _root$querySelector25 === void 0 || _root$querySelector25.addEventListener('click', function () {
      view = 'support';
      supportSelected = '';
      message = '';
      render();
    });
    (_root$querySelector26 = root.querySelector('[data-settings]')) === null || _root$querySelector26 === void 0 || _root$querySelector26.addEventListener('click', function () {
      view = 'settings';
      message = '';
      render();
    });
    (_root$querySelector27 = root.querySelector('[data-refresh]')) === null || _root$querySelector27 === void 0 || _root$querySelector27.addEventListener('click', function () {
      message = '';
      void refresh().then(render);
    });
    (_root$querySelector28 = root.querySelector('[data-profile]')) === null || _root$querySelector28 === void 0 || _root$querySelector28.addEventListener('submit', saveProfile);
    root.querySelectorAll('[data-new]').forEach(function (button) {
      return button.addEventListener('click', openDraft);
    });
    (_root$querySelector29 = root.querySelector('[data-cancel]')) === null || _root$querySelector29 === void 0 || _root$querySelector29.addEventListener('click', function () {
      view = 'orders';
      message = '';
      render();
    });
    (_root$querySelector30 = root.querySelector('[data-retry]')) === null || _root$querySelector30 === void 0 || _root$querySelector30.addEventListener('click', flush);
    root.querySelectorAll('[data-export]').forEach(function (button) {
      return button.onclick = function () {
        return downloadOrder(button);
      };
    });
    root.querySelectorAll('[data-date-picker]').forEach(function (button) {
      return button.onclick = function () {
        return openDatePicker(root.querySelector('[name=requestedDeliveryDate]'), button);
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
        orderReturnView = view === 'order-search' ? 'order-search' : 'orders';
        selectedOrderId = button.dataset.orderDetails;
        view = 'order';
        message = '';
        historyState = {};
        render();
        if (!pendingOrders().some(function (order) {
          return order.id === selectedOrderId;
        })) void loadOrderHistory(selectedOrderId);
      };
    });
    if (view === 'new') {
      var _root$querySelector31;
      root.querySelector('[data-add]').onclick = function () {
        return addItem(true);
      };
      root.querySelector('[data-order]').onsubmit = submitOrder;
      root.querySelectorAll('[data-discard-draft]').forEach(function (button) {
        return button.onclick = discardDraft;
      });
      (_root$querySelector31 = root.querySelector('[data-keep-draft]')) === null || _root$querySelector31 === void 0 || _root$querySelector31.addEventListener('click', function () {
        discardDraftArmed = false;
        render();
      });
      restoreDraftForm();
      wireOtherOrderType();
    }
  }
  function wireCnc() {
    var _root$querySelector32, _root$querySelector33;
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
    (_root$querySelector32 = root.querySelector('[data-cnc-expand]')) === null || _root$querySelector32 === void 0 || _root$querySelector32.addEventListener('click', function () {
      root.querySelectorAll('[data-cnc-key]').forEach(function (details) {
        details.open = true;
        cncExpanded.add(details.dataset.cncKey);
      });
    });
    (_root$querySelector33 = root.querySelector('[data-cnc-collapse]')) === null || _root$querySelector33 === void 0 || _root$querySelector33.addEventListener('click', function () {
      root.querySelectorAll('[data-cnc-key]').forEach(function (details) {
        details.open = false;
        cncExpanded.delete(details.dataset.cncKey);
      });
    });
  }
  function wireOrders() {
    var _root$querySelector34, _root$querySelector36;
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
    var _loop2 = function _loop2() {
      var _arr$_i = _slicedToArray(_arr[_i2], 2),
        selector = _arr$_i[0],
        set = _arr$_i[1];
      var input = root.querySelector('[data-order-' + selector + ']');
      if (input) input.onchange = function () {
        set(input.value);
        render();
      };
    };
    for (var _i2 = 0, _arr = [['project', function (value) {
        return orderProject = value;
      }], ['requester', function (value) {
        return orderRequester = value;
      }], ['delivery', function (value) {
        return orderDelivery = value;
      }]]; _i2 < _arr.length; _i2++) {
      _loop2();
    }
    (_root$querySelector34 = root.querySelector('[data-my-orders]')) === null || _root$querySelector34 === void 0 || _root$querySelector34.addEventListener('click', function () {
      orderRequester = session.username;
      render();
    });
    var _loop3 = function _loop3() {
      var _root$querySelector35;
      var _arr2$_i = _slicedToArray(_arr2[_i3], 2),
        selector = _arr2$_i[0],
        value = _arr2$_i[1];
      (_root$querySelector35 = root.querySelector('[data-' + selector + ']')) === null || _root$querySelector35 === void 0 || _root$querySelector35.addEventListener('click', function () {
        orderDelivery = value;
        orderFilter = 'active';
        render();
      });
    };
    for (var _i3 = 0, _arr2 = [['due-week', 'week'], ['overdue', 'overdue']]; _i3 < _arr2.length; _i3++) {
      _loop3();
    }
    (_root$querySelector36 = root.querySelector('[data-clear-order-filters]')) === null || _root$querySelector36 === void 0 || _root$querySelector36.addEventListener('click', function () {
      orderQuery = '';
      orderProject = '';
      orderRequester = '';
      orderDelivery = '';
      orderFilter = 'active';
      render();
    });
  }
  function wireSupport() {
    var _root$querySelector37, _root$querySelector38, _root$querySelector39, _root$querySelector40, _root$querySelector41;
    (_root$querySelector37 = root.querySelector('[data-support-back]')) === null || _root$querySelector37 === void 0 || _root$querySelector37.addEventListener('click', function () {
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
    (_root$querySelector38 = root.querySelector('[data-support-create]')) === null || _root$querySelector38 === void 0 || _root$querySelector38.addEventListener('submit', submitSupport);
    (_root$querySelector39 = root.querySelector('[data-support-reply]')) === null || _root$querySelector39 === void 0 || _root$querySelector39.addEventListener('submit', replySupport);
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
    (_root$querySelector40 = root.querySelector('[data-support-photo]')) === null || _root$querySelector40 === void 0 || _root$querySelector40.addEventListener('change', /*#__PURE__*/function () {
      var _ref13 = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee2(event) {
        var _event$target$files2;
        var file, _t2;
        return _regenerator().w(function (_context2) {
          while (1) switch (_context2.p = _context2.n) {
            case 0:
              file = (_event$target$files2 = event.target.files) === null || _event$target$files2 === void 0 ? void 0 : _event$target$files2[0];
              if (file) {
                _context2.n = 1;
                break;
              }
              return _context2.a(2);
            case 1:
              message = 'Preparing attachment…';
              render();
              _context2.p = 2;
              _context2.n = 3;
              return readPhoto(file);
            case 3:
              supportPhoto = _context2.v;
              message = '';
              _context2.n = 5;
              break;
            case 4:
              _context2.p = 4;
              _t2 = _context2.v;
              message = _t2.message || 'Attachment could not be prepared.';
            case 5:
              render();
            case 6:
              return _context2.a(2);
          }
        }, _callee2, null, [[2, 4]]);
      }));
      return function (_x24) {
        return _ref13.apply(this, arguments);
      };
    }());
    (_root$querySelector41 = root.querySelector('[data-support-reply-photo]')) === null || _root$querySelector41 === void 0 || _root$querySelector41.addEventListener('change', /*#__PURE__*/function () {
      var _ref14 = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee3(event) {
        var _event$target$files3;
        var file, _t3;
        return _regenerator().w(function (_context3) {
          while (1) switch (_context3.p = _context3.n) {
            case 0:
              file = (_event$target$files3 = event.target.files) === null || _event$target$files3 === void 0 ? void 0 : _event$target$files3[0];
              if (file) {
                _context3.n = 1;
                break;
              }
              return _context3.a(2);
            case 1:
              message = 'Preparing attachment…';
              render();
              _context3.p = 2;
              _context3.n = 3;
              return readPhoto(file);
            case 3:
              supportReplyPhoto = _context3.v;
              message = '';
              _context3.n = 5;
              break;
            case 4:
              _context3.p = 4;
              _t3 = _context3.v;
              message = _t3.message || 'Attachment could not be prepared.';
            case 5:
              render();
            case 6:
              return _context3.a(2);
          }
        }, _callee3, null, [[2, 4]]);
      }));
      return function (_x25) {
        return _ref14.apply(this, arguments);
      };
    }());
  }
  function render() {
    captureReceipt();
    captureDraft();
    if (!session) {
      loginScreen();
      return;
    }
    if ((view === 'orders' || view === 'order-search' || view === 'new' || view === 'order' || view === 'drafts') && !can('site.orders.view')) view = can('site.cnc.view') ? 'cnc' : 'settings';
    if ((view === 'new' || view === 'drafts') && !can('site.orders.create')) view = 'orders';
    if (view === 'cnc' && !can('site.cnc.view')) view = can('site.orders.view') ? 'orders' : 'settings';
    var content = view === 'notifications' ? orderAlertsView() : view === 'drafts' ? cloudDraftView() : view === 'new' ? newOrder() : view === 'order' ? orderDetails() : view === 'cnc' ? cncView() : view === 'support' ? supportView() : view === 'settings' ? settingsView() : orderList();
    root.innerHTML = shell(content);
    wire();
    if (view === 'orders' || view === 'order-search') wireOrders();
    if (view === 'cnc') wireCnc();
    if (view === 'support') wireSupport();
  }
  window.addEventListener('pagehide', captureDraft);
  window.addEventListener('online', function () {
    message = 'Connection restored.';
    void flush();
  });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/site/sw.js', {
    updateViaCache: 'none'
  }).then(function (registration) {
    return registration.update();
  }).catch(function () {});
  render();
  if (session) {
    void refresh().then(function () {
      render();
      void flush();
    });
  }
  window.setInterval(function () {
    void pollOrderAlerts();
  }, 60000);
  (_document$addEventLis = (_document = document).addEventListener) === null || _document$addEventLis === void 0 || _document$addEventLis.call(_document, 'visibilitychange', function () {
    if (!document.hidden) void pollOrderAlerts();
  });
})();
