(function(){
  if(!Object.fromEntries)Object.fromEntries=function(entries){var o={};for(var i=0;i<entries.length;i++)o[entries[i][0]]=entries[i][1];return o;};
  if(!Array.prototype.flatMap)Array.prototype.flatMap=function(fn,thisArg){return Array.prototype.concat.apply([],this.map(fn,thisArg));};
  if(!String.prototype.padStart)String.prototype.padStart=function(n,s){s=String(s||' ');var v=String(this);while(v.length<n)v=s+v;return v.slice(-n);};
  if(!window.queueMicrotask)window.queueMicrotask=function(fn){Promise.resolve().then(fn);};
  if(!window.crypto)window.crypto={};
  if(!window.crypto.randomUUID)window.crypto.randomUUID=function(){return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){var r=Math.random()*16|0,v=c==='x'?r:(r&3|8);return v.toString(16);});};
  if(!Element.prototype.replaceChildren)Element.prototype.replaceChildren=function(){while(this.firstChild)this.removeChild(this.firstChild);for(var i=0;i<arguments.length;i++)this.appendChild(arguments[i]);};
  if(!Element.prototype.remove)Element.prototype.remove=function(){if(this.parentNode)this.parentNode.removeChild(this);};
  if(!window.AbortSignal)window.AbortSignal={};
  if(!window.AbortSignal.timeout)window.AbortSignal.timeout=function(){return undefined;};
})();
function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
function _regeneratorValues(e) { if (null != e) { var t = e["function" == typeof Symbol && Symbol.iterator || "@@iterator"], r = 0; if (t) return t.call(e); if ("function" == typeof e.next) return e; if (!isNaN(e.length)) return { next: function next() { return e && r >= e.length && (e = void 0), { value: e && e[r++], done: !e }; } }; } throw new TypeError(_typeof(e) + " is not iterable"); }
function ownKeys(e, r) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r).enumerable; })), t.push.apply(t, o); } return t; }
function _objectSpread(e) { for (var r = 1; r < arguments.length; r++) { var t = null != arguments[r] ? arguments[r] : {}; r % 2 ? ownKeys(Object(t), !0).forEach(function (r) { _defineProperty(e, r, t[r]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function (r) { Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r)); }); } return e; }
function _defineProperty(e, r, t) { return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e; }
function _createForOfIteratorHelper(r, e) { var t = "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"]; if (!t) { if (Array.isArray(r) || (t = _unsupportedIterableToArray(r)) || e && r && "number" == typeof r.length) { t && (r = t); var _n = 0, F = function F() {}; return { s: F, n: function n() { return _n >= r.length ? { done: !0 } : { done: !1, value: r[_n++] }; }, e: function e(r) { throw r; }, f: F }; } throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); } var o, a = !0, u = !1; return { s: function s() { t = t.call(r); }, n: function n() { var r = t.next(); return a = r.done, r; }, e: function e(r) { u = !0, o = r; }, f: function f() { try { a || null == t.return || t.return(); } finally { if (u) throw o; } } }; }
function _slicedToArray(r, e) { return _arrayWithHoles(r) || _iterableToArrayLimit(r, e) || _unsupportedIterableToArray(r, e) || _nonIterableRest(); }
function _nonIterableRest() { throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _iterableToArrayLimit(r, l) { var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"]; if (null != t) { var e, n, i, u, a = [], f = !0, o = !1; try { if (i = (t = t.call(r)).next, 0 === l) { if (Object(t) !== t) return; f = !1; } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0); } catch (r) { o = !0, n = r; } finally { try { if (!f && null != t.return && (u = t.return(), Object(u) !== u)) return; } finally { if (o) throw n; } } return a; } }
function _arrayWithHoles(r) { if (Array.isArray(r)) return r; }
function _regenerator() { /*! regenerator-runtime -- Copyright (c) 2014-present, Facebook, Inc. -- license (MIT): https://github.com/babel/babel/blob/main/packages/babel-helpers/LICENSE */ var e, t, r = "function" == typeof Symbol ? Symbol : {}, n = r.iterator || "@@iterator", o = r.toStringTag || "@@toStringTag"; function i(r, n, o, i) { var c = n && n.prototype instanceof Generator ? n : Generator, u = Object.create(c.prototype); return _regeneratorDefine2(u, "_invoke", function (r, n, o) { var i, c, u, f = 0, p = o || [], y = !1, G = { p: 0, n: 0, v: e, a: d, f: d.bind(e, 4), d: function d(t, r) { return i = t, c = 0, u = e, G.n = r, a; } }; function d(r, n) { for (c = r, u = n, t = 0; !y && f && !o && t < p.length; t++) { var o, i = p[t], d = G.p, l = i[2]; r > 3 ? (o = l === n) && (u = i[(c = i[4]) ? 5 : (c = 3, 3)], i[4] = i[5] = e) : i[0] <= d && ((o = r < 2 && d < i[1]) ? (c = 0, G.v = n, G.n = i[1]) : d < l && (o = r < 3 || i[0] > n || n > l) && (i[4] = r, i[5] = n, G.n = l, c = 0)); } if (o || r > 1) return a; throw y = !0, n; } return function (o, p, l) { if (f > 1) throw TypeError("Generator is already running"); for (y && 1 === p && d(p, l), c = p, u = l; (t = c < 2 ? e : u) || !y;) { i || (c ? c < 3 ? (c > 1 && (G.n = -1), d(c, u)) : G.n = u : G.v = u); try { if (f = 2, i) { if (c || (o = "next"), t = i[o]) { if (!(t = t.call(i, u))) throw TypeError("iterator result is not an object"); if (!t.done) return t; u = t.value, c < 2 && (c = 0); } else 1 === c && (t = i.return) && t.call(i), c < 2 && (u = TypeError("The iterator does not provide a '" + o + "' method"), c = 1); i = e; } else if ((t = (y = G.n < 0) ? u : r.call(n, G)) !== a) break; } catch (t) { i = e, c = 1, u = t; } finally { f = 1; } } return { value: t, done: y }; }; }(r, o, i), !0), u; } var a = {}; function Generator() {} function GeneratorFunction() {} function GeneratorFunctionPrototype() {} t = Object.getPrototypeOf; var c = [][n] ? t(t([][n]())) : (_regeneratorDefine2(t = {}, n, function () { return this; }), t), u = GeneratorFunctionPrototype.prototype = Generator.prototype = Object.create(c); function f(e) { return Object.setPrototypeOf ? Object.setPrototypeOf(e, GeneratorFunctionPrototype) : (e.__proto__ = GeneratorFunctionPrototype, _regeneratorDefine2(e, o, "GeneratorFunction")), e.prototype = Object.create(u), e; } return GeneratorFunction.prototype = GeneratorFunctionPrototype, _regeneratorDefine2(u, "constructor", GeneratorFunctionPrototype), _regeneratorDefine2(GeneratorFunctionPrototype, "constructor", GeneratorFunction), GeneratorFunction.displayName = "GeneratorFunction", _regeneratorDefine2(GeneratorFunctionPrototype, o, "GeneratorFunction"), _regeneratorDefine2(u), _regeneratorDefine2(u, o, "Generator"), _regeneratorDefine2(u, n, function () { return this; }), _regeneratorDefine2(u, "toString", function () { return "[object Generator]"; }), (_regenerator = function _regenerator() { return { w: i, m: f }; })(); }
function _regeneratorDefine2(e, r, n, t) { var i = Object.defineProperty; try { i({}, "", {}); } catch (e) { i = 0; } _regeneratorDefine2 = function _regeneratorDefine(e, r, n, t) { function o(r, n) { _regeneratorDefine2(e, r, function (e) { return this._invoke(r, n, e); }); } r ? i ? i(e, r, { value: n, enumerable: !t, configurable: !t, writable: !t }) : e[r] = n : (o("next", 0), o("throw", 1), o("return", 2)); }, _regeneratorDefine2(e, r, n, t); }
function asyncGeneratorStep(n, t, e, r, o, a, c) { try { var i = n[a](c), u = i.value; } catch (n) { return void e(n); } i.done ? t(u) : Promise.resolve(u).then(r, o); }
function _asyncToGenerator(n) { return function () { var t = this, e = arguments; return new Promise(function (r, o) { var a = n.apply(t, e); function _next(n) { asyncGeneratorStep(a, r, o, _next, _throw, "next", n); } function _throw(n) { asyncGeneratorStep(a, r, o, _next, _throw, "throw", n); } _next(void 0); }); }; }
function _classCallCheck(a, n) { if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function"); }
function _defineProperties(e, r) { for (var t = 0; t < r.length; t++) { var o = r[t]; o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, _toPropertyKey(o.key), o); } }
function _createClass(e, r, t) { return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: !1 }), e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == _typeof(i) ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != _typeof(t) || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != _typeof(i)) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
function _toConsumableArray(r) { return _arrayWithoutHoles(r) || _iterableToArray(r) || _unsupportedIterableToArray(r) || _nonIterableSpread(); }
function _nonIterableSpread() { throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _unsupportedIterableToArray(r, a) { if (r) { if ("string" == typeof r) return _arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1); return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0; } }
function _iterableToArray(r) { if ("undefined" != typeof Symbol && null != r[Symbol.iterator] || null != r["@@iterator"]) return Array.from(r); }
function _arrayWithoutHoles(r) { if (Array.isArray(r)) return _arrayLikeToArray(r); }
function _arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }
(function (root) {
  'use strict';

  var FIELDS = ['variants', 'offcuts', 'catalog', 'reasons', 'transactions', 'photos', 'cncPanels'];
  var OUTBOX_KEY = 'panelstock:outbox:v2';
  var LEGACY_KEY = 'panelstock:pendingSync';
  var copy = function copy(v) {
    return JSON.parse(JSON.stringify(v));
  };
  var same = function same(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  };
  var mapping = function mapping(field, value) {
    return field === 'photos' ? value || {} : Object.fromEntries((value || []).map(function (v) {
      return [v.id, v];
    }));
  };
  var sortCncPanels = function sortCncPanels(value) {
    return _toConsumableArray(value || []).sort(function (a, b) {
      var _a$sheetNumber, _b$sheetNumber;
      var left = String((_a$sheetNumber = a === null || a === void 0 ? void 0 : a.sheetNumber) !== null && _a$sheetNumber !== void 0 ? _a$sheetNumber : '').trim();
      var right = String((_b$sheetNumber = b === null || b === void 0 ? void 0 : b.sheetNumber) !== null && _b$sheetNumber !== void 0 ? _b$sheetNumber : '').trim();
      if (!left || !right) {
        if (left === right) return 0;
        return left ? -1 : 1;
      }
      return left.localeCompare(right, 'en', {
        numeric: true,
        sensitivity: 'base'
      });
    });
  };
  var prepareView = function prepareView(view) {
    var next = copy(view);
    if (Array.isArray(next === null || next === void 0 ? void 0 : next.cncPanels)) next.cncPanels = sortCncPanels(next.cncPanels);
    return next;
  };
  function styledConfirm() {
    var _ref = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {},
      _ref$title = _ref.title,
      title = _ref$title === void 0 ? 'Confirm action' : _ref$title,
      message = _ref.message,
      _ref$confirmLabel = _ref.confirmLabel,
      confirmLabel = _ref$confirmLabel === void 0 ? 'Confirm' : _ref$confirmLabel,
      _ref$danger = _ref.danger,
      danger = _ref$danger === void 0 ? true : _ref$danger;
    return new Promise(function (resolve) {
      var document = root.document;
      if (!document) {
        resolve(false);
        return;
      }
      var overlay = document.createElement('div');
      overlay.setAttribute('role', 'presentation');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;display:grid;place-items:center;padding:24px;background:rgba(15,23,42,.55)';
      var dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-labelledby', 'panelstock-confirm-title');
      dialog.setAttribute('aria-describedby', 'panelstock-confirm-message');
      dialog.style.cssText = 'width:100%;max-width:480px;overflow:hidden;border-radius:12px;background:#fff;box-shadow:0 24px 60px rgba(15,23,42,.28);font-family:inherit';
      var header = document.createElement('div');
      header.style.cssText = 'padding:20px 24px;border-bottom:1px solid #e2e8f0';
      var heading = document.createElement('h2');
      heading.id = 'panelstock-confirm-title';
      heading.textContent = title;
      heading.style.cssText = 'margin:0;color:#0f172a;font-size:18px;font-weight:700';
      header.appendChild(heading);
      var body = document.createElement('div');
      body.style.cssText = 'padding:22px 24px';
      var text = document.createElement('p');
      text.id = 'panelstock-confirm-message';
      text.textContent = message || '';
      text.style.cssText = 'margin:0;white-space:pre-line;color:#475569;font-size:15px;line-height:1.55';
      body.appendChild(text);
      var footer = document.createElement('div');
      footer.style.cssText = 'display:flex;justify-content:flex-end;gap:12px;padding:16px 24px;border-top:1px solid #e2e8f0;background:#f8fafc';
      var cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = 'Cancel';
      cancel.style.cssText = 'min-height:42px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;padding:10px 18px;color:#475569;font:600 14px inherit;cursor:pointer';
      var confirm = document.createElement('button');
      confirm.type = 'button';
      confirm.textContent = confirmLabel;
      confirm.style.cssText = "min-height:42px;border:0;border-radius:8px;background:".concat(danger ? '#b91c1c' : '#0e7490', ";padding:10px 18px;color:#fff;font:600 14px inherit;cursor:pointer");
      footer.append(cancel, confirm);
      dialog.append(header, body, footer);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);
      var finish = function finish(value) {
        document.removeEventListener('keydown', onKey);
        overlay.remove();
        resolve(value);
      };
      var onKey = function onKey(event) {
        if (event.key === 'Escape') finish(false);
      };
      cancel.onclick = function () {
        return finish(false);
      };
      confirm.onclick = function () {
        return finish(true);
      };
      overlay.onclick = function (event) {
        if (event.target === overlay) finish(false);
      };
      document.addEventListener('keydown', onKey);
      cancel.focus();
    });
  }
  function showCopyDialog() {
    var _ref2 = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {},
      _ref2$title = _ref2.title,
      title = _ref2$title === void 0 ? 'Copy' : _ref2$title,
      _ref2$message = _ref2.message,
      message = _ref2$message === void 0 ? 'Select and copy this value.' : _ref2$message,
      _ref2$value = _ref2.value,
      value = _ref2$value === void 0 ? '' : _ref2$value;
    return new Promise(function (resolve) {
      var document = root.document;
      if (!document) {
        resolve();
        return;
      }
      var overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;display:grid;place-items:center;padding:24px;background:rgba(15,23,42,.55)';
      var dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-label', title);
      dialog.style.cssText = 'width:100%;max-width:560px;overflow:hidden;border-radius:12px;background:#fff;box-shadow:0 24px 60px rgba(15,23,42,.28);font-family:inherit';
      var header = document.createElement('div');
      header.style.cssText = 'padding:20px 24px;border-bottom:1px solid #e2e8f0';
      var heading = document.createElement('h2');
      heading.textContent = title;
      heading.style.cssText = 'margin:0;color:#0f172a;font-size:18px;font-weight:700';
      header.appendChild(heading);
      var body = document.createElement('div');
      body.style.cssText = 'padding:22px 24px';
      var text = document.createElement('p');
      text.textContent = message;
      text.style.cssText = 'margin:0 0 14px;color:#475569;font-size:15px;line-height:1.55';
      var input = document.createElement('input');
      input.readOnly = true;
      input.value = value;
      input.style.cssText = 'box-sizing:border-box;width:100%;min-height:44px;border:1px solid #cbd5e1;border-radius:8px;background:#f8fafc;padding:10px 12px;color:#334155;font:14px inherit';
      body.append(text, input);
      var footer = document.createElement('div');
      footer.style.cssText = 'display:flex;justify-content:flex-end;gap:12px;padding:16px 24px;border-top:1px solid #e2e8f0;background:#f8fafc';
      var select = document.createElement('button');
      select.type = 'button';
      select.textContent = 'Select text';
      select.style.cssText = 'min-height:42px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;padding:10px 18px;color:#475569;font:600 14px inherit;cursor:pointer';
      var close = document.createElement('button');
      close.type = 'button';
      close.textContent = 'Done';
      close.style.cssText = 'min-height:42px;border:0;border-radius:8px;background:#0e7490;padding:10px 18px;color:#fff;font:600 14px inherit;cursor:pointer';
      footer.append(select, close);
      dialog.append(header, body, footer);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);
      var finish = function finish() {
        document.removeEventListener('keydown', onKey);
        overlay.remove();
        resolve();
      };
      var onKey = function onKey(event) {
        if (event.key === 'Escape') finish();
      };
      select.onclick = function () {
        input.focus();
        input.select();
      };
      close.onclick = finish;
      overlay.onclick = function (event) {
        if (event.target === overlay) finish();
      };
      document.addEventListener('keydown', onKey);
      input.focus();
      input.select();
    });
  }
  var IndexedOutboxStorage = /*#__PURE__*/function () {
    function IndexedOutboxStorage(fallback) {
      var notify = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : function () {};
      _classCallCheck(this, IndexedOutboxStorage);
      this.fallback = fallback;
      this.notify = notify;
      this.value = null;
      this.db = null;
      this.writes = Promise.resolve();
    }
    return _createClass(IndexedOutboxStorage, [{
      key: "ready",
      value: function () {
        var _ready = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee() {
          var _this = this;
          var saved, legacy, _t;
          return _regenerator().w(function (_context) {
            while (1) switch (_context.p = _context.n) {
              case 0:
                if (root.indexedDB) {
                  _context.n = 1;
                  break;
                }
                this.value = this.fallback.getItem(OUTBOX_KEY);
                return _context.a(2, this);
              case 1:
                _context.p = 1;
                _context.n = 2;
                return new Promise(function (resolve, reject) {
                  var request = root.indexedDB.open('panelstock-sync', 1);
                  request.onupgradeneeded = function () {
                    return request.result.createObjectStore('state');
                  };
                  request.onsuccess = function () {
                    return resolve(request.result);
                  };
                  request.onerror = function () {
                    return reject(request.error);
                  };
                });
              case 2:
                this.db = _context.v;
                _context.n = 3;
                return new Promise(function (resolve, reject) {
                  var request = _this.db.transaction('state').objectStore('state').get(OUTBOX_KEY);
                  request.onsuccess = function () {
                    var _request$result;
                    return resolve((_request$result = request.result) !== null && _request$result !== void 0 ? _request$result : null);
                  };
                  request.onerror = function () {
                    return reject(request.error);
                  };
                });
              case 3:
                saved = _context.v;
                legacy = this.fallback.getItem(OUTBOX_KEY);
                this.value = saved !== null && saved !== void 0 ? saved : legacy;
                if (!(saved == null && legacy != null)) {
                  _context.n = 4;
                  break;
                }
                this.setItem(OUTBOX_KEY, legacy);
                _context.n = 4;
                return this.flushWrites();
              case 4:
                if (saved != null) this.fallback.removeItem(OUTBOX_KEY);
                _context.n = 6;
                break;
              case 5:
                _context.p = 5;
                _t = _context.v;
                this.db = null;
                this.value = this.fallback.getItem(OUTBOX_KEY);
                this.notify('storage', 'Reliable device storage could not be opened. Pending changes will use limited browser storage.');
              case 6:
                return _context.a(2, this);
            }
          }, _callee, this, [[1, 5]]);
        }));
        function ready() {
          return _ready.apply(this, arguments);
        }
        return ready;
      }()
    }, {
      key: "getItem",
      value: function getItem(key) {
        return key === OUTBOX_KEY ? this.value : this.fallback.getItem(key);
      }
    }, {
      key: "setItem",
      value: function setItem(key, value) {
        var _this2 = this;
        if (key !== OUTBOX_KEY) {
          this.fallback.setItem(key, value);
          return;
        }
        this.value = value;
        if (!this.db) {
          this.fallback.setItem(key, value);
          return;
        }
        this.writes = this.writes.then(function () {
          return new Promise(function (resolve, reject) {
            var tx = _this2.db.transaction('state', 'readwrite');
            tx.objectStore('state').put(value, key);
            tx.oncomplete = function () {
              _this2.fallback.removeItem(key);
              resolve();
            };
            tx.onerror = function () {
              return reject(tx.error);
            };
            tx.onabort = function () {
              return reject(tx.error);
            };
          });
        }).catch(function () {
          try {
            _this2.fallback.setItem(key, _this2.value);
          } catch (_unused) {}
          _this2.notify('storage', 'Reliable device storage failed. Pending changes were preserved in limited browser storage.');
        });
      }
    }, {
      key: "removeItem",
      value: function removeItem(key) {
        var _this3 = this;
        if (key !== OUTBOX_KEY) {
          this.fallback.removeItem(key);
          return Promise.resolve();
        }
        this.value = null;
        this.fallback.removeItem(key);
        if (!this.db) return Promise.resolve();
        this.writes = this.writes.then(function () {
          return new Promise(function (resolve, reject) {
            var tx = _this3.db.transaction('state', 'readwrite');
            tx.objectStore('state').delete(key);
            tx.oncomplete = resolve;
            tx.onerror = function () {
              return reject(tx.error);
            };
            tx.onabort = function () {
              return reject(tx.error);
            };
          });
        });
        return this.writes;
      }
    }, {
      key: "flushWrites",
      value: function flushWrites() {
        return this.writes;
      }
    }, {
      key: "read",
      value: function () {
        var _read = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee2(key) {
          var _this4 = this;
          return _regenerator().w(function (_context2) {
            while (1) switch (_context2.n) {
              case 0:
                _context2.n = 1;
                return this.flushWrites();
              case 1:
                if (this.db) {
                  _context2.n = 2;
                  break;
                }
                return _context2.a(2, key === SESSION ? null : this.fallback.getItem(key));
              case 2:
                return _context2.a(2, new Promise(function (resolve, reject) {
                  var request = _this4.db.transaction('state').objectStore('state').get(key);
                  request.onsuccess = function () {
                    var _request$result2;
                    return resolve((_request$result2 = request.result) !== null && _request$result2 !== void 0 ? _request$result2 : null);
                  };
                  request.onerror = function () {
                    return reject(request.error);
                  };
                }));
            }
          }, _callee2, this);
        }));
        function read(_x) {
          return _read.apply(this, arguments);
        }
        return read;
      }()
    }, {
      key: "write",
      value: function () {
        var _write = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee3(key, value) {
          var _this5 = this;
          return _regenerator().w(function (_context3) {
            while (1) switch (_context3.n) {
              case 0:
                if (this.db) {
                  _context3.n = 1;
                  break;
                }
                if (key !== SESSION) this.fallback.setItem(key, value);
                return _context3.a(2);
              case 1:
                _context3.n = 2;
                return new Promise(function (resolve, reject) {
                  var tx = _this5.db.transaction('state', 'readwrite');
                  tx.objectStore('state').put(value, key);
                  tx.oncomplete = resolve;
                  tx.onerror = function () {
                    return reject(tx.error);
                  };
                  tx.onabort = function () {
                    return reject(tx.error);
                  };
                });
              case 2:
                return _context3.a(2);
            }
          }, _callee3, this);
        }));
        function write(_x2, _x3) {
          return _write.apply(this, arguments);
        }
        return write;
      }()
    }, {
      key: "delete",
      value: function () {
        var _delete2 = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee4(key) {
          var _this6 = this;
          return _regenerator().w(function (_context4) {
            while (1) switch (_context4.n) {
              case 0:
                if (this.db) {
                  _context4.n = 1;
                  break;
                }
                this.fallback.removeItem(key);
                return _context4.a(2);
              case 1:
                _context4.n = 2;
                return new Promise(function (resolve, reject) {
                  var tx = _this6.db.transaction('state', 'readwrite');
                  tx.objectStore('state').delete(key);
                  tx.oncomplete = resolve;
                  tx.onerror = function () {
                    return reject(tx.error);
                  };
                  tx.onabort = function () {
                    return reject(tx.error);
                  };
                });
              case 2:
                return _context4.a(2);
            }
          }, _callee4, this);
        }));
        function _delete(_x4) {
          return _delete2.apply(this, arguments);
        }
        return _delete;
      }()
    }]);
  }();
  var Outbox = /*#__PURE__*/function () {
    function Outbox(storage, send) {
      var notify = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : function () {};
      _classCallCheck(this, Outbox);
      this.storage = storage;
      this.send = send;
      this.notify = notify;
      this.running = null;
      this.timer = false;
      this.state = JSON.parse(storage.getItem(OUTBOX_KEY) || 'null') || {
        owner: null,
        view: null,
        queue: [],
        draft: null,
        blocked: null
      };
      if (this.state.blocked === 'Dimensions must be positive numbers') this.state.blocked = null;
    }
    return _createClass(Outbox, [{
      key: "save",
      value: function save(next) {
        try {
          this.storage.setItem(OUTBOX_KEY, JSON.stringify(next));
        } catch (_unused2) {
          this.notify('storage', 'Device storage is full. No further edits can be saved. Export pending changes.');
          throw Error('Device storage is full; pending changes were not saved.');
        }
        this.state = next;
        this.notify(next.blocked ? 'conflict' : next.queue.length || next.draft ? 'offline' : 'synced', next.blocked);
      }
    }, {
      key: "pending",
      value: function pending() {
        return this.state.queue.length > 0 || !!this.state.draft;
      }
    }, {
      key: "snapshot",
      value: function snapshot(remote, owner) {
        if (this.pending()) {
          if (this.state.owner !== owner) throw Error('Pending changes belong to another user. Log in as ' + this.state.owner + '.');
          return prepareView(this.state.view);
        }
        if (this.state.owner === owner && this.state.view && remote.revision < this.state.view.revision) return prepareView(this.state.view);
        var view = prepareView(remote);
        this.save({
          owner: owner,
          view: view,
          queue: [],
          draft: null,
          blocked: null
        });
        return copy(view);
      }
    }, {
      key: "stage",
      value: function stage(fields, owner, rendered) {
        var _this7 = this;
        if (!this.state.view || this.state.owner !== owner) throw Error('Load stock after logging in before editing.');
        if (this.state.blocked) throw Error(this.state.blocked);
        var next = copy(this.state);
        if (!next.draft) next.draft = {
          before: copy(next.view),
          fields: {}
        };
        for (var _i = 0, _FIELDS = FIELDS; _i < _FIELDS.length; _i++) {
          var field = _FIELDS[_i];
          if (fields[field] !== undefined && !(field in next.draft.fields) && (rendered === null || rendered === void 0 ? void 0 : rendered[field]) !== undefined) next.draft.before[field] = copy(rendered[field]);
        }
        for (var _i2 = 0, _FIELDS2 = FIELDS; _i2 < _FIELDS2.length; _i2++) {
          var _field = _FIELDS2[_i2];
          if (fields[_field] !== undefined) {
            var value = _field === 'cncPanels' ? sortCncPanels(fields[_field]) : copy(fields[_field]);
            next.draft.fields[_field] = value;
            next.view[_field] = copy(value);
          }
        }
        this.save(next);
        if (!this.timer) {
          this.timer = true;
          queueMicrotask(function () {
            _this7.timer = false;
            _this7.finalize();
            void _this7.flush(owner);
          });
        }
      }
    }, {
      key: "finalize",
      value: function finalize() {
        if (!this.state.draft) return;
        var next = copy(this.state),
          changes = [];
        for (var _i3 = 0, _Object$entries = Object.entries(next.draft.fields); _i3 < _Object$entries.length; _i3++) {
          var _Object$entries$_i = _slicedToArray(_Object$entries[_i3], 2),
            field = _Object$entries$_i[0],
            value = _Object$entries$_i[1];
          var before = mapping(field, next.draft.before[field]),
            after = mapping(field, value);
          var _iterator = _createForOfIteratorHelper(new Set([].concat(_toConsumableArray(Object.keys(before)), _toConsumableArray(Object.keys(after))))),
            _step;
          try {
            for (_iterator.s(); !(_step = _iterator.n()).done;) {
              var id = _step.value;
              if (field === 'transactions' && !after[id]) continue;
              if (!same(before[id] || null, after[id] || null)) changes.push({
                field: field,
                id: id,
                before: before[id] || null,
                after: after[id] || null
              });
            }
          } catch (err) {
            _iterator.e(err);
          } finally {
            _iterator.f();
          }
        }
        if (changes.length) next.queue.push({
          mutationId: crypto.randomUUID(),
          restoreEpoch: next.draft.before.restoreEpoch || 0,
          changes: changes
        });
        next.draft = null;
        this.save(next);
      }
    }, {
      key: "clearBlocked",
      value: function clearBlocked() {
        if (!this.state.blocked) return;
        this.save(_objectSpread(_objectSpread({}, this.state), {}, {
          blocked: null
        }));
      }
    }, {
      key: "flush",
      value: function flush(owner) {
        var _this8 = this;
        if (this.running) return this.running;
        this.running = this.drain(owner).finally(function () {
          _this8.running = null;
        });
        return this.running;
      }
    }, {
      key: "drain",
      value: function () {
        var _drain = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee5(owner) {
          var _this9 = this;
          var _loop, _ret;
          return _regenerator().w(function (_context6) {
            while (1) switch (_context6.n) {
              case 0:
                this.finalize();
                if (!(this.state.owner !== owner || this.state.blocked)) {
                  _context6.n = 1;
                  break;
                }
                return _context6.a(2, false);
              case 1:
                _loop = /*#__PURE__*/_regenerator().m(function _loop() {
                  var _this9$storage$flushW, _this9$storage, _this9$storage$flushW2, _this9$storage2;
                  var packet, res, error, result, next, _t2, _t3, _t4;
                  return _regenerator().w(function (_context5) {
                    while (1) switch (_context5.p = _context5.n) {
                      case 0:
                        _context5.n = 1;
                        return (_this9$storage$flushW = (_this9$storage = _this9.storage).flushWrites) === null || _this9$storage$flushW === void 0 ? void 0 : _this9$storage$flushW.call(_this9$storage);
                      case 1:
                        packet = _this9.state.queue[0];
                        _this9.notify('syncing');
                        _context5.p = 2;
                        _context5.n = 3;
                        return _this9.send(packet, owner);
                      case 3:
                        res = _context5.v;
                        _context5.n = 5;
                        break;
                      case 4:
                        _context5.p = 4;
                        _t2 = _context5.v;
                        _this9.notify('offline');
                        return _context5.a(2, {
                          v: false
                        });
                      case 5:
                        if (res.ok) {
                          _context5.n = 12;
                          break;
                        }
                        if (![400, 403, 409, 413, 422, 426].includes(res.status)) {
                          _context5.n = 10;
                          break;
                        }
                        _context5.p = 6;
                        _context5.n = 7;
                        return res.json();
                      case 7:
                        error = _context5.v;
                        _context5.n = 9;
                        break;
                      case 8:
                        _context5.p = 8;
                        _t3 = _context5.v;
                        _this9.notify('offline');
                        return _context5.a(2, {
                          v: false
                        });
                      case 9:
                        _this9.save(_objectSpread(_objectSpread({}, _this9.state), {}, {
                          blocked: error.error || 'Pending changes require review.'
                        }));
                        _context5.n = 11;
                        break;
                      case 10:
                        _this9.notify(res.status === 401 ? 'login' : 'offline');
                      case 11:
                        return _context5.a(2, {
                          v: false
                        });
                      case 12:
                        _context5.p = 12;
                        _context5.n = 13;
                        return res.json();
                      case 13:
                        result = _context5.v;
                        _context5.n = 15;
                        break;
                      case 14:
                        _context5.p = 14;
                        _t4 = _context5.v;
                        _this9.notify('offline');
                        return _context5.a(2, {
                          v: false
                        });
                      case 15:
                        next = copy(_this9.state);
                        next.queue = next.queue.filter(function (p) {
                          return p.mutationId !== packet.mutationId;
                        });
                        next.view.revision = Math.max(next.view.revision || 0, result.revision || 0);
                        next.blocked = null;
                        _this9.save(next);
                        _context5.n = 16;
                        return (_this9$storage$flushW2 = (_this9$storage2 = _this9.storage).flushWrites) === null || _this9$storage$flushW2 === void 0 ? void 0 : _this9$storage$flushW2.call(_this9$storage2);
                      case 16:
                        return _context5.a(2);
                    }
                  }, _loop, null, [[12, 14], [6, 8], [2, 4]]);
                });
              case 2:
                if (!this.state.queue.length) {
                  _context6.n = 5;
                  break;
                }
                return _context6.d(_regeneratorValues(_loop()), 3);
              case 3:
                _ret = _context6.v;
                if (!_ret) {
                  _context6.n = 4;
                  break;
                }
                return _context6.a(2, _ret.v);
              case 4:
                _context6.n = 2;
                break;
              case 5:
                return _context6.a(2, true);
            }
          }, _callee5, this);
        }));
        function drain(_x5) {
          return _drain.apply(this, arguments);
        }
        return drain;
      }()
    }]);
  }();
  if (typeof module !== 'undefined') module.exports = {
    Outbox: Outbox,
    IndexedOutboxStorage: IndexedOutboxStorage
  };
  if (!root.document) return;
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/push-sw.js', {
    updateViaCache: 'none'
  }).catch(function () {});
  var nativeArraySort = Array.prototype.sort;
  Array.prototype.sort = function (compareFn) {
    var isCncPanelArray = this.length > 1 && this.every(function (row) {
      return row && _typeof(row) === 'object' && 'orderNumber' in row && 'sheetNumber' in row && 'panelNumber' in row;
    });
    var isUploadedAtSort = typeof compareFn === 'function' && Function.prototype.toString.call(compareFn).includes('uploadedAt');
    if (isCncPanelArray && isUploadedAtSort) {
      return nativeArraySort.call(this, function (a, b) {
        var _a$sheetNumber2, _b$sheetNumber2, _a$panelNumber, _b$panelNumber;
        var sheet = String((_a$sheetNumber2 = a.sheetNumber) !== null && _a$sheetNumber2 !== void 0 ? _a$sheetNumber2 : '').trim().localeCompare(String((_b$sheetNumber2 = b.sheetNumber) !== null && _b$sheetNumber2 !== void 0 ? _b$sheetNumber2 : '').trim(), 'en', {
          numeric: true,
          sensitivity: 'base'
        });
        if (sheet) return sheet;
        return String((_a$panelNumber = a.panelNumber) !== null && _a$panelNumber !== void 0 ? _a$panelNumber : '').trim().localeCompare(String((_b$panelNumber = b.panelNumber) !== null && _b$panelNumber !== void 0 ? _b$panelNumber : '').trim(), 'en', {
          numeric: true,
          sensitivity: 'base'
        });
      });
    }
    return nativeArraySort.call(this, compareFn);
  };
  var collapsedCncSheets = new Set();
  var initializedCncSheets = new Set();
  var cncEnhanceQueued = false;
  var leafElements = function leafElements(rootNode) {
    return _toConsumableArray(rootNode.querySelectorAll('*')).filter(function (el) {
      return el.children.length === 0 && el.textContent.trim();
    });
  };
  var findPanelCard = function findPanelCard(meta) {
    var node = meta.parentElement;
    while (node && node !== document.body) {
      var completeButtons = _toConsumableArray(node.querySelectorAll('button')).filter(function (button) {
        return button.textContent.trim() === 'Complete panel';
      });
      if (completeButtons.length === 1) return node;
      node = node.parentElement;
    }
    return null;
  };
  var addMobileSheetGroups = function addMobileSheetGroups() {
    document.querySelectorAll('[data-panelstock-sheet-heading="mobile"]').forEach(function (el) {
      return el.remove();
    });
    var _iterator2 = _createForOfIteratorHelper(leafElements(document)),
      _step2;
    try {
      for (_iterator2.s(); !(_step2 = _iterator2.n()).done;) {
        var meta = _step2.value;
        var match = meta.textContent.trim().match(/^Sheet\s+(.+?)\s*[·•]\s*Panel\s+(.+)$/i);
        if (!match) continue;
        var card = findPanelCard(meta);
        if (!card) continue;
        var sheet = match[1].trim(),
          panel = match[2].trim();
        var orderLeaf = leafElements(card).find(function (el) {
          return /^Order\s+/i.test(el.textContent.trim());
        });
        var order = (orderLeaf === null || orderLeaf === void 0 ? void 0 : orderLeaf.textContent.trim()) || card.dataset.panelstockOrder || 'Order';
        card.dataset.panelstockCncCard = '1';
        card.dataset.panelstockSheet = sheet;
        card.dataset.panelstockOrder = order;
        if (orderLeaf) {
          orderLeaf.textContent = 'Panel ' + panel;
          orderLeaf.style.fontWeight = '700';
          orderLeaf.style.paddingLeft = '12px';
        }
        meta.style.display = 'none';
      }
    } catch (err) {
      _iterator2.e(err);
    } finally {
      _iterator2.f();
    }
    var parents = new Set(_toConsumableArray(document.querySelectorAll('[data-panelstock-cnc-card="1"]')).map(function (card) {
      return card.parentElement;
    }).filter(Boolean));
    var _iterator3 = _createForOfIteratorHelper(parents),
      _step3;
    try {
      for (_iterator3.s(); !(_step3 = _iterator3.n()).done;) {
        var parent = _step3.value;
        var cards = _toConsumableArray(parent.children).filter(function (el) {
          var _el$dataset;
          return ((_el$dataset = el.dataset) === null || _el$dataset === void 0 ? void 0 : _el$dataset.panelstockCncCard) === '1';
        });
        var sheets = [];
        var _iterator4 = _createForOfIteratorHelper(cards),
          _step4;
        try {
          for (_iterator4.s(); !(_step4 = _iterator4.n()).done;) {
            var _card2 = _step4.value;
            if (!sheets.includes(_card2.dataset.panelstockSheet)) sheets.push(_card2.dataset.panelstockSheet);
          }
        } catch (err) {
          _iterator4.e(err);
        } finally {
          _iterator4.f();
        }
        var _loop2 = function _loop2() {
          var sheet = _sheets[_i4];
          var sheetCards = cards.filter(function (card) {
            return card.dataset.panelstockSheet === sheet;
          });
          if (!sheetCards.length) return 1; // continue
          var order = sheetCards[0].dataset.panelstockOrder || 'Order',
            key = order + '|' + sheet;
          var heading = document.createElement('button');
          heading.type = 'button';
          heading.dataset.panelstockSheetHeading = 'mobile';
          heading.style.cssText = 'width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;margin:8px 0;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc;color:#334155;font:700 14px system-ui;text-align:left';
          var label = document.createElement('span');
          label.textContent = 'Sheet ' + sheet;
          var right = document.createElement('span');
          right.style.cssText = 'color:#64748b;font-weight:600';
          if (!initializedCncSheets.has(key)) {
            collapsedCncSheets.add(key);
            initializedCncSheets.add(key);
          }
          var update = function update() {
            var closed = collapsedCncSheets.has(key);
            right.textContent = sheetCards.length + ' panel' + (sheetCards.length === 1 ? '' : 's') + (closed ? ' ▸' : ' ▾');
            var _iterator5 = _createForOfIteratorHelper(sheetCards),
              _step5;
            try {
              for (_iterator5.s(); !(_step5 = _iterator5.n()).done;) {
                var _card = _step5.value;
                _card.style.display = closed ? 'none' : '';
              }
            } catch (err) {
              _iterator5.e(err);
            } finally {
              _iterator5.f();
            }
          };
          heading.onclick = function () {
            collapsedCncSheets.has(key) ? collapsedCncSheets.delete(key) : collapsedCncSheets.add(key);
            update();
          };
          heading.append(label, right);
          parent.insertBefore(heading, sheetCards[0]);
          update();
        };
        for (var _i4 = 0, _sheets = sheets; _i4 < _sheets.length; _i4++) {
          if (_loop2()) continue;
        }
      }
    } catch (err) {
      _iterator3.e(err);
    } finally {
      _iterator3.f();
    }
  };
  var addDesktopSheetGroups = function addDesktopSheetGroups() {
    document.querySelectorAll('tr[data-panelstock-sheet-heading="desktop"]').forEach(function (el) {
      return el.remove();
    });
    var _iterator6 = _createForOfIteratorHelper(document.querySelectorAll('table')),
      _step6;
    try {
      for (_iterator6.s(); !(_step6 = _iterator6.n()).done;) {
        var table = _step6.value;
        var headers = _toConsumableArray(table.querySelectorAll('thead th')).map(function (th) {
          return th.textContent.trim().toLowerCase();
        });
        var sheetIndex = headers.indexOf('sheet'),
          panelIndex = headers.indexOf('panel');
        if (sheetIndex < 0 || panelIndex < 0) continue;
        var rows = _toConsumableArray(table.querySelectorAll('tbody > tr')).filter(function (row) {
          return !row.dataset.panelstockSheetHeading;
        });
        var previousSheet = null;
        var _iterator7 = _createForOfIteratorHelper(rows),
          _step7;
        try {
          for (_iterator7.s(); !(_step7 = _iterator7.n()).done;) {
            var _cells$sheetIndex;
            var row = _step7.value;
            var cells = _toConsumableArray(row.children),
              sheet = (_cells$sheetIndex = cells[sheetIndex]) === null || _cells$sheetIndex === void 0 ? void 0 : _cells$sheetIndex.textContent.trim();
            if (!sheet || sheet === previousSheet) continue;
            previousSheet = sheet;
            var group = document.createElement('tr');
            group.dataset.panelstockSheetHeading = 'desktop';
            var cell = document.createElement('td');
            cell.colSpan = Math.max(cells.length, 1);
            cell.style.cssText = 'padding:9px 16px;background:#f8fafc;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;color:#334155;font:700 13px system-ui';
            cell.textContent = 'Sheet ' + sheet;
            group.appendChild(cell);
            row.parentElement.insertBefore(group, row);
          }
        } catch (err) {
          _iterator7.e(err);
        } finally {
          _iterator7.f();
        }
      }
    } catch (err) {
      _iterator6.e(err);
    } finally {
      _iterator6.f();
    }
  };
  var enhanceCncHierarchy = function enhanceCncHierarchy() {
    addMobileSheetGroups();
    addDesktopSheetGroups();
  };
  var queueCncEnhance = function queueCncEnhance() {
    if (cncEnhanceQueued) return;
    cncEnhanceQueued = true;
    requestAnimationFrame(function () {
      cncEnhanceQueued = false;
      enhanceCncHierarchy();
    });
  };
  new MutationObserver(function (records) {
    var external = records.some(function (record) {
      return [].concat(_toConsumableArray(record.addedNodes), _toConsumableArray(record.removedNodes)).some(function (node) {
        var _node$dataset;
        return node.nodeType === 1 && !((_node$dataset = node.dataset) !== null && _node$dataset !== void 0 && _node$dataset.panelstockSheetHeading);
      });
    });
    if (external) queueCncEnhance();
  }).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
  queueMicrotask(queueCncEnhance);
  var SESSION = 'panelstock:session:v2';
  var session = null,
    workerUrl = '',
    status = 'synced',
    message = '',
    lockGranted = false,
    lockDenied = false,
    liveSocket = null,
    liveRetry = 1000,
    liveTimer = null;
  var sessionVersion = 0,
    sessionWrites = Promise.resolve();
  try {
    session = JSON.parse(sessionStorage.getItem(SESSION) || 'null');
  } catch (_unused6) {}
  if (session && !(session.expiresAt > Date.now())) {
    session = null;
    sessionStorage.removeItem(SESSION);
  }
  var outbox;
  var announce = function announce(s) {
    var m = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : '';
    status = s;
    message = m;
    root.dispatchEvent(new CustomEvent('panelstock-sync', {
      detail: {
        status: s,
        message: m
      }
    }));
    renderNotice();
  };
  var persistSession = function persistSession() {
    var saved = session ? JSON.stringify(session) : null;
    if (saved) sessionStorage.setItem(SESSION, saved);else sessionStorage.removeItem(SESSION);
    var write = sessionWrites.catch(function () {}).then(function () {
      return saved ? durableStorage.write(SESSION, saved) : durableStorage.delete(SESSION);
    });
    sessionWrites = write;
    return write;
  };
  var clearSession = function clearSession() {
    session = null;
    sessionVersion++;
    status = 'login';
    message = 'Signed out. Pending changes are retained.';
    clearTimeout(liveTimer);
    var socket = liveSocket;
    liveSocket = null;
    if (socket) socket.onclose = null;
    socket === null || socket === void 0 || socket.close();
    var saved = persistSession();
    root.dispatchEvent(new Event('panelstock-session-expired'));
    return saved;
  };
  var sessionChanged = function sessionChanged() {
    return Error('Session changed. Please retry with the current account.');
  };
  var temporaryFailure = function temporaryFailure(response) {
    return response.status === 408 || response.status === 429 || response.status >= 500 && response.status <= 599;
  };
  // Cached stock is usable only by its still-current, unexpired session owner.
  var cachedView = function cachedView(version) {
    var _session, _session2, _session3;
    var owner = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : (_session = session) === null || _session === void 0 ? void 0 : _session.username;
    return version === sessionVersion && ((_session2 = session) === null || _session2 === void 0 ? void 0 : _session2.username) === owner && ((_session3 = session) === null || _session3 === void 0 ? void 0 : _session3.expiresAt) > Date.now() && outbox.state.owner === owner && outbox.state.view ? copy(outbox.state.view) : null;
  };
  var apiFetch = /*#__PURE__*/function () {
    var _apiFetch = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee7(url) {
      var _session4;
      var options,
        absolute,
        authenticating,
        version,
        token,
        current,
        headers,
        res,
        result,
        saved,
        _guard,
        _args8 = arguments;
      return _regenerator().w(function (_context8) {
        while (1) switch (_context8.n) {
          case 0:
            options = _args8.length > 1 && _args8[1] !== undefined ? _args8[1] : {};
            absolute = new URL(url, location.href);
            if (!(!workerUrl || absolute.origin !== new URL(workerUrl).origin)) {
              _context8.n = 1;
              break;
            }
            throw Error('Unapproved API destination');
          case 1:
            authenticating = ['/login', '/set-pin'].includes(absolute.pathname); // Starting a new login also invalidates an older login still in flight.
            if (authenticating) sessionVersion++;
            version = sessionVersion, token = ((_session4 = session) === null || _session4 === void 0 ? void 0 : _session4.token) || null;
            current = function current() {
              var _session5;
              return version === sessionVersion && token === (((_session5 = session) === null || _session5 === void 0 ? void 0 : _session5.token) || null);
            };
            headers = new Headers(options.headers || {});
            headers.delete('Authorization');
            if (token) headers.set('Authorization', 'Bearer ' + token);
            _context8.n = 2;
            return fetch(url, _objectSpread(_objectSpread({}, options), {}, {
              headers: headers,
              cache: 'no-store',
              signal: options.signal || AbortSignal.timeout(20000)
            }));
          case 2:
            res = _context8.v;
            if (current()) {
              _context8.n = 3;
              break;
            }
            throw sessionChanged();
          case 3:
            if (!(authenticating && res.ok)) {
              _context8.n = 7;
              break;
            }
            _context8.n = 4;
            return res.clone().json();
          case 4:
            result = _context8.v;
            if (current()) {
              _context8.n = 5;
              break;
            }
            throw sessionChanged();
          case 5:
            if (!result.token) {
              _context8.n = 7;
              break;
            }
            session = {
              token: result.token,
              username: result.username,
              isAdmin: result.isAdmin,
              taskAccess: result.taskAccess || {},
              expiresAt: result.expiresAt
            };
            version = ++sessionVersion;
            token = session.token;
            _context8.n = 6;
            return persistSession();
          case 6:
            if (current()) {
              _context8.n = 7;
              break;
            }
            throw sessionChanged();
          case 7:
            if (!(res.status === 401 && !authenticating)) {
              _context8.n = 10;
              break;
            }
            saved = clearSession();
            version = sessionVersion;
            token = null;
            _context8.n = 8;
            return saved;
          case 8:
            if (current()) {
              _context8.n = 9;
              break;
            }
            throw sessionChanged();
          case 9:
            announce('login', 'Session expired. Log in again; pending changes are retained.');
          case 10:
            _guard = function guard(response) {
              var _loop3 = function _loop3() {
                var method = _arr[_i5];
                var read = response[method].bind(response);
                response[method] = /*#__PURE__*/_asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee6() {
                  var value,
                    _args7 = arguments;
                  return _regenerator().w(function (_context7) {
                    while (1) switch (_context7.n) {
                      case 0:
                        if (current()) {
                          _context7.n = 1;
                          break;
                        }
                        throw sessionChanged();
                      case 1:
                        _context7.n = 2;
                        return read.apply(void 0, _args7);
                      case 2:
                        value = _context7.v;
                        if (current()) {
                          _context7.n = 3;
                          break;
                        }
                        throw sessionChanged();
                      case 3:
                        return _context7.a(2, value);
                    }
                  }, _callee6);
                }));
              };
              for (var _i5 = 0, _arr = ['json', 'text', 'arrayBuffer', 'blob']; _i5 < _arr.length; _i5++) {
                _loop3();
              }
              var clone = response.clone.bind(response);
              response.clone = function () {
                if (!current()) throw sessionChanged();
                return _guard(clone());
              };
              return response;
            };
            return _context8.a(2, _guard(res));
        }
      }, _callee7);
    }));
    function apiFetch(_x6) {
      return _apiFetch.apply(this, arguments);
    }
    return apiFetch;
  }();
  var _startLive = /*#__PURE__*/function () {
    var _startLive2 = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee8() {
      var _liveSocket, _liveSocket2;
      var response, result, url, socket, _t5;
      return _regenerator().w(function (_context9) {
        while (1) switch (_context9.p = _context9.n) {
          case 0:
            clearTimeout(liveTimer);
            if (!(!root.WebSocket || !session || !workerUrl || ((_liveSocket = liveSocket) === null || _liveSocket === void 0 ? void 0 : _liveSocket.readyState) === WebSocket.OPEN || ((_liveSocket2 = liveSocket) === null || _liveSocket2 === void 0 ? void 0 : _liveSocket2.readyState) === WebSocket.CONNECTING)) {
              _context9.n = 1;
              break;
            }
            return _context9.a(2);
          case 1:
            _context9.p = 1;
            _context9.n = 2;
            return apiFetch(workerUrl + '/live-ticket');
          case 2:
            response = _context9.v;
            _context9.n = 3;
            return response.json();
          case 3:
            result = _context9.v;
            if (!(!response.ok || !result.ticket)) {
              _context9.n = 4;
              break;
            }
            throw Error();
          case 4:
            url = new URL(workerUrl);
            url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
            url.pathname = '/live';
            url.search = '?ticket=' + encodeURIComponent(result.ticket);
            socket = liveSocket = new WebSocket(url);
            socket.onopen = function () {
              liveRetry = 1000;
            };
            socket.onmessage = function (event) {
              try {
                var _outbox;
                var update = JSON.parse(event.data);
                if (['ready', 'revision'].includes(update.type) && update.revision > (((_outbox = outbox) === null || _outbox === void 0 || (_outbox = _outbox.state.view) === null || _outbox === void 0 ? void 0 : _outbox.revision) || 0)) root.dispatchEvent(new CustomEvent('panelstock-remote-change', {
                  detail: update
                }));
              } catch (_unused7) {}
            };
            socket.onclose = function () {
              if (liveSocket === socket) liveSocket = null;
              if (session) liveTimer = setTimeout(function () {
                return void _startLive();
              }, liveRetry = Math.min(liveRetry * 2, 30000));
            };
            socket.onerror = function () {
              return socket.close();
            };
            _context9.n = 6;
            break;
          case 5:
            _context9.p = 5;
            _t5 = _context9.v;
            if (session) liveTimer = setTimeout(function () {
              return void _startLive();
            }, liveRetry = Math.min(liveRetry * 2, 30000));
          case 6:
            return _context9.a(2);
        }
      }, _callee8, null, [[1, 5]]);
    }));
    function startLive() {
      return _startLive2.apply(this, arguments);
    }
    return startLive;
  }();
  var durableStorage = new IndexedOutboxStorage(localStorage, announce);
  var outboxReady = durableStorage.ready().then(function () {
    outbox = new Outbox(durableStorage, function (packet, owner) {
      if (!session || session.username !== owner) return Promise.resolve(new Response('{}', {
        status: 401
      }));
      return apiFetch(workerUrl + '/mutations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(packet)
      });
    }, announce);
    root.PanelStock.outbox = outbox;
    return outbox;
  });
  function getLegacyPending() {
    var raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    try {
      var value = JSON.parse(raw);
      return value && _typeof(value) === 'object' && Object.keys(value).length ? value : null;
    } catch (_unused9) {
      return {
        unreadable: true,
        raw: raw
      };
    }
  }
  function pendingSummary() {
    outbox.finalize();
    var queue = outbox.state.queue || [];
    var changes = queue.flatMap(function (packet) {
      return packet.changes || [];
    });
    var fields = {};
    var _iterator8 = _createForOfIteratorHelper(changes),
      _step8;
    try {
      for (_iterator8.s(); !(_step8 = _iterator8.n()).done;) {
        var change = _step8.value;
        fields[change.field] = (fields[change.field] || 0) + 1;
      }
    } catch (err) {
      _iterator8.e(err);
    } finally {
      _iterator8.f();
    }
    return {
      packets: queue.length,
      changes: changes.length,
      fields: fields,
      draft: !!outbox.state.draft,
      owner: outbox.state.owner || null,
      blocked: outbox.state.blocked || null
    };
  }
  function makeButton(text, onClick) {
    var primary = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : false;
    var button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.style.cssText = 'min-height:42px;padding:10px 16px;border-radius:8px;border:1px solid ' + (primary ? '#155e75' : '#cbd5e1') + ';background:' + (primary ? '#155e75' : '#fff') + ';color:' + (primary ? '#fff' : '#334155') + ';font:600 14px system-ui;cursor:pointer';
    button.onclick = onClick;
    return button;
  }
  function downloadPendingBackup() {
    var _root$navigator, _session6;
    var legacy = getLegacyPending();
    var payload = {
      format: 'panelstock-pending-backup-v1',
      savedAt: new Date().toISOString(),
      browser: ((_root$navigator = root.navigator) === null || _root$navigator === void 0 ? void 0 : _root$navigator.userAgent) || null,
      currentUser: ((_session6 = session) === null || _session6 === void 0 ? void 0 : _session6.username) || null,
      outbox: outbox.state,
      legacyPending: legacy
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json'
    });
    var a = document.createElement('a');
    var href = URL.createObjectURL(blob);
    a.href = href;
    a.download = 'PanelStock-pending-changes-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
    a.click();
    setTimeout(function () {
      return URL.revokeObjectURL(href);
    }, 5000);
  }
  function appendReview(el, legacy) {
    var details = document.createElement('details');
    details.style.cssText = 'margin:18px 0;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;color:#334155';
    var summary = document.createElement('summary');
    summary.textContent = 'Review pending changes';
    summary.style.cssText = 'cursor:pointer;font-weight:700;color:#155e75';
    details.appendChild(summary);
    var info = pendingSummary();
    var intro = document.createElement('p');
    intro.style.cssText = 'margin:12px 0 8px;line-height:1.5';
    if (legacy) intro.textContent = 'These changes were saved by an older PanelStock version. They are preserved below exactly as stored so they can be reconciled safely.';else intro.textContent = "".concat(info.changes, " item change").concat(info.changes === 1 ? '' : 's', " across ").concat(info.packets, " saved batch").concat(info.packets === 1 ? '' : 'es', ".");
    details.appendChild(intro);
    if (!legacy && Object.keys(info.fields).length) {
      var list = document.createElement('ul');
      list.style.cssText = 'margin:8px 0 12px;padding-left:22px';
      for (var _i6 = 0, _Object$entries2 = Object.entries(info.fields); _i6 < _Object$entries2.length; _i6++) {
        var _Object$entries2$_i = _slicedToArray(_Object$entries2[_i6], 2),
          field = _Object$entries2$_i[0],
          count = _Object$entries2$_i[1];
        var li = document.createElement('li');
        li.textContent = "".concat(field, ": ").concat(count, " change").concat(count === 1 ? '' : 's');
        list.appendChild(li);
      }
      details.appendChild(list);
    }
    var pre = document.createElement('pre');
    pre.style.cssText = 'white-space:pre-wrap;word-break:break-word;max-height:360px;overflow:auto;background:#f8fafc;border-radius:8px;padding:12px;font:12px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;color:#334155';
    pre.textContent = JSON.stringify(legacy ? legacy : outbox.state.queue, null, 2);
    details.appendChild(pre);
    el.appendChild(details);
  }
  function renderNotice() {
    var el = document.getElementById('panelstock-safety-notice');
    var legacy = getLegacyPending();
    var ownerMismatch = session && outbox.pending() && outbox.state.owner !== session.username;
    var blocked = lockDenied || !!legacy || ['conflict', 'storage'].includes(status) || ownerMismatch;
    if (!el) {
      el = document.createElement('div');
      el.id = 'panelstock-safety-notice';
      document.body.appendChild(el);
    }
    el.replaceChildren();
    if (!blocked) {
      if (outbox.pending()) {
        el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#fff7ed;color:#7c2d12;padding:8px;text-align:center;font:14px system-ui;pointer-events:auto;display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap';
        var text = document.createElement('span');
        text.textContent = status === 'syncing' ? 'Saving pending stock changes…' : message || 'Changes saved on this device — waiting to sync';
        el.appendChild(text);
        if (status !== 'syncing' && session) {
          el.appendChild(makeButton('Retry sync now', /*#__PURE__*/function () {
            var _ref4 = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee9(event) {
              var button, ok;
              return _regenerator().w(function (_context0) {
                while (1) switch (_context0.n) {
                  case 0:
                    button = event.currentTarget;
                    button.disabled = true;
                    button.textContent = 'Retrying…';
                    message = '';
                    outbox.clearBlocked();
                    _context0.n = 1;
                    return outbox.flush(session.username);
                  case 1:
                    ok = _context0.v;
                    if (ok && !outbox.pending()) {
                      button.textContent = 'Synced — reloading…';
                      setTimeout(function () {
                        return location.reload();
                      }, 350);
                    } else renderNotice();
                  case 2:
                    return _context0.a(2);
                }
              }, _callee9);
            }));
            return function (_x7) {
              return _ref4.apply(this, arguments);
            };
          }(), true));
        }
      } else {
        el.style.display = 'none';
      }
      return;
    }
    el.style.cssText = 'position:fixed;inset:0;z-index:999999;background:rgba(15,23,42,.52);padding:clamp(12px,3vw,28px);font:16px system-ui;overflow:auto;color:#334155;display:flex;align-items:flex-start;justify-content:center';
    var card = document.createElement('section');
    card.style.cssText = 'width:min(680px,100%);margin:clamp(8px,4vh,44px) auto;background:#fff;border:1px solid #cbd5e1;border-radius:12px;padding:clamp(18px,4vw,28px);box-shadow:0 24px 70px rgba(15,23,42,.25)';
    el.appendChild(card);
    var titleRow = document.createElement('div');
    titleRow.style.cssText = 'display:flex;align-items:flex-start;gap:12px;margin-bottom:20px';
    var icon = document.createElement('div');
    icon.style.cssText = 'width:42px;height:42px;flex:0 0 42px;display:grid;place-items:center;border-radius:9px;background:#0f172a;color:#fff;font:800 22px system-ui';
    icon.textContent = '!';
    titleRow.appendChild(icon);
    var titleText = document.createElement('div');
    titleText.style.cssText = 'min-width:0';
    titleRow.appendChild(titleText);
    card.appendChild(titleRow);
    var heading = document.createElement('h2');
    heading.style.cssText = 'margin:0 0 4px;color:#0f172a;font-size:20px;line-height:1.25';
    heading.textContent = lockDenied ? 'PanelStock is open in another tab' : 'Unsynced changes are saved on this device';
    titleText.appendChild(heading);
    var p = document.createElement('p');
    p.style.cssText = 'margin:0;line-height:1.5;color:#64748b;font-size:14px';
    p.textContent = lockDenied ? 'Only one PanelStock tab may edit stock at a time. Close the other tab and reload this one.' : legacy ? 'These changes came from the previous app. They have not been deleted. Review or export them before deciding whether to discard them.' : ownerMismatch ? 'These pending changes belong to ' + outbox.state.owner + '. Log in as that user to retry the sync, or export them for review.' : message || 'PanelStock could not safely apply one or more saved changes. Nothing has been discarded.';
    titleText.appendChild(p);
    if (lockDenied) return;
    var info = pendingSummary();
    var statusBox = document.createElement('div');
    statusBox.style.cssText = 'background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;margin:12px 0;color:#475569;font-size:14px';
    statusBox.textContent = legacy ? 'Recovery status: previous-version changes detected' : "Recovery status: ".concat(info.changes, " saved change").concat(info.changes === 1 ? '' : 's').concat(info.blocked ? ' — server review required' : ' — waiting to sync');
    card.appendChild(statusBox);
    appendReview(card, legacy);
    var actions = document.createElement('div');
    actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:16px';
    if (ownerMismatch) actions.appendChild(makeButton('Switch user', /*#__PURE__*/function () {
      var _ref5 = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee0(event) {
        return _regenerator().w(function (_context1) {
          while (1) switch (_context1.n) {
            case 0:
              event.currentTarget.disabled = true;
              event.currentTarget.textContent = 'Signing out…';
              _context1.n = 1;
              return root.PanelStock.logout();
            case 1:
              renderNotice();
            case 2:
              return _context1.a(2);
          }
        }, _callee0);
      }));
      return function (_x8) {
        return _ref5.apply(this, arguments);
      };
    }(), true));
    if (!legacy && !ownerMismatch && session) {
      actions.appendChild(makeButton('Retry sync now', /*#__PURE__*/function () {
        var _ref6 = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee1(event) {
          var button, old, ok;
          return _regenerator().w(function (_context10) {
            while (1) switch (_context10.n) {
              case 0:
                button = event.currentTarget;
                old = button.textContent;
                button.disabled = true;
                button.textContent = 'Retrying…';
                outbox.clearBlocked();
                _context10.n = 1;
                return outbox.flush(session.username);
              case 1:
                ok = _context10.v;
                button.disabled = false;
                button.textContent = ok && !outbox.pending() ? 'Synced — reloading…' : old;
                if (ok && !outbox.pending()) setTimeout(function () {
                  return location.reload();
                }, 350);else renderNotice();
              case 2:
                return _context10.a(2);
            }
          }, _callee1);
        }));
        return function (_x9) {
          return _ref6.apply(this, arguments);
        };
      }(), true));
    }
    actions.appendChild(makeButton('Export backup', function (event) {
      downloadPendingBackup();
      event.currentTarget.textContent = 'Backup exported';
    }));
    actions.appendChild(makeButton('Discard local changes', /*#__PURE__*/_asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee10() {
      var warning;
      return _regenerator().w(function (_context11) {
        while (1) switch (_context11.n) {
          case 0:
            warning = legacy ? 'These previous-version changes will NOT be applied to shared stock. Export a backup first if they may still be needed. Discard them now?' : 'These unsynced changes will NOT be applied to shared stock. Export a backup first if they may still be needed. Discard them now?';
            _context11.n = 1;
            return styledConfirm({
              title: 'Discard local changes?',
              message: warning,
              confirmLabel: 'Discard changes'
            });
          case 1:
            if (_context11.v) {
              _context11.n = 2;
              break;
            }
            return _context11.a(2);
          case 2:
            localStorage.removeItem(LEGACY_KEY);
            void durableStorage.removeItem(OUTBOX_KEY).then(function () {
              return location.reload();
            });
          case 3:
            return _context11.a(2);
        }
      }, _callee10);
    }))));
    card.appendChild(actions);
    var foot = document.createElement('p');
    foot.style.cssText = 'margin:16px 0 0;color:#64748b;font-size:13px;line-height:1.45';
    foot.textContent = legacy ? 'Automatic retry is not offered for previous-version data because its format cannot be proven safe for the current server. Review/export preserves it without risking duplicate or incorrect stock movements.' : 'PanelStock keeps pending changes locally until the server acknowledges them. Closing the browser does not intentionally remove this queue.';
    card.appendChild(foot);
  }
  if (navigator.locks) {
    void navigator.locks.request('panelstock-editor-v2', {
      ifAvailable: true
    }, function (lock) {
      if (!lock) {
        lockDenied = true;
        announce('storage', 'PanelStock is already open in another tab. Use that tab or close it and reload.');
        return;
      }
      lockGranted = true;
      return new Promise(function () {});
    });
  } else {
    lockGranted = false;
    queueMicrotask(function () {
      return announce('storage', 'This browser cannot safely coordinate offline changes. Use an up-to-date browser.');
    });
  }
  root.PanelStock = {
    confirm: styledConfirm,
    showCopy: showCopyDialog,
    apiFetch: apiFetch,
    outbox: outbox,
    init: function init(url) {
      return _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee11() {
        var initialVersion, saved, version, offlineUser, r, user, _t6, _t7, _t8, _t9;
        return _regenerator().w(function (_context12) {
          while (1) switch (_context12.p = _context12.n) {
            case 0:
              initialVersion = sessionVersion;
              _context12.n = 1;
              return outboxReady;
            case 1:
              workerUrl = url.replace(/\/$/, '');
              if (!(initialVersion !== sessionVersion)) {
                _context12.n = 2;
                break;
              }
              return _context12.a(2, null);
            case 2:
              if (session) {
                _context12.n = 10;
                break;
              }
              _context12.p = 3;
              _context12.n = 4;
              return sessionWrites;
            case 4:
              _t6 = JSON;
              _context12.n = 5;
              return durableStorage.read(SESSION);
            case 5:
              _t7 = _context12.v;
              if (_t7) {
                _context12.n = 6;
                break;
              }
              _t7 = 'null';
            case 6:
              saved = _t6.parse.call(_t6, _t7);
              if (!(initialVersion !== sessionVersion)) {
                _context12.n = 7;
                break;
              }
              return _context12.a(2, null);
            case 7:
              session = (saved === null || saved === void 0 ? void 0 : saved.expiresAt) > Date.now() ? saved : null;
              if (session) sessionStorage.setItem(SESSION, JSON.stringify(session));
              _context12.n = 10;
              break;
            case 8:
              _context12.p = 8;
              _t8 = _context12.v;
              if (!(initialVersion !== sessionVersion)) {
                _context12.n = 9;
                break;
              }
              return _context12.a(2, null);
            case 9:
              session = null;
            case 10:
              if (!(session && !(session.expiresAt > Date.now()))) {
                _context12.n = 12;
                break;
              }
              _context12.n = 11;
              return clearSession();
            case 11:
              return _context12.a(2, null);
            case 12:
              if (session) {
                _context12.n = 13;
                break;
              }
              return _context12.a(2, null);
            case 13:
              version = sessionVersion;
              offlineUser = function offlineUser() {
                if (!cachedView(version)) return null;
                announce('offline', 'Showing the last saved stock view. Connection needed to verify login.');
                return {
                  username: session.username,
                  isAdmin: !!session.isAdmin,
                  taskAccess: session.taskAccess || {},
                  offline: true
                };
              };
              _context12.p = 14;
              _context12.n = 15;
              return apiFetch(workerUrl + '/session');
            case 15:
              r = _context12.v;
              if (r.ok) {
                _context12.n = 16;
                break;
              }
              return _context12.a(2, temporaryFailure(r) ? offlineUser() : null);
            case 16:
              _context12.n = 17;
              return r.json();
            case 17:
              user = _context12.v;
              if (!(version !== sessionVersion)) {
                _context12.n = 18;
                break;
              }
              return _context12.a(2, null);
            case 18:
              session = _objectSpread(_objectSpread({}, session), user);
              _context12.n = 19;
              return persistSession();
            case 19:
              if (!(version !== sessionVersion)) {
                _context12.n = 20;
                break;
              }
              return _context12.a(2, null);
            case 20:
              void _startLive();
              return _context12.a(2, user);
            case 21:
              _context12.p = 21;
              _t9 = _context12.v;
              return _context12.a(2, offlineUser());
          }
        }, _callee11, null, [[14, 21], [3, 8]]);
      }))();
    },
    snapshot: function snapshot() {
      return _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee12() {
        var version, owner, offlineSnapshot, r, data, view, _t0;
        return _regenerator().w(function (_context13) {
          while (1) switch (_context13.p = _context13.n) {
            case 0:
              if (!(session && !(session.expiresAt > Date.now()))) {
                _context13.n = 2;
                break;
              }
              _context13.n = 1;
              return clearSession();
            case 1:
              return _context13.a(2, null);
            case 2:
              if (session) {
                _context13.n = 3;
                break;
              }
              return _context13.a(2, null);
            case 3:
              version = sessionVersion, owner = session.username;
              offlineSnapshot = function offlineSnapshot() {
                var view = cachedView(version, owner);
                if (view) announce('offline', 'Showing the last saved stock view. Changes will sync when connection returns.');
                return view;
              };
              _context13.n = 4;
              return outbox.flush(owner);
            case 4:
              if (!(version !== sessionVersion)) {
                _context13.n = 5;
                break;
              }
              return _context13.a(2, null);
            case 5:
              _context13.p = 5;
              _context13.n = 6;
              return apiFetch(workerUrl + '/data');
            case 6:
              r = _context13.v;
              if (r.ok) {
                _context13.n = 7;
                break;
              }
              return _context13.a(2, temporaryFailure(r) ? offlineSnapshot() : null);
            case 7:
              _context13.n = 8;
              return r.json();
            case 8:
              data = _context13.v;
              if (!(version !== sessionVersion)) {
                _context13.n = 9;
                break;
              }
              return _context13.a(2, null);
            case 9:
              view = outbox.snapshot(data, owner);
              _context13.n = 10;
              return durableStorage.flushWrites();
            case 10:
              if (!(version !== sessionVersion)) {
                _context13.n = 11;
                break;
              }
              return _context13.a(2, null);
            case 11:
              return _context13.a(2, view);
            case 12:
              _context13.p = 12;
              _t0 = _context13.v;
              return _context13.a(2, offlineSnapshot());
          }
        }, _callee12, null, [[5, 12]]);
      }))();
    },
    stage: function stage(fields, rendered) {
      if (getLegacyPending()) throw Error('Previous-version pending changes must be reviewed before editing stock.');
      if (!lockGranted) throw Error('This tab cannot edit stock.');
      if (!session) throw Error('Please log in before editing.');
      outbox.stage(fields, session.username, rendered);
    },
    flush: function flush() {
      return _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee13() {
        return _regenerator().w(function (_context14) {
          while (1) switch (_context14.n) {
            case 0:
              _context14.n = 1;
              return outboxReady;
            case 1:
              return _context14.a(2, session ? outbox.flush(session.username) : false);
          }
        }, _callee13);
      }))();
    },
    logout: function logout() {
      return _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee14() {
        var _session7;
        var token, saved, version, revoked, response, _t1, _t10;
        return _regenerator().w(function (_context15) {
          while (1) switch (_context15.p = _context15.n) {
            case 0:
              token = (_session7 = session) === null || _session7 === void 0 ? void 0 : _session7.token;
              saved = clearSession(), version = sessionVersion;
              renderNotice();
              revoked = true;
              _context15.p = 1;
              if (!token) {
                _context15.n = 3;
                break;
              }
              _context15.n = 2;
              return fetch(workerUrl + '/logout', {
                method: 'POST',
                headers: {
                  'Authorization': 'Bearer ' + token,
                  'Content-Type': 'application/json'
                },
                body: '{}',
                cache: 'no-store',
                signal: AbortSignal.timeout(20000)
              });
            case 2:
              response = _context15.v;
              revoked = response.ok || response.status === 401;
            case 3:
              _context15.n = 5;
              break;
            case 4:
              _context15.p = 4;
              _t1 = _context15.v;
              revoked = false;
            case 5:
              _context15.p = 5;
              _context15.n = 6;
              return saved;
            case 6:
              _context15.n = 8;
              break;
            case 7:
              _context15.p = 7;
              _t10 = _context15.v;
              revoked = false;
            case 8:
              if (version === sessionVersion) announce('login', revoked ? 'Signed out. Pending changes are retained.' : 'Signed out on this device. Server sign-out could not be confirmed; pending changes are retained.');
              return _context15.a(2, revoked);
          }
        }, _callee14, null, [[5, 7], [1, 4]]);
      }))();
    },
    exportPending: downloadPendingBackup,
    reviewPending: function reviewPending() {
      return {
        legacy: getLegacyPending(),
        summary: pendingSummary(),
        outbox: copy(outbox.state)
      };
    },
    get username() {
      var _session8;
      return ((_session8 = session) === null || _session8 === void 0 ? void 0 : _session8.username) || null;
    },
    get revision() {
      var _outbox2;
      return (_outbox2 = outbox) === null || _outbox2 === void 0 || (_outbox2 = _outbox2.state.view) === null || _outbox2 === void 0 ? void 0 : _outbox2.revision;
    },
    get status() {
      return status;
    },
    get pending() {
      var _outbox3;
      return !!((_outbox3 = outbox) !== null && _outbox3 !== void 0 && _outbox3.pending()) || !!getLegacyPending();
    }
  };
  root.addEventListener('online', function () {
    void root.PanelStock.flush();
  });
  root.addEventListener('online', function () {
    void _startLive();
  });
  void outboxReady.then(renderNotice);
})(typeof window === 'undefined' ? globalThis : window);
