import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import {parse} from 'acorn';
import {legacyAttendancePage, writeAssets} from '../scripts/build-attendance-ios10.mjs';
import {buildAttendancePage} from '../src/attendance-page.js';

const runtime = readFileSync(new URL('../compat/attendance-ios10-runtime.js', import.meta.url), 'utf8');
const inline = (html, tag) => html.match(new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>'))[1];
const pages = [legacyAttendancePage(), legacyAttendancePage(true)];
const stationKey = 'panelstock-attendance-station';
const stationToken = 'a1'.repeat(32);
const otherStationToken = 'b2'.repeat(32);

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
}

function harness({nativeUUID, secure = true, html, hash = '', standalone = false, localStorage = memoryStorage(), sessionStorage = memoryStorage()} = {}) {
  const requests = [], readers = [], timers = [], ids = new Map();
  let document, entropy = 0;
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase();
      this.nodeType = 1;
      this.children = [];
      this.ownerDocument = document;
      this.dataset = {};
      this.attributes = {};
      this.listeners = {};
      this.hidden = false;
      this.disabled = false;
      this.value = '';
      this.textContent = '';
    }
    get firstChild() { return this.children[0] || null; }
    appendChild(node) {
      if (node.parentNode) node.parentNode.removeChild(node);
      this.children.push(node);
      node.parentNode = this;
      return node;
    }
    removeChild(node) {
      const index = this.children.indexOf(node);
      if (index === -1) throw new Error('Not a child');
      this.children.splice(index, 1);
      node.parentNode = null;
      return node;
    }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    removeAttribute(name) { delete this.attributes[name]; }
    addEventListener(name, listener) { this.listeners[name] = listener; }
    focus() { document.activeElement = this; }
    select() { this.selected = true; }
    reset() {}
    contains(node) { return this === node || this.children.some(child => child.contains?.(node)); }
    querySelectorAll() { return {length: 0}; }
  }
  class Document {
    createElement(tag) { return new Element(tag); }
    createTextNode(value) { return {nodeType: 3, textContent: value, ownerDocument: this}; }
    querySelectorAll() { return {length: 0}; }
    getElementById(id) {
      if (ids.has(id)) return ids.get(id);
      function find(node) {
        if (node.id === id) return node;
        for (const child of node.children || []) {
          const result = find(child);
          if (result) return result;
        }
        return null;
      }
      return find(this.body);
    }
    addEventListener() {}
  }
  class DocumentFragment extends Element {}
  document = new Document();
  document.body = new Element('body');
  document.activeElement = document.body;
  if (html) {
    for (const match of html.matchAll(/\bid="([^"]+)"/g)) {
      const id = match[1];
      const node = new Element();
      node.id = id;
      const tag = html.slice(html.lastIndexOf('<', match.index), html.indexOf('>', match.index) + 1);
      node.hidden = /\shidden(?:\s|>|=)/.test(tag);
      ids.set(id, node);
    }
    ids.get('attendance-test-startup').hidden = false;
  }
  class XMLHttpRequest {
    constructor() { this.headers = {}; requests.push(this); }
    open(method, url, asynchronous) { this.method = method; this.url = url; this.asynchronous = asynchronous; }
    setRequestHeader(name, value) { this.headers[name] = value; }
    send(body) { this.body = body; }
    respond(status, value) { this.status = status; this.responseText = value; this.onload(); }
  }
  class FileReader {
    constructor() { readers.push(this); }
    readAsText(blob) { this.blob = blob; }
    complete(text) { this.result = text; this.onload(); }
  }
  const crypto = secure ? {getRandomValues(bytes) {
    for (let index = 0; index < bytes.length; index++) bytes[index] = (entropy++ * 31 + index) % 256;
    return bytes;
  }} : {};
  if (nativeUUID) crypto.randomUUID = nativeUUID;
  const context = {
    crypto, Element, Document, DocumentFragment, document, XMLHttpRequest, FileReader,
    Uint8Array, Promise, console,
    location: {hash, pathname: '/sign-in/', origin: 'https://attendance-test.example'},
    localStorage, sessionStorage,
    history: {urls: [], replaceState(_state, _title, url) {
      this.urls.push(url);
      context.location.hash = url.includes('#') ? url.slice(url.indexOf('#')) : '';
    }}, navigator: {standalone},
    setInterval() {}, clearInterval() {},
    setTimeout(callback, delay) { const timer = {callback, delay, cleared: false}; timers.push(timer); return timer; },
    clearTimeout(timer) { if (timer) timer.cleared = true; },
    confirm: () => true
  };
  let nativeStatus = 'browser status';
  Object.defineProperty(context, 'status', {
    get: () => nativeStatus,
    set: value => { nativeStatus = String(value); }
  });
  context.window = context;
  vm.createContext(context);
  return {context, requests, readers, timers, ids, document, Element, Document, DocumentFragment, load() { vm.runInContext(runtime, context); }};
}

test('both isolated pages contain ES5 scripts and exact same-origin CSP hashes', () => {
  for (const html of pages) {
    const script = inline(html, 'script'), style = inline(html, 'style');
    parse('"use strict";\n' + script, {ecmaVersion: 5, sourceType: 'script'});
    for (const source of [script, style]) {
      const hash = createHash('sha256').update(source).digest('base64');
      assert.ok(html.includes("'sha256-" + hash + "'"));
    }
    assert.match(html, /connect-src 'self'/);
    assert.match(html, /img-src 'self' data:/);
    assert.doesNotMatch(html, /nonce=|unsafe-inline|https?:\/\/|<script[^>]+src=/);
    assert.match(script, /var API_BASE=""/);
    assert.doesNotMatch(script, /\bfetch\s*\(|AbortSignal|\.replaceAll\(/);
    assert.match(html, /iOS 10 compatibility test · Demo data only/);
    assert.match(html, /Use made-up names/);
    assert.match(html, /id="attendance-test-startup"[^>]*>Loading compatibility test/);
    assert.match(html, /alt="Lennox Facades"/);
    assert.doesNotMatch(html, /Welcome to PanelStock/);
  }
  assert.doesNotMatch(pages[0], /Demo administrator:/);
  assert.match(pages[1], /Demo administrator: <strong>ipadtest<\/strong> · PIN <strong>103434/);
  assert.match(pages[0], /People currently signed in/);
  assert.match(inline(pages[0], 'script'), /touchstart/);
  assert.match(pages[0], /<meta name="apple-mobile-web-app-capable" content="yes">/);
  assert.match(pages[0], /<meta name="apple-mobile-web-app-title" content="Lennox Test">/);
  assert.match(pages[0], /<meta name="apple-mobile-web-app-status-bar-style" content="default">/);
  assert.match(pages[0], /<link rel="apple-touch-icon" href="\/sign-in\/apple-touch-icon.png">/);
  assert.match(pages[0], /Test administrator: <strong>ipadtest<\/strong> · PIN <strong>103434/);
  assert.match(pages[0], /id="attendance-admin-pin" type="password" inputmode="numeric" pattern="\[0-9\]\*"/);
  assert.match(pages[0], /Connecting replaces the current station link\. Other paired screens will need a new link\./);
  assert.match(pages[0], /id="attendance-admin-connect-button"[^>]*aria-describedby="attendance-admin-connect-notice"[^>]*>Connect this iPad/);
  assert.doesNotMatch(pages[1], /name="apple-mobile-web-app-capable"|rel="apple-touch-icon"|id="attendance-install"/);
  assert.match(pages[1], /id="export"[^>]*>View CSV/);
  assert.match(inline(pages[1], 'script'), /attendanceLegacyPreviewCsv\(blob,link\.download\)/);
  assert.doesNotMatch(inline(pages[1], 'script'), /link\.click\(/);
});

test('asset generation is deterministic and keeps the modern builder unchanged', () => {
  const directory = mkdtempSync(join(tmpdir(), 'attendance-ios10-'));
  try {
    writeAssets(directory);
    for (const [index, file] of ['index.html', 'manage/index.html'].entries()) {
      assert.equal(readFileSync(join(directory, file), 'utf8'), pages[index]);
      assert.equal(legacyAttendancePage(Boolean(index)), pages[index]);
    }
    assert.deepEqual(readFileSync(join(directory, 'apple-touch-icon.png')), readFileSync(new URL('../../icon-adaptive-v4-192.png', import.meta.url)));
    for (const manage of [false, true]) {
      const modern = buildAttendancePage('modern-test', manage);
      assert.match(modern, /nonce="modern-test"/);
      assert.match(modern, /fetch\(API_BASE\+path/);
      assert.doesNotMatch(modern, /attendance-test-banner|compatibility test|attendanceLegacyRestoreStation|apple-mobile-web-app-capable|id="attendance-install"/);
    }
  } finally { rmSync(directory, {recursive: true, force: true}); }
});

test('both complete bundles initialize with old noniterable NodeLists and no fetch or AbortSignal', () => {
  for (const html of pages) {
    const h = harness({html});
    vm.runInContext(inline(html, 'script'), h.context);
    assert.equal(h.ids.get('attendance-test-startup').hidden, true);
    assert.equal(h.requests.length, 0);
  }
});

test('kiosk pairing survives a new Safari session using local storage and keeps admin credentials session-only', () => {
  const localStorage = memoryStorage();
  const first = harness({html: pages[0], hash: '#' + stationToken, localStorage});
  first.context.sessionStorage.setItem('panelstock-attendance-admin', 'session-only-admin');
  vm.runInContext(inline(pages[0], 'script'), first.context);
  assert.equal(first.ids.get('setup').hidden, true);
  assert.equal(first.ids.get('station').hidden, false);
  assert.equal(first.context.location.hash, '');
  assert.equal(first.context.localStorage.getItem(stationKey), stationToken);
  assert.equal(first.context.sessionStorage.getItem(stationKey), stationToken);
  assert.equal(first.context.localStorage.getItem('panelstock-attendance-admin'), null);
  assert.equal(first.context.sessionStorage.getItem('panelstock-attendance-admin'), 'session-only-admin');

  const reopened = harness({html: pages[0], localStorage});
  vm.runInContext(inline(pages[0], 'script'), reopened.context);
  assert.equal(reopened.ids.get('attendance-test-startup').hidden, true);
  assert.equal(reopened.ids.get('setup').hidden, true);
  assert.equal(reopened.context.sessionStorage.getItem(stationKey), stationToken);
  assert.equal(reopened.ids.get('attendance-install').hidden, false);
});

test('fresh standalone administrator setup logs in, pairs and logs out in place, saving only the station credential', async () => {
  const h = harness({html: pages[0], standalone: true});
  vm.runInContext(inline(pages[0], 'script'), h.context);
  assert.equal(h.ids.get('setup').hidden, false);
  for (const id of ['attendance-install', 'attendance-setup-code-button', 'attendance-use-code', 'attendance-setup-code-controls']) assert.equal(h.ids.get(id).hidden, true);
  h.ids.get('attendance-setup-code-button').listeners.click();
  h.ids.get('attendance-use-code').listeners.click();
  h.ids.get('attendance-setup-code').value = '12345678';
  h.ids.get('attendance-connect').listeners.submit({preventDefault() {}});
  assert.equal(h.requests.length, 0);
  h.ids.get('attendance-admin-username').value = ' ipadtest ';
  h.ids.get('attendance-admin-pin').value = '103434';
  const pending = h.ids.get('attendance-admin-connect').listeners.submit({preventDefault() {}});
  assert.equal(h.ids.get('attendance-admin-pin').value, '');
  assert.equal(h.ids.get('attendance-admin-connect-button').disabled, true);
  h.ids.get('attendance-admin-connect').listeners.submit({preventDefault() {}});
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, '/login');
  assert.deepEqual(JSON.parse(h.requests[0].body), {username: 'ipadtest', pin: '103434'});
  assert.equal(h.requests[0].headers.Authorization, undefined);
  h.requests[0].respond(200, '{"ok":true,"isAdmin":true,"token":"temporary-admin-session"}');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.requests[1].url, '/attendance/kiosk');
  assert.equal(h.requests[1].headers.Authorization, 'Bearer temporary-admin-session');
  h.requests[1].respond(200, JSON.stringify({ok: true, kioskToken: stationToken}));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.requests[2].url, '/logout');
  assert.equal(h.requests[2].headers.Authorization, 'Bearer temporary-admin-session');
  assert.equal(h.ids.get('setup').hidden, false);
  h.requests[2].respond(200, '{"ok":true}');
  await pending;
  assert.equal(h.ids.get('setup').hidden, true);
  assert.equal(h.ids.get('station').hidden, false);
  assert.equal(h.ids.get('attendance-admin-username').value, '');
  assert.equal(h.ids.get('attendance-admin-pin').value, '');
  assert.equal(h.ids.get('attendance-admin-connect-button').disabled, false);
  assert.deepEqual([...h.context.localStorage.values], [[stationKey, stationToken]]);
  assert.deepEqual([...h.context.sessionStorage.values], [[stationKey, stationToken]]);
  for (const id of ['attendance-install', 'attendance-setup-code-button', 'attendance-use-code', 'attendance-setup-code-controls']) assert.equal(h.ids.get(id).hidden, true);
  assert.equal(h.context.session, undefined);
  assert.equal(h.context.token, undefined);
  assert.equal(h.context.location.hash, '');
  h.ids.get('name').value = 'Connected iPad Visitor';
  const checkIn = h.ids.get('check-in').listeners.submit({preventDefault() {}});
  assert.equal(JSON.parse(h.requests[3].body).kioskToken, stationToken);
  assert.equal(h.requests[3].headers.Authorization, undefined);
  h.requests[3].respond(200, '{"ok":true,"entry":{"name":"Connected iPad Visitor","signedInAt":"2026-11-05T00:00:00Z"}}');
  await checkIn;
  assert.equal(h.ids.get('success-title').textContent, 'You’re signed in');
  const reopened = harness({html: pages[0], standalone: true, localStorage: h.context.localStorage});
  vm.runInContext(inline(pages[0], 'script'), reopened.context);
  assert.equal(reopened.ids.get('setup').hidden, true);
  assert.equal(reopened.ids.get('station').hidden, false);
  assert.equal(reopened.ids.get('attendance-install').hidden, true);
  assert.equal(reopened.ids.get('attendance-setup-code-button').hidden, true);
  assert.equal(reopened.requests.length, 0);
  for (const url of h.requests.map(request => request.url).concat(h.context.history.urls)) assert.doesNotMatch(url, /temporary-admin-session|103434|ipadtest|a1a1a1a1/);
});

test('administrator setup clears the PIN immediately and allows failed authentication or network requests to retry', async () => {
  const failures = [
    {status: 401, body: '{"ok":false,"error":"Invalid username or PIN"}', message: /Invalid username or PIN/},
    {status: 429, body: '{"ok":false,"error":"Please wait 30 seconds"}', message: /Please wait 30 seconds/},
    {status: 200, body: '{"ok":true,"isAdmin":true}', message: /did not return a session/},
    {status: 200, body: '{"ok":true,"mustChangePin":true}', message: /Set your PIN in the PanelStock app/},
    {event: 'ontimeout', message: /timed out/},
    {event: 'onerror', message: /connection failed/}
  ];
  for (const failure of failures) {
    const h = harness({html: pages[0], standalone: true});
    vm.runInContext(inline(pages[0], 'script'), h.context);
    const form = h.ids.get('attendance-admin-connect');
    form.listeners.submit({preventDefault() {}});
    assert.equal(h.requests.length, 0);
    assert.match(h.ids.get('attendance-admin-connect-status').textContent, /username and PIN/);
    h.ids.get('attendance-admin-username').value = 'ipadtest';
    h.ids.get('attendance-admin-pin').value = '103434';
    const pending = form.listeners.submit({preventDefault() {}});
    assert.equal(h.ids.get('attendance-admin-pin').value, '');
    if (failure.event) h.requests[0][failure.event]();
    else h.requests[0].respond(failure.status, failure.body);
    await pending;
    assert.equal(h.requests.length, 1);
    assert.equal(h.ids.get('setup').hidden, false);
    assert.equal(h.ids.get('station').hidden, true);
    assert.equal(h.ids.get('attendance-admin-connect-button').disabled, false);
    assert.match(h.ids.get('attendance-admin-connect-status').textContent, failure.message);
    assert.equal(h.context.localStorage.values.size, 0);
    assert.equal(h.context.sessionStorage.values.size, 0);
  }
});

test('every issued setup session is logged out after non-admin rejection or a failed kiosk request', async () => {
  const failures = [
    {login: {isAdmin: false}, message: /administrator account is required/},
    {login: {isAdmin: true, mustChangePin: true}, message: /Set your PIN/},
    {status: 403, body: '{"ok":false,"error":"Administrator access required"}', message: /Administrator access required/},
    {status: 503, body: '{"ok":false,"error":"Maintenance in progress"}', message: /Maintenance in progress/},
    {status: 200, body: '{"ok":true,"kioskToken":"malformed"}', message: /could not be connected/},
    {event: 'ontimeout', message: /timed out/},
    {event: 'onerror', message: /connection failed/}
  ];
  for (const failure of failures) {
    const h = harness({html: pages[0], standalone: true});
    vm.runInContext(inline(pages[0], 'script'), h.context);
    h.ids.get('attendance-admin-username').value = 'ipadtest';
    h.ids.get('attendance-admin-pin').value = '103434';
    const pending = h.ids.get('attendance-admin-connect').listeners.submit({preventDefault() {}});
    h.requests[0].respond(200, JSON.stringify({ok: true, isAdmin: true, token: 'temporary-session', ...failure.login}));
    await new Promise(resolve => setImmediate(resolve));
    if (!failure.login) {
      assert.equal(h.requests[1].url, '/attendance/kiosk');
      if (failure.event) h.requests[1][failure.event]();
      else h.requests[1].respond(failure.status, failure.body);
      await new Promise(resolve => setImmediate(resolve));
    }
    const logout = h.requests.at(-1);
    assert.equal(logout.url, '/logout');
    assert.equal(logout.headers.Authorization, 'Bearer temporary-session');
    logout.respond(200, '{"ok":true}');
    await pending;
    assert.equal(h.requests.filter(request => request.url === '/attendance/kiosk').length, failure.login ? 0 : 1);
    assert.equal(h.ids.get('setup').hidden, false);
    assert.equal(h.ids.get('station').hidden, true);
    assert.equal(h.ids.get('attendance-admin-pin').value, '');
    assert.equal(h.ids.get('attendance-admin-connect-button').disabled, false);
    assert.match(h.ids.get('attendance-admin-connect-status').textContent, failure.message);
    assert.equal(h.context.localStorage.values.size, 0);
    assert.equal(h.context.sessionStorage.values.size, 0);
  }
});

test('successful administrator pairing remains usable when logout cleanup loses its connection', async () => {
  const h = harness({html: pages[0], standalone: true});
  vm.runInContext(inline(pages[0], 'script'), h.context);
  h.ids.get('attendance-admin-username').value = 'ipadtest';
  h.ids.get('attendance-admin-pin').value = '103434';
  const pending = h.ids.get('attendance-admin-connect').listeners.submit({preventDefault() {}});
  h.requests[0].respond(200, '{"ok":true,"isAdmin":true,"token":"temporary-session"}');
  await new Promise(resolve => setImmediate(resolve));
  h.requests[1].respond(200, JSON.stringify({ok: true, kioskToken: stationToken}));
  await new Promise(resolve => setImmediate(resolve));
  h.requests[2].ontimeout();
  await pending;
  assert.equal(h.ids.get('setup').hidden, true);
  assert.equal(h.ids.get('station').hidden, false);
  assert.deepEqual([...h.context.localStorage.values], [[stationKey, stationToken]]);
  assert.deepEqual([...h.context.sessionStorage.values], [[stationKey, stationToken]]);
  assert.equal(h.ids.get('attendance-admin-pin').value, '');
});

test('Safari installation explains direct in-app setup while its numeric fallback stays secondary', () => {
  const h = harness({html: pages[0], hash: '#' + stationToken});
  vm.runInContext(inline(pages[0], 'script'), h.context);
  assert.equal(h.ids.get('attendance-use-code').hidden, false);
  assert.equal(h.ids.get('attendance-setup-code-controls').hidden, true);
  assert.equal(h.ids.get('attendance-install').hidden, false);
  assert.equal(h.ids.get('attendance-setup-code-button').hidden, false);
  h.ids.get('attendance-install').listeners.click();
  assert.equal(h.requests.length, 0);
  const panel = h.document.getElementById('attendance-install-panel');
  assert.match(panel.children.map(node => node.textContent).join(' '), /Share → Add to Home Screen → Add/);
  const steps = panel.children.find(node => node.tagName === 'OL');
  assert.equal(steps.children.at(-1).textContent, 'Open Lennox Test. Enter an administrator username and PIN, then tap Connect this iPad.');
  assert.equal(h.document.getElementById('attendance-install-code').hidden, true);
  assert.equal(h.document.getElementById('attendance-install-code-retry').hidden, true);
});

test('Safari issues and redeems a one-time fallback code without putting credentials in URLs', async () => {
  const safari = harness({html: pages[0], hash: '#' + stationToken});
  vm.runInContext(inline(pages[0], 'script'), safari.context);
  const button = safari.ids.get('attendance-setup-code-button');
  const pending = button.listeners.click();
  assert.equal(safari.context.location.hash, '');
  assert.equal(safari.requests.length, 1);
  assert.equal(safari.requests[0].url, '/attendance/install-code');
  assert.equal(JSON.parse(safari.requests[0].body).kioskToken, stationToken);
  safari.requests[0].respond(200, JSON.stringify({ok: true, code: '12345678', expiresAt: new Date(Date.now() + 600000).toISOString()}));
  await pending;
  assert.equal(safari.document.getElementById('attendance-install-code').textContent, '12345678');
  assert.equal(safari.document.getElementById('attendance-install-code').hidden, false);
  const panel = safari.document.getElementById('attendance-install-panel');
  assert.equal(panel.attributes.role, 'dialog');
  assert.match(panel.children.map(node => node.textContent).join(' '), /Use a setup code/);
  assert.doesNotMatch(panel.children.map(node => node.textContent).join(' '), new RegExp(stationToken));
  const steps = panel.children.find(node => node.tagName === 'OL');
  assert.deepEqual(steps.children.map(node => node.textContent), [
    'Read the 8-digit setup code below.',
    'Open the sign-in station in Safari and tap Use a setup code.',
    'Enter the code, then tap Connect station.'
  ]);

  const installed = harness({html: pages[0]});
  vm.runInContext(inline(pages[0], 'script'), installed.context);
  assert.equal(installed.ids.get('setup').hidden, false);
  assert.equal(installed.context.localStorage.getItem(stationKey), null);
  assert.equal(installed.context.sessionStorage.getItem(stationKey), null);
  assert.equal(installed.ids.get('attendance-setup-code-controls').hidden, true);
  installed.ids.get('attendance-use-code').listeners.click();
  assert.equal(installed.ids.get('attendance-setup-code-controls').hidden, false);
  installed.ids.get('attendance-setup-code').value = '12345678';
  const connect = installed.ids.get('attendance-connect').listeners.submit({preventDefault() {}});
  assert.equal(installed.requests[0].url, '/attendance/install-pair');
  assert.deepEqual(JSON.parse(installed.requests[0].body), {code: '12345678'});
  assert.equal(installed.ids.get('attendance-connect-button').disabled, true);
  installed.requests[0].respond(200, JSON.stringify({ok: true, kioskToken: stationToken}));
  await connect;
  assert.equal(installed.ids.get('setup').hidden, true);
  assert.equal(installed.ids.get('station').hidden, false);
  assert.equal(installed.context.localStorage.getItem(stationKey), stationToken);
  assert.equal(installed.context.sessionStorage.getItem(stationKey), stationToken);
  assert.equal(installed.ids.get('attendance-setup-code').value, '');
  assert.equal(installed.ids.get('attendance-connect-button').disabled, false);
  assert.equal(installed.context.location.hash, '');
  assert.equal(installed.ids.get('attendance-install').hidden, false);
  assert.equal(installed.ids.get('attendance-setup-code-button').hidden, false);
  installed.ids.get('name').value = 'Home Screen Visitor';
  const checkIn = installed.ids.get('check-in').listeners.submit({preventDefault() {}});
  assert.equal(JSON.parse(installed.requests[1].body).kioskToken, stationToken);
  installed.requests[1].respond(200, '{"ok":true,"entry":{"name":"Home Screen Visitor","signedInAt":"2026-11-05T00:00:00Z"}}');
  await checkIn;
  assert.equal(installed.ids.get('success-title').textContent, 'You’re signed in');
  for (const url of installed.context.history.urls.concat(safari.context.history.urls, installed.requests.map(request => request.url), safari.requests.map(request => request.url))) {
    assert.doesNotMatch(url, new RegExp(stationToken + '|12345678'));
  }

  safari.document.getElementById('attendance-install-close').listeners.click();
  assert.equal(safari.context.location.hash, '');
  assert.equal(safari.document.getElementById('attendance-install-panel'), null);
  assert.equal(safari.document.activeElement, button);
});

test('existing Home Screen icons can still restore a direct station fragment as a fallback', () => {
  const installed = harness({html: pages[0], hash: '#' + stationToken, standalone: true});
  vm.runInContext(inline(pages[0], 'script'), installed.context);
  assert.equal(installed.ids.get('setup').hidden, true);
  assert.equal(installed.context.localStorage.getItem(stationKey), stationToken);
  assert.equal(installed.context.location.hash, '');
  assert.equal(installed.ids.get('attendance-install').hidden, true);
});

test('setup code generation handles failures, expiry and a closed dialog without exposing stale codes', async () => {
  const failures = [
    {status: 400, body: '{"ok":false,"error":"Unable to create code"}', message: /Unable to create code/},
    {status: 429, body: '{"ok":false,"error":"Too many attempts"}', message: /Wait 10 minutes/},
    {status: 200, body: '<html>not json</html>', message: /unreadable response/},
    {status: 200, body: '{"ok":true,"code":"1234","expiresAt":"2099-01-01T00:00:00Z"}', message: /could not be created/},
    {status: 200, body: '{"ok":true,"code":"12345678","expiresAt":"2000-01-01T00:00:00Z"}', message: /could not be created/},
    {event: 'ontimeout', message: /timed out/},
    {event: 'onerror', message: /connection failed/}
  ];
  for (const failure of failures) {
    const h = harness({html: pages[0], hash: '#' + stationToken});
    vm.runInContext(inline(pages[0], 'script'), h.context);
    const pending = h.ids.get('attendance-setup-code-button').listeners.click();
    const retry = h.document.getElementById('attendance-install-code-retry');
    assert.equal(retry.disabled, true);
    if (failure.event) h.requests[0][failure.event]();
    else h.requests[0].respond(failure.status, failure.body);
    await pending;
    assert.equal(retry.disabled, false);
    assert.equal(h.document.getElementById('attendance-install-code').hidden, true);
    assert.match(h.document.getElementById('attendance-install-code-status').textContent, failure.message);
    const retried = retry.listeners.click();
    h.requests[1].respond(200, JSON.stringify({ok: true, code: '87654321', expiresAt: new Date(Date.now() + 600000).toISOString()}));
    await retried;
    assert.equal(h.document.getElementById('attendance-install-code').textContent, '87654321');
    const expiry = h.timers.find(timer => timer.delay > 500000 && !timer.cleared);
    assert.ok(expiry);
    expiry.callback();
    assert.equal(h.document.getElementById('attendance-install-code').hidden, true);
    assert.equal(h.document.getElementById('attendance-install-code').textContent, '');
    assert.match(h.document.getElementById('attendance-install-code-status').textContent, /has expired/);
  }
  const closed = harness({html: pages[0], hash: '#' + stationToken});
  vm.runInContext(inline(pages[0], 'script'), closed.context);
  const pending = closed.ids.get('attendance-setup-code-button').listeners.click();
  closed.document.getElementById('attendance-install-close').listeners.click();
  closed.requests[0].respond(200, JSON.stringify({ok: true, code: '87654321', expiresAt: new Date(Date.now() + 600000).toISOString()}));
  await pending;
  assert.equal(closed.document.getElementById('attendance-install-panel'), null);
  assert.equal(closed.document.getElementById('attendance-install-code'), null);
  assert.equal(closed.context.location.hash, '');
});

test('Safari fallback validates codes locally and lets network, expired or malformed responses be retried in place', async () => {
  const h = harness({html: pages[0]});
  vm.runInContext(inline(pages[0], 'script'), h.context);
  const form = h.ids.get('attendance-connect');
  for (const value of ['', '1234', 'abcdefgh', '123456789', '1234 5678']) {
    h.ids.get('attendance-setup-code').value = value;
    form.listeners.submit({preventDefault() {}});
    assert.equal(h.requests.length, 0);
    assert.match(h.ids.get('attendance-connect-status').textContent, /8-digit setup code/);
  }
  const failures = [
    {status: 401, body: '{"ok":false,"error":"Invalid code"}', message: /invalid, expired or already used/},
    {status: 429, body: '{"ok":false,"error":"Too many attempts"}', message: /Wait 10 minutes/},
    {status: 200, body: '{"ok":true,"kioskToken":"not-a-token"}', message: /Get a new code in Safari/},
    {status: 200, body: '{"kioskToken":"' + stationToken + '"}', message: /Unable to connect/},
    {status: 200, body: 'null', message: /Unable to connect/},
    {event: 'ontimeout', message: /timed out/},
    {event: 'onerror', message: /connection failed/}
  ];
  for (const failure of failures) {
    h.ids.get('attendance-setup-code').value = '12345678';
    const pending = form.listeners.submit({preventDefault() {}});
    const requestCount = h.requests.length;
    form.listeners.submit({preventDefault() {}});
    assert.equal(h.requests.length, requestCount);
    if (failure.event) h.requests.at(-1)[failure.event]();
    else h.requests.at(-1).respond(failure.status, failure.body);
    await pending;
    assert.equal(h.ids.get('setup').hidden, false);
    assert.equal(h.ids.get('station').hidden, true);
    assert.equal(h.ids.get('attendance-connect-button').disabled, false);
    assert.match(h.ids.get('attendance-connect-status').textContent, failure.message);
    assert.equal(h.context.localStorage.getItem(stationKey), null);
    assert.equal(h.context.location.hash, '');
  }
  h.ids.get('attendance-setup-code').value = '87654321';
  const connected = form.listeners.submit({preventDefault() {}});
  h.requests.at(-1).respond(200, JSON.stringify({ok: true, kioskToken: stationToken}));
  await connected;
  assert.equal(h.ids.get('setup').hidden, true);
  assert.equal(h.ids.get('station').hidden, false);
  assert.equal(h.context.localStorage.getItem(stationKey), stationToken);
  assert.equal(h.context.status, 'browser status');
});

test('code pairing still starts the current Safari session when storage is blocked', async () => {
  const denied = {getItem() { throw new Error('Denied'); }, setItem() { throw new Error('QuotaExceededError'); }, removeItem() { throw new Error('Denied'); }};
  const h = harness({html: pages[0], localStorage: denied, sessionStorage: denied});
  vm.runInContext(inline(pages[0], 'script'), h.context);
  h.ids.get('attendance-setup-code').value = '12345678';
  const connected = h.ids.get('attendance-connect').listeners.submit({preventDefault() {}});
  h.requests[0].respond(200, JSON.stringify({ok: true, kioskToken: stationToken}));
  await connected;
  assert.equal(h.ids.get('station').hidden, false);
  assert.equal(h.ids.get('setup').hidden, true);
  h.ids.get('mode-out').listeners.click();
  assert.equal(h.requests[1].url, '/attendance/lookup');
  assert.equal(JSON.parse(h.requests[1].body).kioskToken, stationToken);
  h.requests[1].respond(200, '{"ok":true,"entries":[]}');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.ids.get('roster-status').textContent, 'No one is currently signed in.');
});

test('installed apps prefer their saved pairing over an old launch fragment while Safari accepts a new link', () => {
  for (const standalone of [false, true]) {
    const h = harness({
      standalone, hash: '#' + otherStationToken,
      localStorage: memoryStorage({[stationKey]: stationToken}),
      sessionStorage: memoryStorage({[stationKey]: 'c3'.repeat(32)})
    });
    h.load();
    const expected = standalone ? stationToken : otherStationToken;
    assert.equal(h.context.attendanceLegacyRestoreStation(), expected);
    assert.equal(h.context.localStorage.getItem(stationKey), expected);
    assert.equal(h.context.sessionStorage.getItem(stationKey), expected);
    assert.equal(h.context.location.hash, '');
  }
});

test('invalid credentials and denied or full storage never prevent kiosk startup', () => {
  for (const value of ['demo-station', stationToken.toUpperCase(), ' ' + stationToken, stationToken.slice(1), stationToken + 'a', '#'+stationToken]) {
    const h = harness({html: pages[0], hash: '#' + value, localStorage: memoryStorage({[stationKey]: value}), sessionStorage: memoryStorage({[stationKey]: value})});
    vm.runInContext(inline(pages[0], 'script'), h.context);
    assert.equal(h.ids.get('attendance-test-startup').hidden, true);
    assert.equal(h.ids.get('setup').hidden, false);
    assert.equal(h.ids.get('station').hidden, true);
    assert.equal(h.ids.get('attendance-install').hidden, true);
    assert.equal(h.context.localStorage.getItem(stationKey), null);
    assert.equal(h.context.sessionStorage.getItem(stationKey), null);
    assert.equal(h.context.location.hash, '');
  }
  const denied = {getItem() { throw new Error('Denied'); }, setItem() { throw new Error('QuotaExceededError'); }, removeItem() { throw new Error('Denied'); }};
  const blocked = harness({html: pages[0], hash: '#' + stationToken, localStorage: denied, sessionStorage: denied});
  vm.runInContext(inline(pages[0], 'script'), blocked.context);
  assert.equal(blocked.ids.get('attendance-test-startup').hidden, true);
  assert.equal(blocked.ids.get('setup').hidden, true);
  blocked.ids.get('attendance-install').listeners.click();
  assert.equal(blocked.context.location.hash, '');

  const getterDenied = harness({hash: '#' + stationToken});
  Object.defineProperty(getterDenied.context, 'localStorage', {get() { throw new Error('SecurityError'); }});
  getterDenied.load();
  assert.equal(getterDenied.context.attendanceLegacyRestoreStation(), stationToken);
  assert.equal(getterDenied.context.sessionStorage.getItem(stationKey), stationToken);
});

test('only public kiosk 401 responses clear station credentials, leaving admin session state separate', async () => {
  for (const path of ['/attendance/check-in', '/attendance/lookup', '/attendance/check-out', '/attendance/install-code', '/attendance/check-in?retry=1']) {
    const h = harness({hash: '#' + stationToken});
    h.load();
    h.context.attendanceLegacyRestoreStation();
    h.context.sessionStorage.setItem('panelstock-attendance-admin', 'admin-session');
    const pending = h.context.attendanceLegacyRequest(path);
    h.requests[0].respond(401, '{"ok":false,"error":"Station access has expired"}');
    assert.equal((await pending).status, 401);
    assert.equal(h.context.localStorage.getItem(stationKey), null);
    assert.equal(h.context.sessionStorage.getItem(stationKey), null);
    assert.equal(h.context.sessionStorage.getItem('panelstock-attendance-admin'), 'admin-session');
  }
  for (const path of ['/session', '/attendance', '/attendance/kiosk', '/attendance/kiosk/revoke', '/attendance/check-in/admin', '/attendance/install-pair']) {
    const h = harness({hash: '#' + stationToken});
    h.load();
    h.context.attendanceLegacyRestoreStation();
    const pending = h.context.attendanceLegacyRequest(path);
    h.requests[0].respond(401, '{"ok":false,"error":"Invalid administrator session"}');
    await pending;
    assert.equal(h.context.localStorage.getItem(stationKey), stationToken);
    assert.equal(h.context.sessionStorage.getItem(stationKey), stationToken);
  }
});

test('revocation removes displayed people and discards a roster response already in flight', async () => {
  const h = harness({html: pages[0], hash: '#' + stationToken});
  vm.runInContext(inline(pages[0], 'script'), h.context);
  h.ids.get('mode-out').listeners.click();
  const roster = '{"ok":true,"entries":[{"id":"entry-1","type":"visitor","name":"Demo Visitor","signedInAt":"2026-11-05T00:00:00Z"}]}';
  h.requests[0].respond(200, roster);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.ids.get('matches').children.length, 1);
  const refresh = h.ids.get('refresh-out').listeners.click();
  const installation = h.ids.get('attendance-setup-code-button').listeners.click();
  h.requests[2].respond(200, JSON.stringify({ok: true, code: '12345678', expiresAt: new Date(Date.now() + 600000).toISOString()}));
  await installation;
  const expired = h.context.attendanceLegacyRequest('/attendance/check-out');
  h.requests[3].respond(401, '{"ok":false,"error":"Station access has expired"}');
  await expired;
  assert.equal(h.ids.get('matches').children.length, 0);
  assert.equal(h.ids.get('station').hidden, true);
  assert.equal(h.ids.get('setup').hidden, false);
  assert.equal(h.ids.get('attendance-install').hidden, true);
  assert.equal(h.document.getElementById('attendance-install-panel'), null);
  assert.equal(h.context.location.hash, '');
  assert.equal(h.context.localStorage.getItem(stationKey), null);
  h.requests[1].respond(200, roster);
  await refresh;
  assert.equal(h.ids.get('matches').children.length, 0);
  assert.equal(h.ids.get('roster-status').textContent, '');
  assert.equal(h.ids.get('station').hidden, true);
});

test('UUID fallback uses secure entropy with RFC 4122 version and variant bits', () => {
  const h = harness();
  h.load();
  const values = Array.from({length: 8}, () => h.context.crypto.randomUUID());
  for (const value of values) assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(new Set(values).size, values.length);
  assert.doesNotMatch(runtime, /Math\.random/);
  const insecure = harness({secure: false});
  insecure.load();
  assert.throws(() => insecure.context.crypto.randomUUID(), /Secure random numbers are unavailable/);
  const native = () => 'native-uuid', existing = harness({nativeUUID: native});
  existing.load();
  assert.equal(existing.context.crypto.randomUUID, native);
});

test('DOM fallbacks append nodes and text, replace contents, and remove nodes', () => {
  const h = harness();
  h.load();
  const parent = h.document.createElement('div'), child = h.document.createElement('strong');
  parent.append(child, 'name', 4);
  assert.equal(parent.children[0], child);
  assert.deepEqual(parent.children.slice(1).map(node => node.textContent), ['name', '4']);
  parent.replaceChildren('new', child);
  assert.equal(parent.children.length, 2);
  assert.equal(parent.children[0].textContent, 'new');
  assert.equal(parent.children[1], child);
  child.remove();
  assert.equal(child.parentNode, null);
  assert.equal(parent.children.length, 1);
  child.remove();
  parent.replaceChildren();
  assert.equal(parent.children.length, 0);
  const fragment = new h.DocumentFragment();
  fragment.append('fragment');
  assert.equal(fragment.firstChild.textContent, 'fragment');
});

test('XHR preserves auth headers, kiosk body, method, real timeout and HTTP status', async () => {
  const h = harness();
  h.load();
  const headers = Object.assign(Object.create({Ignored: 'inherited'}), {'Content-Type': 'application/json', Authorization: 'Bearer demo-session'});
  const body = JSON.stringify({kioskToken: 'demo-station', requestId: 'stable-retry-id'});
  const pending = h.context.attendanceLegacyRequest('/attendance/check-in', {method: 'POST', headers, body, timeout: 25000});
  const request = h.requests[0];
  assert.equal(request.url, '/attendance/check-in');
  assert.equal(request.method, 'POST');
  assert.equal(request.asynchronous, true);
  assert.equal(request.timeout, 25000);
  assert.deepEqual(request.headers, {'Content-Type': 'application/json', Authorization: 'Bearer demo-session'});
  assert.equal(request.body, body);
  request.respond(401, '{"ok":false,"error":"expired"}');
  const response = await pending;
  assert.equal(response.status, 401);
  assert.equal(response.ok, false);
  assert.equal((await response.json()).error, 'expired');
  assert.equal(request.onload, null);
  const second = h.context.attendanceLegacyRequest('/session');
  assert.equal(h.requests[1].method, 'GET');
  assert.equal(h.requests[1].body, null);
  assert.equal(h.requests[1].timeout, 20000);
  h.requests[1].respond(200, '{"ok":true}');
  assert.equal((await second).ok, true);
});

test('XHR timeout, network, abort, status zero and invalid JSON produce actionable errors', async () => {
  const h = harness();
  h.load();
  for (const [event, pattern] of [['ontimeout', /timed out/], ['onerror', /connection failed/], ['onabort', /cancelled/]]) {
    const pending = h.context.attendanceLegacyRequest('/attendance/lookup', {timeout: 20000});
    const request = h.requests.at(-1);
    request[event]();
    await assert.rejects(pending, error => pattern.test(error.message) && (event !== 'ontimeout' || error.name === 'TimeoutError'));
    assert.equal(request[event], null);
  }
  const zero = h.context.attendanceLegacyRequest('/session');
  h.requests.at(-1).respond(0, '');
  await assert.rejects(zero, /connection failed/);
  const invalid = h.context.attendanceLegacyRequest('/session');
  h.requests.at(-1).respond(200, '<html>not json</html>');
  await assert.rejects((await invalid).json(), /unreadable response/);
});

test('generated clients retain stable kiosk retries and display errors without colliding with window.status', async () => {
  const kiosk = harness({html: pages[0]});
  kiosk.context.location.hash = '#' + stationToken;
  vm.runInContext(inline(pages[0], 'script'), kiosk.context);
  kiosk.ids.get('name').value = 'Made Up Visitor';
  const first = kiosk.ids.get('check-in').listeners.submit({preventDefault() {}});
  assert.equal(kiosk.requests[0].timeout, 20000);
  assert.equal(JSON.parse(kiosk.requests[0].body).kioskToken, stationToken);
  kiosk.requests[0].ontimeout();
  await first;
  assert.match(kiosk.ids.get('status').textContent, /connection timed out/);
  assert.equal(kiosk.context.status, 'browser status');
  const retry = kiosk.ids.get('check-in').listeners.submit({preventDefault() {}});
  assert.equal(kiosk.requests[1].body, kiosk.requests[0].body);
  kiosk.requests[1].respond(200, '{"ok":true,"duplicate":true,"entry":{"name":"Made Up Visitor","signedInAt":"2026-11-05T00:00:00Z"}}');
  await retry;
  assert.equal(kiosk.ids.get('success-title').textContent, 'You’re already signed in');

  const admin = harness({html: pages[1]});
  vm.runInContext(inline(pages[1], 'script'), admin.context);
  admin.ids.get('username').value = 'ipadtest';
  admin.ids.get('pin').value = 'wrong-pin';
  admin.ids.get('login').listeners.submit({preventDefault() {}});
  assert.equal(admin.requests[0].timeout, 25000);
  admin.requests[0].respond(401, '{"ok":false,"error":"Invalid username or PIN"}');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(admin.ids.get('status').textContent, 'Invalid username or PIN');
  assert.equal(admin.context.status, 'browser status');
  assert.equal(admin.ids.get('login-panel').hidden, false);
  assert.equal(admin.ids.get('admin').hidden, true);
  assert.equal(admin.context.token, undefined);
  assert.equal(admin.context.api, undefined);
});

test('CSV preview reads text without downloads, renders safely, closes and restores focus', async () => {
  const h = harness();
  h.load();
  const button = h.document.createElement('button');
  button.focus();
  const blob = {}, text = '\uFEFF"Name"\r\n"<img src=x onerror=alert(1)>"';
  const pending = h.context.attendanceLegacyPreviewCsv(blob, 'demo.csv');
  assert.equal(h.readers[0].blob, blob);
  h.readers[0].complete(text);
  await pending;
  const panel = h.document.body.firstChild;
  const textarea = panel.children.find(node => node.tagName === 'TEXTAREA');
  const close = panel.children.find(node => node.tagName === 'BUTTON');
  assert.equal(textarea.value, text);
  assert.equal(textarea.readOnly, true);
  assert.equal(textarea.selected, true);
  assert.equal(h.document.activeElement, textarea);
  assert.equal(panel.attributes.role, 'dialog');
  close.listeners.click();
  assert.equal(h.document.body.children.length, 0);
  assert.equal(h.document.activeElement, button);
  const failed = h.context.attendanceLegacyPreviewCsv({}, 'demo.csv');
  h.readers[1].onerror();
  await assert.rejects(failed, /Unable to open the CSV preview/);
});
