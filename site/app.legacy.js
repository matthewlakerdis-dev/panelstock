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
function asyncGeneratorStep(n, t, e, r, o, a, c) { try { var i = n[a](c), u = i.value; } catch (n) { return void e(n); } i.done ? t(u) : Promise.resolve(u).then(r, o); }
function _asyncToGenerator(n) { return function () { var t = this, e = arguments; return new Promise(function (r, o) { var a = n.apply(t, e); function _next(n) { asyncGeneratorStep(a, r, o, _next, _throw, "next", n); } function _throw(n) { asyncGeneratorStep(a, r, o, _next, _throw, "throw", n); } _next(void 0); }); }; }
function _objectWithoutProperties(e, t) { if (null == e) return {}; var o, r, i = _objectWithoutPropertiesLoose(e, t); if (Object.getOwnPropertySymbols) { var n = Object.getOwnPropertySymbols(e); for (r = 0; r < n.length; r++) o = n[r], -1 === t.indexOf(o) && {}.propertyIsEnumerable.call(e, o) && (i[o] = e[o]); } return i; }
function _objectWithoutPropertiesLoose(r, e) { if (null == r) return {}; var t = {}; for (var n in r) if ({}.hasOwnProperty.call(r, n)) { if (-1 !== e.indexOf(n)) continue; t[n] = r[n]; } return t; }
function _toConsumableArray(r) { return _arrayWithoutHoles(r) || _iterableToArray(r) || _unsupportedIterableToArray(r) || _nonIterableSpread(); }
function _nonIterableSpread() { throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _unsupportedIterableToArray(r, a) { if (r) { if ("string" == typeof r) return _arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1); return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0; } }
function _iterableToArray(r) { if ("undefined" != typeof Symbol && null != r[Symbol.iterator] || null != r["@@iterator"]) return Array.from(r); }
function _arrayWithoutHoles(r) { if (Array.isArray(r)) return _arrayLikeToArray(r); }
function _arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }
(function (_session, _session2, _session5) {
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
  var draftFields = ['projectId', 'orderType', 'siteContact', 'phone', 'requestedDeliveryDate', 'requestedDeliveryTime', 'locationNotes'];
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
    _openDraft = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee6() {
      var owner, version, _session9, draft, files;
      return _regenerator().w(function (_context6) {
        while (1) switch (_context6.p = _context6.n) {
          case 0:
            if (!busy) {
              _context6.n = 1;
              break;
            }
            return _context6.a(2);
          case 1:
            owner = session.username, version = sessionVersion;
            busy = true;
            _context6.p = 2;
            draft = orderDraft && draftOwner === owner ? orderDraft : savedDraft();
            orderDraft = draft || {
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
            _context6.n = 3;
            return Promise.all((orderDraft.attachments || []).map(/*#__PURE__*/function () {
              var _ref16 = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee5(metadata) {
                var file, _t5;
                return _regenerator().w(function (_context5) {
                  while (1) switch (_context5.p = _context5.n) {
                    case 0:
                      _context5.p = 0;
                      _context5.n = 1;
                      return attachmentDb('get', metadata.id);
                    case 1:
                      file = _context5.v;
                      return _context5.a(2, _objectSpread(_objectSpread({}, metadata), {}, {
                        file: file,
                        missing: !file
                      }));
                    case 2:
                      _context5.p = 2;
                      _t5 = _context5.v;
                      return _context5.a(2, _objectSpread(_objectSpread({}, metadata), {}, {
                        missing: true
                      }));
                  }
                }, _callee5, null, [[0, 2]]);
              }));
              return function (_x16) {
                return _ref16.apply(this, arguments);
              };
            }()));
          case 3:
            files = _context6.v;
            if (!(sessionVersion !== version || ((_session9 = session) === null || _session9 === void 0 ? void 0 : _session9.username) !== owner)) {
              _context6.n = 4;
              break;
            }
            return _context6.a(2);
          case 4:
            selectedOrderFiles = files;
            discardDraftArmed = false;
            view = 'new';
            message = files.some(function (file) {
              return file.missing;
            }) ? 'Some saved files are unavailable. Remove them and attach them again before submitting.' : '';
            draftNotice = draft ? 'Restored draft from this device' : 'Your draft saves automatically on this device';
            render();
            captureDraft();
          case 5:
            _context6.p = 5;
            busy = false;
            return _context6.f(5);
          case 6:
            return _context6.a(2);
        }
      }, _callee6, null, [[2,, 5, 6]]);
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
    _discardDraft = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee7() {
      var owner, files, _t6;
      return _regenerator().w(function (_context7) {
        while (1) switch (_context7.p = _context7.n) {
          case 0:
            if (!busy) {
              _context7.n = 1;
              break;
            }
            return _context7.a(2);
          case 1:
            if (discardDraftArmed) {
              _context7.n = 2;
              break;
            }
            discardDraftArmed = true;
            render();
            return _context7.a(2);
          case 2:
            owner = draftOwner, files = selectedOrderFiles;
            captureDraft();
            _context7.p = 3;
            localStorage.removeItem(DRAFT_KEY + owner);
            _context7.n = 5;
            break;
          case 4:
            _context7.p = 4;
            _t6 = _context7.v;
            draftNotice = 'Could not discard the saved draft. Try again.';
            render();
            return _context7.a(2);
          case 5:
            orderDraft = null;
            draftOwner = '';
            selectedOrderFiles = [];
            discardDraftArmed = false;
            view = 'orders';
            message = 'Draft discarded.';
            render();
            _context7.n = 6;
            return attachmentDb('delete', files).catch(function () {});
          case 6:
            return _context7.a(2);
        }
      }, _callee7, null, [[3, 4]]);
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
  var orderQuery = '',
    orderProject = '',
    orderRequester = '',
    orderDelivery = '',
    historyState = {};
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
      active = !order.local && ['submitted', 'approved', 'ordered'].includes(order.status);
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
  function loadOrderHistory(_x) {
    return _loadOrderHistory.apply(this, arguments);
  }
  function _loadOrderHistory() {
    _loadOrderHistory = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee8(id) {
      var version, response, result, _t7;
      return _regenerator().w(function (_context8) {
        while (1) switch (_context8.p = _context8.n) {
          case 0:
            version = sessionVersion;
            historyState = {
              id: id,
              loading: true
            };
            render();
            _context8.p = 1;
            _context8.n = 2;
            return api('/orders/' + encodeURIComponent(id) + '/history');
          case 2:
            response = _context8.v;
            _context8.n = 3;
            return response.json();
          case 3:
            result = _context8.v;
            if (response.ok) {
              _context8.n = 4;
              break;
            }
            throw Error(result.error || 'History could not be loaded.');
          case 4:
            if (!(version !== sessionVersion || selectedOrderId !== id)) {
              _context8.n = 5;
              break;
            }
            return _context8.a(2);
          case 5:
            historyState = {
              id: id,
              events: result.events || []
            };
            _context8.n = 8;
            break;
          case 6:
            _context8.p = 6;
            _t7 = _context8.v;
            if (!(version !== sessionVersion || selectedOrderId !== id)) {
              _context8.n = 7;
              break;
            }
            return _context8.a(2);
          case 7:
            historyState = {
              id: id,
              error: _t7.message
            };
          case 8:
            if (view === 'order') render();
          case 9:
            return _context8.a(2);
        }
      }, _callee8, null, [[1, 6]]);
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
  function orderDetails() {
    var _order$items;
    var order = [].concat(_toConsumableArray(pendingOrders()), _toConsumableArray(orders)).find(function (order) {
      return order.id === selectedOrderId;
    });
    if (!order) return '<div class="toolbar"><h2>Order unavailable</h2><button data-orders>Back to orders</button></div><p>Refresh the order list and try again.</p>';
    var field = function field(label, value) {
      return "<div><small>".concat(esc(label), "</small><div style=\"white-space:pre-wrap;overflow-wrap:anywhere\">").concat(esc(value || 'Not provided'), "</div></div>");
    };
    var delivery = function delivery(date, time) {
      return date ? formatDate(date) + (time ? ' · ' + time : '') : 'Not confirmed';
    };
    return "<div class=\"toolbar\"><div><h2 style=\"margin:0\">Order #".concat(esc(order.orderNumber), "</h2><small>").concat(esc(order.project), " \xB7 ").concat(esc(order.status), "</small></div><button data-orders>Back to orders</button></div>").concat(message ? "<div class=\"notice\">".concat(esc(message), "</div>") : '', "<section class=\"card\"><h3>Order information</h3><div class=\"grid\">").concat(field('Order type', order.orderType)).concat(field('Requested by', order.requestedBy || session.username)).concat(field('Site contact', order.siteContact)).concat(field('Phone', order.phone)).concat(field('Requested delivery', delivery(order.requestedDeliveryDate, order.requestedDeliveryTime))).concat(field('Confirmed delivery', delivery(order.scheduledDeliveryDate, order.scheduledDeliveryTime)), "<div class=\"wide\">").concat(field('Location / notes', order.locationNotes), "</div></div>").concat(deliverySummary(order), "<h3>Items (").concat(((_order$items = order.items) === null || _order$items === void 0 ? void 0 : _order$items.length) || 0, ")</h3>").concat((order.items || []).map(function (item) {
      return "<div style=\"display:flex;gap:16px;padding:12px 0;border-bottom:1px solid #e2e8f0\"><strong style=\"min-width:48px\">".concat(esc(item.quantity), " \xD7</strong><span style=\"overflow-wrap:anywhere\">").concat(esc(item.description), "</span></div>");
    }).join('')).concat(order.local ? "<h3>Files waiting to upload</h3>".concat((order.attachments || []).map(function (file) {
      return "<p>".concat(esc(file.name), "</p>");
    }).join('') || '<p>No files attached.</p>', "<p>This request is saved on this device. It is not fully synced yet.</p>") : orderAttachmentControls(order)).concat(!order.local ? "<div class=\"actions\"><button data-export=\"pdf\" data-order-id=\"".concat(esc(order.id), "\">PDF</button><button data-export=\"xlsx\" data-order-id=\"").concat(esc(order.id), "\">Excel</button></div>") : '').concat(orderTimeline(order), "</section>");
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
  function chooseOrderFiles(_x2) {
    return _chooseOrderFiles.apply(this, arguments);
  }
  function _chooseOrderFiles() {
    _chooseOrderFiles = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee9(event) {
      var owner, version, _session0, _selectedOrderFiles, added, errorNode, _session1, _errorNode, _t8;
      return _regenerator().w(function (_context9) {
        while (1) switch (_context9.p = _context9.n) {
          case 0:
            if (!busy) {
              _context9.n = 1;
              break;
            }
            return _context9.a(2);
          case 1:
            captureDraft();
            owner = session.username, version = sessionVersion;
            busy = true;
            _context9.p = 2;
            added = Array.from(event.target.files || []).map(function (file) {
              return {
                id: crypto.randomUUID(),
                name: file.name,
                size: file.size,
                file: file
              };
            });
            validateOrderFiles(added, selectedOrderFiles);
            _context9.n = 3;
            return attachmentDb('put', added);
          case 3:
            if (!(sessionVersion !== version || ((_session0 = session) === null || _session0 === void 0 ? void 0 : _session0.username) !== owner)) {
              _context9.n = 4;
              break;
            }
            return _context9.a(2);
          case 4:
            (_selectedOrderFiles = selectedOrderFiles).push.apply(_selectedOrderFiles, _toConsumableArray(added));
            if (orderDraft) {
              orderDraft.attachments = selectedOrderFiles.map(function (_ref17) {
                var file = _ref17.file,
                  missing = _ref17.missing,
                  metadata = _objectWithoutProperties(_ref17, _excluded2);
                return metadata;
              });
              writeDraft();
            }
            captureDraft();
            renderSelectedOrderFiles();
            errorNode = root.querySelector('[data-file-error]');
            if (errorNode) errorNode.textContent = '';
            _context9.n = 6;
            break;
          case 5:
            _context9.p = 5;
            _t8 = _context9.v;
            _errorNode = root.querySelector('[data-file-error]');
            if (((_session1 = session) === null || _session1 === void 0 ? void 0 : _session1.username) === owner && _errorNode) _errorNode.textContent = _t8.message;
          case 6:
            _context9.p = 6;
            busy = false;
            event.target.value = '';
            return _context9.f(6);
          case 7:
            return _context9.a(2);
        }
      }, _callee9, null, [[2, 5, 6, 7]]);
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
  function queueExistingOrderFiles(_x3) {
    return _queueExistingOrderFiles.apply(this, arguments);
  }
  function _queueExistingOrderFiles() {
    _queueExistingOrderFiles = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee0(event) {
      var order, files, owner, packet, _session10, _t9;
      return _regenerator().w(function (_context0) {
        while (1) switch (_context0.p = _context0.n) {
          case 0:
            if (!busy) {
              _context0.n = 1;
              break;
            }
            return _context0.a(2);
          case 1:
            order = orders.find(function (item) {
              return item.id === event.target.dataset.attachOrder;
            });
            if (order) {
              _context0.n = 2;
              break;
            }
            return _context0.a(2);
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
              _context0.n = 3;
              break;
            }
            return _context0.a(2);
          case 3:
            owner = session.username;
            busy = true;
            _context0.p = 4;
            validateOrderFiles(files, order.attachments || []);
            if (!(outbox.queue.length && outbox.owner !== owner)) {
              _context0.n = 5;
              break;
            }
            throw Error('Sync the previous user’s saved requests first.');
          case 5:
            _context0.n = 6;
            return attachmentDb('put', files);
          case 6:
            if (!(((_session10 = session) === null || _session10 === void 0 ? void 0 : _session10.username) !== owner)) {
              _context0.n = 7;
              break;
            }
            throw Error('Your account changed. Select the files again.');
          case 7:
            packet = {
              localId: crypto.randomUUID(),
              idempotencyKey: crypto.randomUUID(),
              orderId: order.id,
              order: order,
              attachments: files.map(function (_ref18) {
                var file = _ref18.file,
                  metadata = _objectWithoutProperties(_ref18, _excluded3);
                return metadata;
              }),
              createdAt: new Date().toISOString()
            };
            outbox.owner = owner;
            outbox.queue.push(packet);
            saveOutbox();
            event.target.value = '';
            message = 'Files saved on this device, waiting to upload.';
            _context0.n = 9;
            break;
          case 8:
            _context0.p = 8;
            _t9 = _context0.v;
            if (packet) outbox.queue = outbox.queue.filter(function (item) {
              return item !== packet;
            });
            message = _t9.message;
          case 9:
            _context0.p = 9;
            busy = false;
            render();
            return _context0.f(9);
          case 10:
            void flush();
          case 11:
            return _context0.a(2);
        }
      }, _callee0, null, [[4, 8, 9, 10]]);
    }));
    return _queueExistingOrderFiles.apply(this, arguments);
  }
  function downloadOrderFile(_x4) {
    return _downloadOrderFile.apply(this, arguments);
  }
  function _downloadOrderFile() {
    _downloadOrderFile = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee1(button) {
      var response, result, url, link, _t0;
      return _regenerator().w(function (_context1) {
        while (1) switch (_context1.p = _context1.n) {
          case 0:
            button.disabled = true;
            _context1.p = 1;
            _context1.n = 2;
            return api('/orders/' + button.dataset.orderId + '/attachments/' + button.dataset.orderFile);
          case 2:
            response = _context1.v;
            _context1.n = 3;
            return response.json();
          case 3:
            result = _context1.v;
            if (response.ok) {
              _context1.n = 4;
              break;
            }
            throw Error(result.error || 'Attachment could not be downloaded.');
          case 4:
            url = URL.createObjectURL(new Blob([Uint8Array.from(atob(result.file.data), function (c) {
              return c.charCodeAt(0);
            })], {
              type: 'application/octet-stream'
            })), link = document.createElement('a');
            link.href = url;
            link.download = result.file.name;
            document.body.append(link);
            link.click();
            link.remove();
            setTimeout(function () {
              return URL.revokeObjectURL(url);
            }, 60000);
            _context1.n = 6;
            break;
          case 5:
            _context1.p = 5;
            _t0 = _context1.v;
            message = _t0.message;
            render();
          case 6:
            _context1.p = 6;
            button.disabled = false;
            return _context1.f(6);
          case 7:
            return _context1.a(2);
        }
      }, _callee1, null, [[1, 5, 6, 7]]);
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
  if (((_session5 = session) === null || _session5 === void 0 ? void 0 : _session5.expiresAt) <= Date.now()) clearAccountState();
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
    } catch (_unused2) {
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
    historyState = {};
    orderQuery = '';
    orderProject = '';
    orderRequester = '';
    orderDelivery = '';
  }
  function api(_x5) {
    return _api.apply(this, arguments);
  }
  function _api() {
    _api = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee11(path) {
      var _session11;
      var options,
        version,
        token,
        headers,
        current,
        response,
        json,
        _args11 = arguments;
      return _regenerator().w(function (_context11) {
        while (1) switch (_context11.n) {
          case 0:
            options = _args11.length > 1 && _args11[1] !== undefined ? _args11[1] : {};
            version = sessionVersion, token = ((_session11 = session) === null || _session11 === void 0 ? void 0 : _session11.token) || null, headers = new Headers(options.headers || {});
            if (token) headers.set('Authorization', 'Bearer ' + token);
            current = function current() {
              var _session12;
              return version === sessionVersion && token === (((_session12 = session) === null || _session12 === void 0 ? void 0 : _session12.token) || null);
            };
            _context11.n = 1;
            return fetch(API + path, _objectSpread(_objectSpread({}, options), {}, {
              headers: headers,
              cache: 'no-store',
              signal: options.signal || AbortSignal.timeout(20000)
            }));
          case 1:
            response = _context11.v;
            if (current()) {
              _context11.n = 2;
              break;
            }
            throw Error('Session changed. Please sign in again.');
          case 2:
            if (!(response.status === 401 && token)) {
              _context11.n = 3;
              break;
            }
            clearAccountState();
            message = 'Your session expired. Sign in again; saved requests remain on this device.';
            render();
            throw Error(message);
          case 3:
            // A response arriving or finishing JSON decoding after logout cannot restore old account data.
            json = response.json.bind(response);
            response.json = /*#__PURE__*/_asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee10() {
              var data;
              return _regenerator().w(function (_context10) {
                while (1) switch (_context10.n) {
                  case 0:
                    _context10.n = 1;
                    return json();
                  case 1:
                    data = _context10.v;
                    if (current()) {
                      _context10.n = 2;
                      break;
                    }
                    throw Error('Session changed. Please sign in again.');
                  case 2:
                    return _context10.a(2, data);
                }
              }, _callee10);
            }));
            return _context11.a(2, response);
        }
      }, _callee11);
    }));
    return _api.apply(this, arguments);
  }
  function login(_x6) {
    return _login.apply(this, arguments);
  }
  function _login() {
    _login = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee12(event) {
      var form, remember, response, result, _t1;
      return _regenerator().w(function (_context12) {
        while (1) switch (_context12.p = _context12.n) {
          case 0:
            event.preventDefault();
            if (!busy) {
              _context12.n = 1;
              break;
            }
            return _context12.a(2);
          case 1:
            busy = true;
            message = '';
            form = new FormData(event.currentTarget), remember = form.get('remember');
            render();
            _context12.p = 2;
            _context12.n = 3;
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
            response = _context12.v;
            _context12.n = 4;
            return response.json();
          case 4:
            result = _context12.v;
            if (response.ok) {
              _context12.n = 5;
              break;
            }
            throw Error(result.error || 'Login failed');
          case 5:
            if (!result.mustChangePin) {
              _context12.n = 6;
              break;
            }
            pendingSetup = {
              username: form.get('username'),
              pin: form.get('pin'),
              remember: !!remember
            };
            return _context12.a(2);
          case 6:
            session = {
              token: result.token,
              username: result.username,
              isAdmin: result.isAdmin,
              taskAccess: result.taskAccess || {},
              expiresAt: result.expiresAt
            };
            sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
            if (remember) localStorage.setItem(USERNAME_KEY, result.username);else localStorage.removeItem(USERNAME_KEY);
            _context12.n = 7;
            return refresh();
          case 7:
            _context12.n = 8;
            return flush();
          case 8:
            _context12.n = 10;
            break;
          case 9:
            _context12.p = 9;
            _t1 = _context12.v;
            message = _t1.message || 'Could not reach the server — check your connection.';
          case 10:
            _context12.p = 10;
            busy = false;
            render();
            return _context12.f(10);
          case 11:
            return _context12.a(2);
        }
      }, _callee12, null, [[2, 9, 10, 11]]);
    }));
    return _login.apply(this, arguments);
  }
  function register(_x7) {
    return _register.apply(this, arguments);
  }
  function _register() {
    _register = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee13(event) {
      var form, response, result, _t10;
      return _regenerator().w(function (_context13) {
        while (1) switch (_context13.p = _context13.n) {
          case 0:
            event.preventDefault();
            if (!busy) {
              _context13.n = 1;
              break;
            }
            return _context13.a(2);
          case 1:
            busy = true;
            message = '';
            form = new FormData(event.currentTarget);
            if (!(form.get('newPin') !== form.get('confirmPin'))) {
              _context13.n = 2;
              break;
            }
            busy = false;
            message = 'The new PINs do not match.';
            render();
            return _context13.a(2);
          case 2:
            _context13.p = 2;
            _context13.n = 3;
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
            response = _context13.v;
            _context13.n = 4;
            return response.json();
          case 4:
            result = _context13.v;
            if (response.ok) {
              _context13.n = 5;
              break;
            }
            throw Error(result.error || 'PIN could not be set');
          case 5:
            session = {
              token: result.token,
              username: result.username,
              isAdmin: result.isAdmin,
              taskAccess: result.taskAccess || {},
              expiresAt: result.expiresAt
            };
            sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
            if (pendingSetup.remember) localStorage.setItem(USERNAME_KEY, result.username);
            pendingSetup = null;
            _context13.n = 6;
            return refresh();
          case 6:
            _context13.n = 8;
            break;
          case 7:
            _context13.p = 7;
            _t10 = _context13.v;
            message = _t10.message || 'Could not reach the server.';
          case 8:
            _context13.p = 8;
            busy = false;
            render();
            return _context13.f(8);
          case 9:
            return _context13.a(2);
        }
      }, _callee13, null, [[2, 7, 8, 9]]);
    }));
    return _register.apply(this, arguments);
  }
  var can = function can(task) {
    var _session6, _session7;
    return ((_session6 = session) === null || _session6 === void 0 ? void 0 : _session6.isAdmin) || ((_session7 = session) === null || _session7 === void 0 || (_session7 = _session7.taskAccess) === null || _session7 === void 0 ? void 0 : _session7[task]) !== false;
  };
  function refresh() {
    return _refresh.apply(this, arguments);
  }
  function _refresh() {
    _refresh = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee18() {
      var version, sessionResponse, current, requests, _t13;
      return _regenerator().w(function (_context18) {
        while (1) switch (_context18.p = _context18.n) {
          case 0:
            if (session) {
              _context18.n = 1;
              break;
            }
            return _context18.a(2);
          case 1:
            version = sessionVersion;
            _context18.p = 2;
            _context18.n = 3;
            return api('/session');
          case 3:
            sessionResponse = _context18.v;
            if (!sessionResponse.ok) {
              _context18.n = 5;
              break;
            }
            _context18.n = 4;
            return sessionResponse.json();
          case 4:
            current = _context18.v;
            session = _objectSpread(_objectSpread({}, session), {}, {
              isAdmin: current.isAdmin,
              taskAccess: current.taskAccess || {}
            });
            sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
          case 5:
            requests = [api('/profile').then(/*#__PURE__*/function () {
              var _ref20 = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee14(response) {
                return _regenerator().w(function (_context14) {
                  while (1) switch (_context14.n) {
                    case 0:
                      if (!response.ok) {
                        _context14.n = 2;
                        break;
                      }
                      _context14.n = 1;
                      return response.json();
                    case 1:
                      profile = _context14.v.profile;
                    case 2:
                      return _context14.a(2);
                  }
                }, _callee14);
              }));
              return function (_x17) {
                return _ref20.apply(this, arguments);
              };
            }()), api('/support').then(/*#__PURE__*/function () {
              var _ref21 = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee15(response) {
                var _t11;
                return _regenerator().w(function (_context15) {
                  while (1) switch (_context15.n) {
                    case 0:
                      if (!response.ok) {
                        _context15.n = 3;
                        break;
                      }
                      _context15.n = 1;
                      return response.json();
                    case 1:
                      _t11 = _context15.v.tickets;
                      if (_t11) {
                        _context15.n = 2;
                        break;
                      }
                      _t11 = [];
                    case 2:
                      supportTickets = _t11;
                    case 3:
                      return _context15.a(2);
                  }
                }, _callee15);
              }));
              return function (_x18) {
                return _ref21.apply(this, arguments);
              };
            }()), can('site.orders.view') ? api('/orders').then(/*#__PURE__*/function () {
              var _ref22 = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee16(response) {
                var result;
                return _regenerator().w(function (_context16) {
                  while (1) switch (_context16.n) {
                    case 0:
                      if (!response.ok) {
                        _context16.n = 2;
                        break;
                      }
                      _context16.n = 1;
                      return response.json();
                    case 1:
                      result = _context16.v;
                      orders = result.orders || [];
                      orderTypes = Array.isArray(result.orderTypes) ? result.orderTypes : [].concat(DEFAULT_ORDER_TYPES);
                      projects = (result.projectRecords || (result.projects || []).map(function (name) {
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
                      return _context16.a(2);
                  }
                }, _callee16);
              }));
              return function (_x19) {
                return _ref22.apply(this, arguments);
              };
            }()) : Promise.resolve(), can('site.cnc.view') ? api('/site/cnc').then(/*#__PURE__*/function () {
              var _ref23 = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee17(response) {
                var _t12;
                return _regenerator().w(function (_context17) {
                  while (1) switch (_context17.n) {
                    case 0:
                      if (!response.ok) {
                        _context17.n = 3;
                        break;
                      }
                      _context17.n = 1;
                      return response.json();
                    case 1:
                      _t12 = _context17.v.cncPanels;
                      if (_t12) {
                        _context17.n = 2;
                        break;
                      }
                      _t12 = [];
                    case 2:
                      cncPanels = _t12;
                    case 3:
                      return _context17.a(2);
                  }
                }, _callee17);
              }));
              return function (_x20) {
                return _ref23.apply(this, arguments);
              };
            }()) : Promise.resolve()];
            _context18.n = 6;
            return Promise.all(requests);
          case 6:
            _context18.n = 8;
            break;
          case 7:
            _context18.p = 7;
            _t13 = _context18.v;
            if (version === sessionVersion) message = 'Showing saved information. Connect to refresh.';
          case 8:
            return _context18.a(2);
        }
      }, _callee18, null, [[2, 7]]);
    }));
    return _refresh.apply(this, arguments);
  }
  function flush() {
    return _flush.apply(this, arguments);
  }
  function _flush() {
    _flush = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee19() {
      var owner, version, current, packet, response, result, _iterator4, _step4, metadata, file, data, _response, _result, _t14, _t15, _t16;
      return _regenerator().w(function (_context19) {
        while (1) switch (_context19.p = _context19.n) {
          case 0:
            if (!(busy || !session || !navigator.onLine || !outbox.queue.length || outbox.owner !== session.username)) {
              _context19.n = 1;
              break;
            }
            return _context19.a(2);
          case 1:
            owner = session.username, version = sessionVersion;
            busy = true;
            render();
            current = function current() {
              var _session13;
              if (((_session13 = session) === null || _session13 === void 0 ? void 0 : _session13.username) !== owner || version !== sessionVersion) throw Error('Your account changed. Sign back in to finish uploading.');
            };
            _context19.p = 2;
          case 3:
            if (!outbox.queue.length) {
              _context19.n = 24;
              break;
            }
            current();
            packet = outbox.queue[0];
            if (packet.orderId) {
              _context19.n = 7;
              break;
            }
            _context19.n = 4;
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
            response = _context19.v;
            _context19.n = 5;
            return response.json();
          case 5:
            result = _context19.v;
            current();
            if (response.ok) {
              _context19.n = 6;
              break;
            }
            throw Error(result.error || 'Order submission failed');
          case 6:
            packet.orderId = result.order.id;
            saveOutbox();
          case 7:
            _iterator4 = _createForOfIteratorHelper(packet.attachments || []);
            _context19.p = 8;
            _iterator4.s();
          case 9:
            if ((_step4 = _iterator4.n()).done) {
              _context19.n = 16;
              break;
            }
            metadata = _step4.value;
            _context19.n = 10;
            return attachmentDb('get', metadata.id);
          case 10:
            file = _context19.v;
            current();
            if (file) {
              _context19.n = 11;
              break;
            }
            throw Error('A saved attachment is unavailable on this device. The order has been submitted; add the file again.');
          case 11:
            _context19.n = 12;
            return attachmentData(file);
          case 12:
            data = _context19.v;
            current();
            _context19.n = 13;
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
            _response = _context19.v;
            _context19.n = 14;
            return _response.json();
          case 14:
            _result = _context19.v;
            current();
            if (_response.ok) {
              _context19.n = 15;
              break;
            }
            throw Error(_result.error || 'Attachment upload failed. Retry when connected.');
          case 15:
            _context19.n = 9;
            break;
          case 16:
            _context19.n = 18;
            break;
          case 17:
            _context19.p = 17;
            _t14 = _context19.v;
            _iterator4.e(_t14);
          case 18:
            _context19.p = 18;
            _iterator4.f();
            return _context19.f(18);
          case 19:
            outbox.queue.shift();
            _context19.p = 20;
            saveOutbox();
            _context19.n = 22;
            break;
          case 21:
            _context19.p = 21;
            _t15 = _context19.v;
            outbox.queue.unshift(packet);
            throw _t15;
          case 22:
            _context19.n = 23;
            return attachmentDb('delete', packet.attachments || []);
          case 23:
            _context19.n = 3;
            break;
          case 24:
            message = 'Order request and attachments submitted.';
            _context19.n = 25;
            return refresh();
          case 25:
            _context19.n = 27;
            break;
          case 26:
            _context19.p = 26;
            _t16 = _context19.v;
            message = _t16.message || 'Request and files remain saved on this device.';
          case 27:
            _context19.p = 27;
            busy = false;
            render();
            return _context19.f(27);
          case 28:
            return _context19.a(2);
        }
      }, _callee19, null, [[20, 21], [8, 17, 18, 19], [2, 26, 27, 28]]);
    }));
    return _flush.apply(this, arguments);
  }
  function shell(content) {
    return "<main class=\"shell\"><header class=\"topbar\"><div class=\"brand\"><img src=\"/icon-512.png\" alt=\"Lennox Facades\"></div></header><div class=\"content\">".concat(content, "</div><nav class=\"bottom-nav\">").concat(can('site.orders.view') ? "<button data-orders class=\"".concat(view === 'orders' || view === 'new' || view === 'order' ? 'active' : '', "\"><span class=\"nav-icon\">\u25A4</span><span>Orders</span></button>") : '').concat(can('site.cnc.view') ? "<button data-cnc class=\"".concat(view === 'cnc' ? 'active' : '', "\"><span class=\"nav-icon\">").concat(CNC_ICON, "</span><span>CNC</span></button>") : '', "<button data-support class=\"").concat(view === 'support' ? 'active' : '', "\"><span class=\"nav-icon\">").concat(SUPPORT_ICON, "</span><span>Support</span></button><button data-settings class=\"").concat(view === 'settings' ? 'active' : '', "\"><span class=\"nav-icon\">").concat(SETTINGS_ICON, "</span><span>Settings</span></button></nav></main>");
  }
  function loginScreen() {
    var _root$querySelector, _root$querySelector2;
    var remembered = localStorage.getItem(USERNAME_KEY) || '';
    root.innerHTML = "<section class=\"login\"><div class=\"brand\"><img src=\"/icon-512.png\" alt=\"Lennox Facades\"><div><h1>Site Orders</h1></div></div><h2 class=\"login-title\"><span class=\"person\">\u2659</span>".concat(pendingSetup ? 'Set a new PIN' : 'Log in to PanelStock', "</h2>").concat(message ? "<div class=\"notice\">".concat(esc(message), "</div>") : '').concat(pendingSetup ? "<form data-register><p class=\"login-help\">Your account was created by an administrator. Choose your personal PIN.</p><label>New PIN<input name=\"newPin\" type=\"password\" inputmode=\"numeric\" pattern=\"[0-9]{6,12}\" placeholder=\"6\u201312 digits\" required></label><label>Confirm new PIN<input name=\"confirmPin\" type=\"password\" inputmode=\"numeric\" pattern=\"[0-9]{6,12}\" placeholder=\"Re-enter PIN\" required></label><button class=\"primary\" type=\"submit\" ".concat(busy ? 'disabled' : '', ">").concat(busy ? 'Saving…' : 'Set PIN & continue', "</button></form>") : "<form data-login><label>Username<input name=\"username\" autocomplete=\"username\" value=\"".concat(esc(remembered), "\" placeholder=\"e.g. Sam\" required></label><label>PIN<input name=\"pin\" type=\"password\" inputmode=\"numeric\" autocomplete=\"current-password\" placeholder=\"Your PIN\" required></label><label class=\"remember\"><input name=\"remember\" type=\"checkbox\" checked>Remember my username on this device</label><button class=\"primary\" type=\"submit\" ").concat(busy ? 'disabled' : '', ">").concat(busy ? 'Checking…' : 'Log in', "</button></form>"), "</section>");
    (_root$querySelector = root.querySelector('[data-login]')) === null || _root$querySelector === void 0 || _root$querySelector.addEventListener('submit', login);
    (_root$querySelector2 = root.querySelector('[data-register]')) === null || _root$querySelector2 === void 0 || _root$querySelector2.addEventListener('submit', register);
  }
  function orderList() {
    var pending = pendingOrders(),
      all = [].concat(_toConsumableArray(pending), _toConsumableArray(orders)),
      matches = function matches(order) {
        return orderFilter === 'active' ? order.local || ['submitted', 'ordered', 'approved'].includes(order.status) : order.status === orderFilter;
      },
      shown = all.filter(function (order) {
        return matches(order) && matchesOrder(order);
      }),
      active = all.filter(function (order) {
        return order.local || ['submitted', 'ordered', 'approved'].includes(order.status);
      }).length,
      completed = all.filter(function (order) {
        return order.status === 'completed';
      }).length,
      cancelled = all.filter(function (order) {
        return order.status === 'cancelled';
      }).length;
    return "<div class=\"toolbar\"><div><h2 style=\"margin:0\">Order requests</h2><small>".concat(orders.length, " submitted \xB7 ").concat(pending.length, " waiting to sync</small></div>").concat(can('site.orders.create') ? "<button class=\"primary\" data-new>".concat(savedDraft() || orderDraft && draftOwner === session.username ? 'Continue draft' : '+ New order', "</button>") : '', "</div>").concat(message ? "<div class=\"notice ".concat(message.includes('submitted') ? 'success' : '', "\">").concat(esc(message)).concat(pending.length ? " <button data-retry>".concat(busy ? 'Syncing…' : 'Retry', "</button>") : '', "</div>") : '').concat(orderSearchControls(all), "<div class=\"order-filters\"><button data-order-filter=\"active\" class=\"").concat(orderFilter === 'active' ? 'active' : '', "\">Submitted / Ordered (").concat(active, ")</button><button data-order-filter=\"completed\" class=\"").concat(orderFilter === 'completed' ? 'active' : '', "\">Completed (").concat(completed, ")</button><button data-order-filter=\"cancelled\" class=\"").concat(orderFilter === 'cancelled' ? 'active' : '', "\">Cancelled (").concat(cancelled, ")</button></div><p role=\"status\">").concat(shown.length, " matching order").concat(shown.length === 1 ? '' : 's', "</p><section class=\"card\">").concat(shown.map(function (order) {
      var _order$items2, _order$items3;
      return "<article class=\"order\"><div><strong>#".concat(esc(order.orderNumber), " \xB7 ").concat(esc(order.project), "</strong><br><small><span class=\"status\">").concat(esc(order.status), "</span> \xB7 ").concat(((_order$items2 = order.items) === null || _order$items2 === void 0 ? void 0 : _order$items2.length) || 0, " item").concat(((_order$items3 = order.items) === null || _order$items3 === void 0 ? void 0 : _order$items3.length) === 1 ? '' : 's', " \xB7 ").concat(esc(new Date(order.createdAt).toLocaleString('en-AU')), "</small>").concat(deliverySummary(order), "</div><div class=\"actions\"><button data-order-details=\"").concat(esc(order.id), "\">View order</button>").concat(order.local ? '' : "<button class=\"export-button\" data-export=\"pdf\" data-order-id=\"".concat(esc(order.id), "\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" aria-hidden=\"true\"><path d=\"M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v7H6z\"/></svg>PDF</button><button class=\"export-button\" data-export=\"xlsx\" data-order-id=\"").concat(esc(order.id), "\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" aria-hidden=\"true\"><path d=\"M14 2H6a2 2 0 0 0-2 2v16h16V8zM14 2v6h6M8 12h8M8 16h8\"/></svg>Excel</button>")).concat(can('site.orders.manage') && !order.local ? "<select data-status=\"".concat(esc(order.id), "\" aria-label=\"Order status\"><option value=\"submitted\">Submitted</option><option value=\"ordered\">Ordered</option><option value=\"completed\">Completed</option><option value=\"cancelled\">Cancelled</option></select>") : '', "</div></article>");
    }).join('') || '<div class="empty">No orders match these filters.</div>', "</section>");
  }
  function newOrder() {
    var _profile;
    var today = dateIso(new Date()),
      defaults = ((_profile = profile) === null || _profile === void 0 ? void 0 : _profile.siteOrderDefaults) || {};
    return "<div class=\"toolbar\"><h2 style=\"margin:0\">New site order</h2><button data-cancel>Save &amp; close</button></div><p data-draft-notice role=\"status\">".concat(esc(draftNotice), "</p>").concat(discardDraftArmed ? '<div class="notice">Discard this unfinished order and its saved files? <button type="button" data-discard-draft>Yes, discard draft</button><button type="button" data-keep-draft>Keep editing</button></div>' : '').concat(message ? "<div class=\"notice\">".concat(esc(message), "</div>") : '', "<form class=\"card\" data-order><div class=\"grid\"><label>Project<select name=\"projectId\" required><option value=\"\">Select a project</option>").concat(projects.map(function (project) {
      return "<option value=\"".concat(esc(project.id || project.name), "\">").concat(esc(project.name), "</option>");
    }).join(''), "</select></label><label>Order type<select name=\"orderType\">").concat(_toConsumableArray(orderTypes).sort(function (a, b) {
      return a.localeCompare(b, 'en', {
        sensitivity: 'base'
      });
    }).map(function (type) {
      return "<option value=\"".concat(esc(type), "\" ").concat(type === 'Panels' ? 'selected' : '', ">").concat(esc(type), "</option>");
    }).join(''), "</select></label><label>Site contact<input name=\"siteContact\" maxlength=\"100\" value=\"").concat(esc(defaults.siteContact || ''), "\" required></label><label>Phone<input name=\"phone\" type=\"tel\" inputmode=\"tel\" maxlength=\"40\" value=\"").concat(esc(defaults.phone || ''), "\" required></label><label>Requested delivery date<input name=\"requestedDeliveryDate\" type=\"hidden\" value=\"").concat(today, "\"><button class=\"date-trigger\" data-date-picker type=\"button\"><span>").concat(esc(formatDate(today)), "</span><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><rect x=\"3\" y=\"5\" width=\"18\" height=\"16\" rx=\"2\"></rect><path d=\"M16 3v4M8 3v4M3 10h18\"></path><path d=\"M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01\"></path></svg></button></label><label>Requested delivery time<input name=\"requestedDeliveryTime\" type=\"time\"></label><label class=\"wide\">Location / notes<textarea name=\"locationNotes\" maxlength=\"300\" rows=\"3\"></textarea></label></div>").concat(projects.length ? '' : '<div class="notice">No projects are available yet. Ask an administrator to add one on Web.</div>', "<section class=\"order-attachments\"><h3>Files and photos</h3><small>Up to 10 files \xB7 5 MB each \xB7 25 MB total</small><div class=\"order-upload-actions\"><label class=\"order-upload-button order-upload-primary\"><svg aria-hidden=\"true\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5\"/></svg>Choose files<input aria-label=\"Choose order files\" type=\"file\" multiple data-order-files></label><label class=\"order-upload-button\"><svg aria-hidden=\"true\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M14 4h-4l-2 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-4z\"/><circle cx=\"12\" cy=\"13\" r=\"4\"/></svg>Take photo<input aria-label=\"Take order photo\" type=\"file\" accept=\"image/*\" capture=\"environment\" data-order-files></label></div><p data-file-error role=\"alert\"></p><div data-selected-order-files></div></section><div class=\"items\"><h3>Items</h3></div><div class=\"actions\"><button data-add type=\"button\">Add item</button><button type=\"button\" data-discard-draft>Discard draft</button><button class=\"primary\" type=\"submit\" ").concat(projects.length ? '' : 'disabled', ">Submit request</button></div></form>");
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
    var _session8;
    return (_session8 = session) !== null && _session8 !== void 0 && _session8.isAdmin ? "<form class=\"card\" data-order-type><h3>Order types</h3><p>".concat(orderTypes.map(esc).join(' · '), "</p><label>New order type<input name=\"name\" maxlength=\"80\" required></label><button class=\"primary\" type=\"submit\" ").concat(busy ? 'disabled' : '', ">Add order type</button></form>") : '';
  }
  function saveOrderType(_x8) {
    return _saveOrderType.apply(this, arguments);
  }
  function _saveOrderType() {
    _saveOrderType = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee20(event) {
      var _session14;
      var name, button, response, result, _t17;
      return _regenerator().w(function (_context20) {
        while (1) switch (_context20.p = _context20.n) {
          case 0:
            event.preventDefault();
            if (!(!((_session14 = session) !== null && _session14 !== void 0 && _session14.isAdmin) || busy)) {
              _context20.n = 1;
              break;
            }
            return _context20.a(2);
          case 1:
            name = new FormData(event.currentTarget).get('name');
            busy = true;
            button = event.currentTarget.querySelector('button');
            button.disabled = true;
            _context20.p = 2;
            _context20.n = 3;
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
            response = _context20.v;
            _context20.n = 4;
            return response.json();
          case 4:
            result = _context20.v;
            if (response.ok) {
              _context20.n = 5;
              break;
            }
            throw Error(result.error || 'Order type could not be added.');
          case 5:
            orderTypes = result.orderTypes;
            localStorage.setItem(PROJECTS_KEY, JSON.stringify({
              owner: session.username,
              projects: projects,
              orderTypes: orderTypes
            }));
            message = 'Order type added.';
            _context20.n = 7;
            break;
          case 6:
            _context20.p = 6;
            _t17 = _context20.v;
            message = _t17.message;
          case 7:
            _context20.p = 7;
            busy = false;
            render();
            return _context20.f(7);
          case 8:
            return _context20.a(2);
        }
      }, _callee20, null, [[2, 6, 7, 8]]);
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
    rows.forEach(function (row, index) {
      var quantity = row.querySelector('[name=quantity]'),
        description = row.querySelector('[name=description]');
      // An untouched final row is a convenience, not a required order item.
      var blankTail = index === rows.length - 1 && !description.value.trim() && quantity.value === '1';
      description.required = !blankTail;
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
  function submitOrder(_x9) {
    return _submitOrder.apply(this, arguments);
  }
  function _submitOrder() {
    _submitOrder = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee21(event) {
      var form, selected, items, order, owner, packet, _session15, _orderDraft3, _t18;
      return _regenerator().w(function (_context21) {
        while (1) switch (_context21.p = _context21.n) {
          case 0:
            event.preventDefault();
            if (!busy) {
              _context21.n = 1;
              break;
            }
            return _context21.a(2);
          case 1:
            captureDraft();
            if (!selectedOrderFiles.some(function (file) {
              return file.missing;
            })) {
              _context21.n = 2;
              break;
            }
            root.querySelector('[data-file-error]').textContent = 'Remove unavailable files and attach them again before submitting.';
            return _context21.a(2);
          case 2:
            form = new FormData(event.currentTarget), selected = projects.find(function (project) {
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
              _context21.n = 3;
              break;
            }
            message = 'Add at least one item.';
            render();
            return _context21.a(2);
          case 3:
            if (!(outbox.queue.length && outbox.owner !== session.username)) {
              _context21.n = 4;
              break;
            }
            message = "Saved requests on this device belong to ".concat(outbox.owner, ".");
            view = 'orders';
            render();
            return _context21.a(2);
          case 4:
            if (selected) {
              _context21.n = 5;
              break;
            }
            message = 'Choose an available project before submitting.';
            render();
            return _context21.a(2);
          case 5:
            order = {
              projectId: (selected === null || selected === void 0 ? void 0 : selected.id) || null,
              project: (selected === null || selected === void 0 ? void 0 : selected.name) || form.get('projectId'),
              orderType: form.get('orderType'),
              siteContact: form.get('siteContact'),
              phone: form.get('phone'),
              requestedDeliveryDate: form.get('requestedDeliveryDate'),
              requestedDeliveryTime: form.get('requestedDeliveryTime'),
              locationNotes: form.get('locationNotes'),
              items: items
            };
            owner = session.username;
            busy = true;
            _context21.p = 6;
            validateOrderFiles(selectedOrderFiles);
            _context21.n = 7;
            return attachmentDb('put', selectedOrderFiles);
          case 7:
            if (!(((_session15 = session) === null || _session15 === void 0 ? void 0 : _session15.username) !== owner)) {
              _context21.n = 8;
              break;
            }
            throw Error('Your account changed. Submit the order again.');
          case 8:
            packet = {
              localId: crypto.randomUUID(),
              idempotencyKey: ((_orderDraft3 = orderDraft) === null || _orderDraft3 === void 0 ? void 0 : _orderDraft3.id) || crypto.randomUUID(),
              order: order,
              attachments: selectedOrderFiles.map(function (_ref24) {
                var file = _ref24.file,
                  metadata = _objectWithoutProperties(_ref24, _excluded4);
                return metadata;
              }),
              createdAt: new Date().toISOString()
            };
            outbox.owner = owner;
            outbox.queue.push(packet);
            saveOutbox();
            try {
              localStorage.removeItem(DRAFT_KEY + owner);
            } catch (_unused6) {}
            orderDraft = null;
            draftOwner = '';
            selectedOrderFiles = [];
            _context21.n = 10;
            break;
          case 9:
            _context21.p = 9;
            _t18 = _context21.v;
            if (packet) outbox.queue = outbox.queue.filter(function (item) {
              return item !== packet;
            });
            root.querySelector('[data-file-error]').textContent = _t18.message;
            return _context21.a(2);
          case 10:
            _context21.p = 10;
            busy = false;
            return _context21.f(10);
          case 11:
            view = 'orders';
            message = navigator.onLine ? 'Submitting request…' : 'Request saved on this device and will submit when connected.';
            render();
            void flush();
          case 12:
            return _context21.a(2);
        }
      }, _callee21, null, [[6, 9, 10, 11]]);
    }));
    return _submitOrder.apply(this, arguments);
  }
  function downloadOrder(_x0) {
    return _downloadOrder.apply(this, arguments);
  }
  function _downloadOrder() {
    _downloadOrder = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee23(button) {
      var format, id, original, preview, ticket, _yield$Promise$all, _yield$Promise$all2, previewToken, downloadToken, base, link, fileToken, _t19;
      return _regenerator().w(function (_context23) {
        while (1) switch (_context23.p = _context23.n) {
          case 0:
            format = button.dataset.export, id = button.dataset.orderId, original = button.innerHTML, preview = format === 'pdf' ? window.open('about:blank', '_blank') : null;
            button.disabled = true;
            button.textContent = 'Preparing…';
            if (preview) preview.opener = null;
            ticket = /*#__PURE__*/function () {
              var _ticket = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee22() {
                var response, result;
                return _regenerator().w(function (_context22) {
                  while (1) switch (_context22.n) {
                    case 0:
                      _context22.n = 1;
                      return api('/orders/' + id + '/pdf-link', {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json'
                        },
                        body: '{}'
                      });
                    case 1:
                      response = _context22.v;
                      _context22.n = 2;
                      return response.json();
                    case 2:
                      result = _context22.v;
                      if (!(!response.ok || !result.pdfToken)) {
                        _context22.n = 3;
                        break;
                      }
                      throw Error(result.error || 'Order file could not be generated');
                    case 3:
                      return _context22.a(2, result.pdfToken);
                  }
                }, _callee22);
              }));
              function ticket() {
                return _ticket.apply(this, arguments);
              }
              return ticket;
            }();
            _context23.p = 1;
            if (!(format === 'pdf')) {
              _context23.n = 3;
              break;
            }
            _context23.n = 2;
            return Promise.all([ticket(), ticket()]);
          case 2:
            _yield$Promise$all = _context23.v;
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
            _context23.n = 5;
            break;
          case 3:
            _context23.n = 4;
            return ticket();
          case 4:
            fileToken = _context23.v;
            window.location.assign(API + '/orders/' + id + '/' + format + '?ticket=' + encodeURIComponent(fileToken));
          case 5:
            _context23.n = 7;
            break;
          case 6:
            _context23.p = 6;
            _t19 = _context23.v;
            if (preview && !preview.closed) preview.close();
            message = _t19.message;
            render();
          case 7:
            _context23.p = 7;
            if (button.isConnected) {
              button.disabled = false;
              button.innerHTML = original;
            }
            return _context23.f(7);
          case 8:
            return _context23.a(2);
        }
      }, _callee23, null, [[1, 6, 7, 8]]);
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
  function saveProfile(_x1) {
    return _saveProfile.apply(this, arguments);
  }
  function _saveProfile() {
    _saveProfile = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee24(event) {
      var form, payload, response, result, _t20;
      return _regenerator().w(function (_context24) {
        while (1) switch (_context24.p = _context24.n) {
          case 0:
            event.preventDefault();
            busy = true;
            message = '';
            form = new FormData(event.currentTarget);
            _context24.p = 1;
            payload = {
              displayName: form.get('displayName'),
              email: form.get('email'),
              siteOrderDefaults: {
                siteContact: form.get('defaultSiteContact') || '',
                phone: form.get('defaultSitePhone') || ''
              }
            };
            if (!selectedProfilePhoto) {
              _context24.n = 3;
              break;
            }
            _context24.n = 2;
            return cropProfilePhoto(selectedProfilePhoto, profileAdjustment);
          case 2:
            payload.profilePhoto = _context24.v;
          case 3:
            _context24.n = 4;
            return api('/profile', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(payload)
            });
          case 4:
            response = _context24.v;
            _context24.n = 5;
            return response.json();
          case 5:
            result = _context24.v;
            if (response.ok) {
              _context24.n = 6;
              break;
            }
            throw Error(result.error || 'Profile could not be saved.');
          case 6:
            profile = result.profile;
            selectedProfilePhoto = null;
            profileAdjustment = {
              zoom: 1,
              x: 50,
              y: 50
            };
            message = 'Profile saved.';
            _context24.n = 8;
            break;
          case 7:
            _context24.p = 7;
            _t20 = _context24.v;
            message = _t20.message || 'Could not reach the server.';
          case 8:
            _context24.p = 8;
            busy = false;
            render();
            return _context24.f(8);
          case 9:
            return _context24.a(2);
        }
      }, _callee24, null, [[1, 7, 8, 9]]);
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
      return function (_x10) {
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
    var _profile2, _root$querySelector3;
    if (event.target.closest('[data-adjust-current]') && (_profile2 = profile) !== null && _profile2 !== void 0 && _profile2.profilePhoto) {
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
    if (event.target.closest('[data-save-photo]')) (_root$querySelector3 = root.querySelector('[data-profile]')) === null || _root$querySelector3 === void 0 || _root$querySelector3.requestSubmit();
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
    _removeProfilePhoto = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee25() {
      var _profile3;
      var response, result, _t21;
      return _regenerator().w(function (_context25) {
        while (1) switch (_context25.p = _context25.n) {
          case 0:
            if ((_profile3 = profile) !== null && _profile3 !== void 0 && _profile3.profilePhoto) {
              _context25.n = 1;
              break;
            }
            return _context25.a(2);
          case 1:
            busy = true;
            message = '';
            _context25.p = 2;
            _context25.n = 3;
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
            response = _context25.v;
            _context25.n = 4;
            return response.json();
          case 4:
            result = _context25.v;
            if (response.ok) {
              _context25.n = 5;
              break;
            }
            throw Error(result.error || 'Profile photo could not be removed.');
          case 5:
            profile = result.profile;
            message = 'Profile photo removed.';
            _context25.n = 7;
            break;
          case 6:
            _context25.p = 6;
            _t21 = _context25.v;
            message = _t21.message || 'Could not reach the server.';
          case 7:
            _context25.p = 7;
            busy = false;
            render();
            return _context25.f(7);
          case 8:
            return _context25.a(2);
        }
      }, _callee25, null, [[2, 6, 7, 8]]);
    }));
    return _removeProfilePhoto.apply(this, arguments);
  }
  function submitSupport(_x11) {
    return _submitSupport.apply(this, arguments);
  }
  function _submitSupport() {
    _submitSupport = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee26(event) {
      var form, response, result, _t22;
      return _regenerator().w(function (_context26) {
        while (1) switch (_context26.p = _context26.n) {
          case 0:
            event.preventDefault();
            busy = true;
            message = '';
            form = new FormData(event.currentTarget);
            _context26.p = 1;
            _context26.n = 2;
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
            response = _context26.v;
            _context26.n = 3;
            return response.json();
          case 3:
            result = _context26.v;
            if (response.ok) {
              _context26.n = 4;
              break;
            }
            throw Error(result.error || 'Ticket could not be submitted.');
          case 4:
            supportTickets = result.tickets || [];
            supportSelected = result.ticket.id;
            supportPhoto = '';
            message = 'Support ticket submitted.';
            _context26.n = 6;
            break;
          case 5:
            _context26.p = 5;
            _t22 = _context26.v;
            message = _t22.message || 'Ticket could not be submitted.';
          case 6:
            _context26.p = 6;
            busy = false;
            render();
            return _context26.f(6);
          case 7:
            return _context26.a(2);
        }
      }, _callee26, null, [[1, 5, 6, 7]]);
    }));
    return _submitSupport.apply(this, arguments);
  }
  function replySupport(_x12) {
    return _replySupport.apply(this, arguments);
  }
  function _replySupport() {
    _replySupport = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee27(event) {
      var form, response, result, _t23;
      return _regenerator().w(function (_context27) {
        while (1) switch (_context27.p = _context27.n) {
          case 0:
            event.preventDefault();
            busy = true;
            message = '';
            form = new FormData(event.currentTarget);
            _context27.p = 1;
            _context27.n = 2;
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
            response = _context27.v;
            _context27.n = 3;
            return response.json();
          case 3:
            result = _context27.v;
            if (response.ok) {
              _context27.n = 4;
              break;
            }
            throw Error(result.error || 'Reply could not be sent.');
          case 4:
            supportTickets = result.tickets || [];
            supportReplyPhoto = '';
            message = 'Reply sent.';
            _context27.n = 6;
            break;
          case 5:
            _context27.p = 5;
            _t23 = _context27.v;
            message = _t23.message || 'Reply could not be sent.';
          case 6:
            _context27.p = 6;
            busy = false;
            render();
            return _context27.f(6);
          case 7:
            return _context27.a(2);
        }
      }, _callee27, null, [[1, 5, 6, 7]]);
    }));
    return _replySupport.apply(this, arguments);
  }
  function updateSupportStatus(_x13) {
    return _updateSupportStatus.apply(this, arguments);
  }
  function _updateSupportStatus() {
    _updateSupportStatus = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee28(status) {
      var response, result, _t24;
      return _regenerator().w(function (_context28) {
        while (1) switch (_context28.p = _context28.n) {
          case 0:
            busy = true;
            message = '';
            _context28.p = 1;
            _context28.n = 2;
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
            response = _context28.v;
            _context28.n = 3;
            return response.json();
          case 3:
            result = _context28.v;
            if (response.ok) {
              _context28.n = 4;
              break;
            }
            throw Error(result.error || 'Status could not be updated.');
          case 4:
            supportTickets = result.tickets || [];
            _context28.n = 6;
            break;
          case 5:
            _context28.p = 5;
            _t24 = _context28.v;
            message = _t24.message || 'Status could not be updated.';
          case 6:
            _context28.p = 6;
            busy = false;
            render();
            return _context28.f(6);
          case 7:
            return _context28.a(2);
        }
      }, _callee28, null, [[1, 5, 6, 7]]);
    }));
    return _updateSupportStatus.apply(this, arguments);
  }
  function logout() {
    return _logout.apply(this, arguments);
  }
  function _logout() {
    _logout = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee29() {
      var _session16;
      var token, response, _t25;
      return _regenerator().w(function (_context29) {
        while (1) switch (_context29.p = _context29.n) {
          case 0:
            token = (_session16 = session) === null || _session16 === void 0 ? void 0 : _session16.token;
            clearAccountState();
            busy = true;
            message = 'Signing out…';
            render();
            _context29.p = 1;
            if (!token) {
              _context29.n = 3;
              break;
            }
            _context29.n = 2;
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
            response = _context29.v;
            if (!(!response.ok && response.status !== 401)) {
              _context29.n = 3;
              break;
            }
            throw Error('Server sign-out was not confirmed');
          case 3:
            message = 'Signed out.';
            _context29.n = 5;
            break;
          case 4:
            _context29.p = 4;
            _t25 = _context29.v;
            message = 'Signed out on this device. Server sign-out could not be confirmed; the session may remain valid until it expires.';
          case 5:
            _context29.p = 5;
            busy = false;
            render();
            return _context29.f(5);
          case 6:
            return _context29.a(2);
        }
      }, _callee29, null, [[1, 4, 5, 6]]);
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
  function wire() {
    var _root$querySelector4, _root$querySelector5, _root$querySelector6, _root$querySelector7, _root$querySelector8, _root$querySelector9, _root$querySelector0, _root$querySelector1, _root$querySelector10, _root$querySelector11, _root$querySelector12;
    (_root$querySelector4 = root.querySelector('[data-history-retry]')) === null || _root$querySelector4 === void 0 || _root$querySelector4.addEventListener('click', function () {
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
    (_root$querySelector5 = root.querySelector('[data-order-type]')) === null || _root$querySelector5 === void 0 || _root$querySelector5.addEventListener('submit', saveOrderType);
    (_root$querySelector6 = root.querySelector('[data-logout]')) === null || _root$querySelector6 === void 0 || _root$querySelector6.addEventListener('click', logout);
    (_root$querySelector7 = root.querySelector('[data-remove-photo]')) === null || _root$querySelector7 === void 0 || _root$querySelector7.addEventListener('click', removeProfilePhoto);
    root.querySelectorAll('[data-orders]').forEach(function (button) {
      return button.addEventListener('click', function () {
        view = 'orders';
        message = '';
        render();
      });
    });
    (_root$querySelector8 = root.querySelector('[data-cnc]')) === null || _root$querySelector8 === void 0 || _root$querySelector8.addEventListener('click', function () {
      view = 'cnc';
      message = '';
      render();
    });
    (_root$querySelector9 = root.querySelector('[data-support]')) === null || _root$querySelector9 === void 0 || _root$querySelector9.addEventListener('click', function () {
      view = 'support';
      supportSelected = '';
      message = '';
      render();
    });
    (_root$querySelector0 = root.querySelector('[data-settings]')) === null || _root$querySelector0 === void 0 || _root$querySelector0.addEventListener('click', function () {
      view = 'settings';
      message = '';
      render();
    });
    (_root$querySelector1 = root.querySelector('[data-refresh]')) === null || _root$querySelector1 === void 0 || _root$querySelector1.addEventListener('click', function () {
      message = '';
      void refresh().then(render);
    });
    (_root$querySelector10 = root.querySelector('[data-profile]')) === null || _root$querySelector10 === void 0 || _root$querySelector10.addEventListener('submit', saveProfile);
    root.querySelectorAll('[data-new]').forEach(function (button) {
      return button.addEventListener('click', openDraft);
    });
    (_root$querySelector11 = root.querySelector('[data-cancel]')) === null || _root$querySelector11 === void 0 || _root$querySelector11.addEventListener('click', function () {
      view = 'orders';
      message = '';
      render();
    });
    (_root$querySelector12 = root.querySelector('[data-retry]')) === null || _root$querySelector12 === void 0 || _root$querySelector12.addEventListener('click', flush);
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
      var _orders$find;
      select.value = ((_orders$find = orders.find(function (order) {
        return order.id === select.dataset.status;
      })) === null || _orders$find === void 0 ? void 0 : _orders$find.status) || 'submitted';
      select.onchange = /*#__PURE__*/_asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee2() {
        var response, _t2;
        return _regenerator().w(function (_context2) {
          while (1) switch (_context2.n) {
            case 0:
              _context2.n = 1;
              return api('/orders/' + select.dataset.status + '/status', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  status: select.value
                })
              });
            case 1:
              response = _context2.v;
              if (response.ok) {
                _context2.n = 4;
                break;
              }
              _context2.n = 2;
              return response.json().catch(function () {
                return {};
              });
            case 2:
              _t2 = _context2.v.error;
              if (_t2) {
                _context2.n = 3;
                break;
              }
              _t2 = 'Status update failed';
            case 3:
              message = _t2;
            case 4:
              _context2.n = 5;
              return refresh();
            case 5:
              render();
            case 6:
              return _context2.a(2);
          }
        }, _callee2);
      }));
    });
    root.querySelectorAll('[data-order-details]').forEach(function (button) {
      return button.onclick = function () {
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
      var _root$querySelector13;
      root.querySelector('[data-add]').onclick = function () {
        return addItem(true);
      };
      root.querySelector('[data-order]').onsubmit = submitOrder;
      root.querySelectorAll('[data-discard-draft]').forEach(function (button) {
        return button.onclick = discardDraft;
      });
      (_root$querySelector13 = root.querySelector('[data-keep-draft]')) === null || _root$querySelector13 === void 0 || _root$querySelector13.addEventListener('click', function () {
        discardDraftArmed = false;
        render();
      });
      restoreDraftForm();
    }
  }
  function wireCnc() {
    var _root$querySelector14, _root$querySelector15;
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
    (_root$querySelector14 = root.querySelector('[data-cnc-expand]')) === null || _root$querySelector14 === void 0 || _root$querySelector14.addEventListener('click', function () {
      root.querySelectorAll('[data-cnc-key]').forEach(function (details) {
        details.open = true;
        cncExpanded.add(details.dataset.cncKey);
      });
    });
    (_root$querySelector15 = root.querySelector('[data-cnc-collapse]')) === null || _root$querySelector15 === void 0 || _root$querySelector15.addEventListener('click', function () {
      root.querySelectorAll('[data-cnc-key]').forEach(function (details) {
        details.open = false;
        cncExpanded.delete(details.dataset.cncKey);
      });
    });
  }
  function wireOrders() {
    var _root$querySelector16, _root$querySelector18;
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
    (_root$querySelector16 = root.querySelector('[data-my-orders]')) === null || _root$querySelector16 === void 0 || _root$querySelector16.addEventListener('click', function () {
      orderRequester = session.username;
      render();
    });
    var _loop3 = function _loop3() {
      var _root$querySelector17;
      var _arr2$_i = _slicedToArray(_arr2[_i3], 2),
        selector = _arr2$_i[0],
        value = _arr2$_i[1];
      (_root$querySelector17 = root.querySelector('[data-' + selector + ']')) === null || _root$querySelector17 === void 0 || _root$querySelector17.addEventListener('click', function () {
        orderDelivery = value;
        orderFilter = 'active';
        render();
      });
    };
    for (var _i3 = 0, _arr2 = [['due-week', 'week'], ['overdue', 'overdue']]; _i3 < _arr2.length; _i3++) {
      _loop3();
    }
    (_root$querySelector18 = root.querySelector('[data-clear-order-filters]')) === null || _root$querySelector18 === void 0 || _root$querySelector18.addEventListener('click', function () {
      orderQuery = '';
      orderProject = '';
      orderRequester = '';
      orderDelivery = '';
      orderFilter = 'active';
      render();
    });
  }
  function wireSupport() {
    var _root$querySelector19, _root$querySelector20, _root$querySelector21, _root$querySelector22, _root$querySelector23;
    (_root$querySelector19 = root.querySelector('[data-support-back]')) === null || _root$querySelector19 === void 0 || _root$querySelector19.addEventListener('click', function () {
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
    (_root$querySelector20 = root.querySelector('[data-support-create]')) === null || _root$querySelector20 === void 0 || _root$querySelector20.addEventListener('submit', submitSupport);
    (_root$querySelector21 = root.querySelector('[data-support-reply]')) === null || _root$querySelector21 === void 0 || _root$querySelector21.addEventListener('submit', replySupport);
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
    (_root$querySelector22 = root.querySelector('[data-support-photo]')) === null || _root$querySelector22 === void 0 || _root$querySelector22.addEventListener('change', /*#__PURE__*/function () {
      var _ref14 = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee3(event) {
        var _event$target$files2;
        var file, _t3;
        return _regenerator().w(function (_context3) {
          while (1) switch (_context3.p = _context3.n) {
            case 0:
              file = (_event$target$files2 = event.target.files) === null || _event$target$files2 === void 0 ? void 0 : _event$target$files2[0];
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
              supportPhoto = _context3.v;
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
      return function (_x14) {
        return _ref14.apply(this, arguments);
      };
    }());
    (_root$querySelector23 = root.querySelector('[data-support-reply-photo]')) === null || _root$querySelector23 === void 0 || _root$querySelector23.addEventListener('change', /*#__PURE__*/function () {
      var _ref15 = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee4(event) {
        var _event$target$files3;
        var file, _t4;
        return _regenerator().w(function (_context4) {
          while (1) switch (_context4.p = _context4.n) {
            case 0:
              file = (_event$target$files3 = event.target.files) === null || _event$target$files3 === void 0 ? void 0 : _event$target$files3[0];
              if (file) {
                _context4.n = 1;
                break;
              }
              return _context4.a(2);
            case 1:
              message = 'Preparing attachment…';
              render();
              _context4.p = 2;
              _context4.n = 3;
              return readPhoto(file);
            case 3:
              supportReplyPhoto = _context4.v;
              message = '';
              _context4.n = 5;
              break;
            case 4:
              _context4.p = 4;
              _t4 = _context4.v;
              message = _t4.message || 'Attachment could not be prepared.';
            case 5:
              render();
            case 6:
              return _context4.a(2);
          }
        }, _callee4, null, [[2, 4]]);
      }));
      return function (_x15) {
        return _ref15.apply(this, arguments);
      };
    }());
  }
  function render() {
    captureDraft();
    if (!session) {
      loginScreen();
      return;
    }
    if ((view === 'orders' || view === 'new' || view === 'order') && !can('site.orders.view')) view = can('site.cnc.view') ? 'cnc' : 'settings';
    if (view === 'new' && !can('site.orders.create')) view = 'orders';
    if (view === 'cnc' && !can('site.cnc.view')) view = can('site.orders.view') ? 'orders' : 'settings';
    var content = view === 'new' ? newOrder() : view === 'order' ? orderDetails() : view === 'cnc' ? cncView() : view === 'support' ? supportView() : view === 'settings' ? settingsView() : orderList();
    root.innerHTML = shell(content);
    wire();
    if (view === 'orders') wireOrders();
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
})();
