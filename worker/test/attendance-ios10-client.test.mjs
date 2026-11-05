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

function harness({nativeUUID, secure = true, html} = {}) {
  const requests = [], readers = [], ids = new Map();
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
      if (!ids.has(id)) throw new Error('Missing HTML element: ' + id);
      return ids.get(id);
    }
    addEventListener() {}
  }
  class DocumentFragment extends Element {}
  document = new Document();
  document.body = new Element('body');
  document.activeElement = document.body;
  if (html) {
    for (const [, id] of html.matchAll(/\bid="([^"]+)"/g)) {
      const node = new Element();
      node.id = id;
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
    location: {hash: '', pathname: '/sign-in/', origin: 'https://attendance-test.example'},
    sessionStorage: {getItem: () => null, setItem() {}, removeItem() {}},
    history: {replaceState() {}}, navigator: {},
    setInterval() {}, clearInterval() {}, setTimeout() {}, clearTimeout() {},
    confirm: () => true
  };
  let nativeStatus = 'browser status';
  Object.defineProperty(context, 'status', {
    get: () => nativeStatus,
    set: value => { nativeStatus = String(value); }
  });
  context.window = context;
  vm.createContext(context);
  return {context, requests, readers, ids, document, Element, Document, DocumentFragment, load() { vm.runInContext(runtime, context); }};
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
    for (const manage of [false, true]) {
      const modern = buildAttendancePage('modern-test', manage);
      assert.match(modern, /nonce="modern-test"/);
      assert.match(modern, /fetch\(API_BASE\+path/);
      assert.doesNotMatch(modern, /attendance-test-banner|compatibility test/);
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
  kiosk.context.location.hash = '#demo-station';
  vm.runInContext(inline(pages[0], 'script'), kiosk.context);
  kiosk.ids.get('name').value = 'Made Up Visitor';
  const first = kiosk.ids.get('check-in').listeners.submit({preventDefault() {}});
  assert.equal(kiosk.requests[0].timeout, 20000);
  assert.equal(JSON.parse(kiosk.requests[0].body).kioskToken, 'demo-station');
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
