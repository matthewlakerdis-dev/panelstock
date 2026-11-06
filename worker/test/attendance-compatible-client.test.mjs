import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';
import {parse} from 'acorn';
import {compatibleAttendancePage, writeCompatibleAttendancePages, writeWorkerAttendanceModule} from '../scripts/build-attendance-compatible.mjs';
import {buildAttendancePage} from '../src/attendance-page.js';

const runtime = readFileSync(new URL('../compat/attendance-runtime.js', import.meta.url), 'utf8');
const inline = (html, tag) => html.match(new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>'))[1];
const pageResults = [false, true].map(manage => compatibleAttendancePage(manage));
const pages = pageResults.map(page => page.html);
const apiOrigin = 'https://panelstock-reports.matthewlakerdis.workers.dev';
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

function harness({nativeUUID, secure = true, html, hash = '', standalone = false, localStorage = memoryStorage(), sessionStorage = memoryStorage(), apiOrigin = ''} = {}) {
  const requests = [], readers = [], timers = [], intervals = [], ids = new Map(), roleButtons = [], formInputs = [];
  let now = Date.now();
  class HarnessDate extends Date { static now() { return now; } }
  function nodeList(nodes) {
    const list = {length: nodes.length};
    nodes.forEach((node, index) => { list[index] = node; });
    return list;
  }
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
      this.required = false;
      this.checked = false;
      this.type = 'text';
      this.name = '';
      this.defaultValue = '';
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
    reset() { if (this.id === 'check-in') formInputs.forEach(input => { input.value = input.defaultValue; input.checked = false; }); }
    checkValidity() {
      if (this.id !== 'check-in') return true;
      return formInputs.every(input => !input.required || input.disabled || (input.type === 'checkbox' ? input.checked : input.type === 'radio' ? formInputs.some(other => other.name === input.name && other.checked && !other.disabled) : Boolean(input.value.trim())));
    }
    reportValidity() { this.validityReported = true; return this.checkValidity(); }
    contains(node) { return this === node || this.children.some(child => child.contains?.(node)); }
    querySelectorAll(selector) { return nodeList(this.id === 'check-in' && selector === 'input' ? formInputs : []); }
  }
  class Document {
    createElement(tag) { return new Element(tag); }
    createTextNode(value) { return {nodeType: 3, textContent: value, ownerDocument: this}; }
    querySelectorAll(selector) {
      if (selector === '[data-role]') return nodeList(roleButtons);
      if (selector === '#station input') return nodeList(formInputs);
      if (selector === '#station button') return nodeList(roleButtons.concat(['mode-in', 'mode-out', 'refresh-out', 'next-person', 'submit-in'].map(id => ids.get(id)).filter(Boolean)));
      return nodeList([]);
    }
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
      const tag = html.slice(html.lastIndexOf('<', match.index), html.indexOf('>', match.index) + 1);
      const node = new Element(tag.match(/^<([\w-]+)/)[1]);
      node.id = id;
      node.hidden = /\shidden(?:\s|>|=)/.test(tag);
      node.required = /\srequired(?:\s|>|=)/.test(tag);
      node.disabled = /\sdisabled(?:\s|>|=)/.test(tag);
      node.type = tag.match(/\btype="([^"]+)"/)?.[1] || 'text';
      node.name = tag.match(/\bname="([^"]+)"/)?.[1] || '';
      node.defaultValue = tag.match(/\bvalue="([^"]*)"/)?.[1] || '';
      node.value = node.defaultValue;
      node.checked = /\schecked(?:\s|>|=)/.test(tag);
      ids.set(id, node);
    }
    for (const match of html.matchAll(/<button\b[^>]*\bdata-role="([^"]+)"[^>]*>/g)) {
      const button = new Element('button');
      button.dataset.role = match[1];
      roleButtons.push(button);
    }
    const checkIn = html.match(/<form id="check-in"[\s\S]*?<\/form>/)?.[0] || '';
    for (const match of checkIn.matchAll(/<input\b[^>]*\bid="([^"]+)"/g)) formInputs.push(ids.get(match[1]));
    ids.get('attendance-startup').hidden = false;
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
    Uint8Array, Promise, console, Date: HarnessDate, Blob,
    URL: {createObjectURL: () => 'blob:attendance-test', revokeObjectURL() {}},
    location: {hash, pathname: '/sign-in/', origin: 'https://web.panelstockhq.com'},
    attendanceApiOrigin: apiOrigin,
    localStorage, sessionStorage,
    history: {urls: [], replaceState(_state, _title, url) {
      this.urls.push(url);
      context.location.hash = url.includes('#') ? url.slice(url.indexOf('#')) : '';
    }}, navigator: {standalone},
    setInterval(callback, delay) { const timer = {callback, delay}; intervals.push(timer); return timer; }, clearInterval() {},
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
  return {context, requests, readers, timers, intervals, advanceTime(milliseconds) { now += milliseconds; for (const interval of intervals) interval.callback(); }, ids, roleButtons, formInputs, document, Element, Document, DocumentFragment, load() { vm.runInContext(runtime, context); }};
}


const commonSafetyFields = [
  ['emergencyProcedureUnderstood', 'emergency-procedure-understood'],
  ['siteAccessUnderstood', 'site-access-understood'],
  ['hazardReportingUnderstood', 'hazard-reporting-understood']
];
const contractorSafetyFields = [
  ['undertakingWork', 'undertaking-work'],
  ['siteInductionCompleted', 'site-induction-completed'],
  ['workRisksDiscussed', 'work-risks-discussed']
];
const safetyFields = ['visitorSafetyAcknowledged', 'workshopAccess', 'ppeConfirmed', ...commonSafetyFields.map(([field]) => field), ...contractorSafetyFields.map(([field]) => field)];
const safetyIds = ['visitor-safety-acknowledged', 'workshop-access-yes', 'workshop-access-no', 'ppe-confirmed-yes', 'ppe-confirmed-no', ...[...commonSafetyFields, ...contractorSafetyFields].flatMap(([, prefix]) => [prefix + '-yes', prefix + '-no'])];
function startSignIn(h, role = 'visitor') {
  h.ids.get('mode-in').listeners.click();
  h.roleButtons.find(button => button.dataset.role === role).listeners.click();
}
function fillDetails(h, name = 'Example Visitor') {
  for (const [id, value] of Object.entries({name, company: 'Example Company', host: 'Site Host'})) h.ids.get(id).value = value;
}
function choose(h, id) {
  const input = h.ids.get(id);
  if (input.type === 'radio') h.formInputs.filter(other => other.name === input.name).forEach(other => { other.checked = false; });
  input.checked = true;
  input.listeners.change?.({target: input});
  h.ids.get('check-in').listeners.change?.({target: input});
  h.ids.get('check-in').listeners.input?.({target: input});
}
function answerFollowupSafety(h, {common = [true, true, true], undertakingWork = false, induction = true, risks = true} = {}) {
  for (const [index, [, prefix]] of commonSafetyFields.entries()) choose(h, prefix + (common[index] ? '-yes' : '-no'));
  if (h.roleButtons.find(button => button.dataset.role === 'contractor').attributes['aria-pressed'] === 'true') {
    choose(h, undertakingWork ? 'undertaking-work-yes' : 'undertaking-work-no');
    if (undertakingWork) {
      choose(h, induction ? 'site-induction-completed-yes' : 'site-induction-completed-no');
      choose(h, risks ? 'work-risks-discussed-yes' : 'work-risks-discussed-no');
    }
  }
}
function answerSafety(h, workshop = false, ppe = null) {
  choose(h, 'visitor-safety-acknowledged');
  choose(h, workshop ? 'workshop-access-yes' : 'workshop-access-no');
  if (workshop && ppe !== null) choose(h, ppe ? 'ppe-confirmed-yes' : 'ppe-confirmed-no');
  answerFollowupSafety(h);
}
function assertSafetyCleared(h) {
  for (const id of safetyIds) assert.equal(h.ids.get(id).checked, false, id + ' must be cleared');
  assert.equal(h.ids.get('ppe-field').hidden, true);
  assert.equal(h.ids.get('visitor-workshop-warning').hidden, true);
  assert.equal(h.ids.get('contractor-work-questions').hidden, true);
}
function textContent(node) {
  return node.textContent + node.children.map(textContent).join(' ');
}

test('production pages contain ES5 scripts, exact CSP hashes and no testing or setup-code features', () => {
  for (const [index, html] of pages.entries()) {
    const script = inline(html, 'script'), style = inline(html, 'style');
    parse('"use strict";\n' + script, {ecmaVersion: 5, sourceType: 'script'});
    for (const source of [script, style]) {
      const hash = createHash('sha256').update(source).digest('base64');
      assert.ok(html.includes("'sha256-" + hash + "'"));
      assert.ok(pageResults[index].policy.includes("'sha256-" + hash + "'"));
    }
    assert.match(pageResults[index].policy, /connect-src 'self'/);
    assert.match(pageResults[index].policy, /img-src 'self' data:/);
    assert.doesNotMatch(html, /nonce=|unsafe-inline|<script[^>]+src=/);
    assert.match(script, /var API_BASE=""/);
    assert.doesNotMatch(script, /\bfetch\s*\(|AbortSignal|\.replaceAll\(/);
    assert.doesNotMatch(html, /attendance-test|Demo data|Demo administrator|Test administrator|ipadtest|103434|Lennox Test|compatibility test|setup-code|install-code|install-pair/);
    assert.match(html, /id="attendance-startup"[^>]*>Loading sign-in station/);
    assert.match(html, /alt="Lennox Facades"/);
    assert.doesNotMatch(html, /Welcome to PanelStock/);
  }
  assert.match(pages[0], /People currently signed in/);
  assert.match(inline(pages[0], 'script'), /touchstart/);
  assert.match(pages[0], /<meta name="apple-mobile-web-app-capable" content="yes">/);
  assert.match(pages[0], /<meta name="apple-mobile-web-app-title" content="Lennox Sign In">/);
  assert.match(pages[0], /<meta name="apple-mobile-web-app-status-bar-style" content="default">/);
  assert.match(pages[0], /<link rel="apple-touch-icon" href="\/sign-in\/apple-touch-icon.png">/);
  assert.match(pages[0], /id="attendance-admin-pin" type="password" inputmode="numeric" pattern="\[0-9\]\*"/);
  assert.match(pages[0], /Connecting replaces the current station link\. Other paired screens will need a new link\./);
  assert.match(pages[0], /id="attendance-admin-connect-button"[^>]*aria-describedby="attendance-admin-connect-notice"[^>]*>Connect this iPad/);
  assert.doesNotMatch(pages[1], /name="apple-mobile-web-app-capable"|rel="apple-touch-icon"|id="attendance-install"/);
  assert.match(pages[1], /id="export"[^>]*>View CSV/);
  assert.match(inline(pages[1], 'script'), /attendanceLegacyPreviewCsv\(blob,link\.download\)/);
  assert.doesNotMatch(inline(pages[1], 'script'), /link\.click\(/);
});

test('same-origin and web-hosted assets generate deterministically with the unchanged Lennox icon', () => {
  const directory = mkdtempSync(join(tmpdir(), 'attendance-compatible-'));
  try {
    for (const origin of ['', apiOrigin]) {
      writeCompatibleAttendancePages(directory, origin);
      for (const [index, file] of ['index.html', 'manage/index.html'].entries()) {
        const result = compatibleAttendancePage(Boolean(index), origin);
        assert.equal(readFileSync(join(directory, file), 'utf8'), result.html);
        assert.deepEqual(compatibleAttendancePage(Boolean(index), origin), result);
        if (origin) assert.ok(result.policy.includes(origin));
      }
      assert.deepEqual(readFileSync(join(directory, 'apple-touch-icon.png')), readFileSync(new URL('../../icon-adaptive-v4-192.png', import.meta.url)));
    }
  } finally { rmSync(directory, {recursive: true, force: true}); }
});

test('Worker generation exports prebuilt page policies without build-time dependencies', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'attendance-worker-module-'));
  try {
    const file = join(directory, 'attendance-pages.mjs');
    writeWorkerAttendanceModule(file);
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /^import\s|node:fs|@babel\/core|@babel\/preset-env/m);
    const module = await import(pathToFileURL(file).href);
    assert.deepEqual(module.buildAttendancePage(), pageResults[0]);
    assert.deepEqual(module.buildAttendancePage(true), pageResults[1]);
  } finally { rmSync(directory, {recursive: true, force: true}); }
});

test('configured API origins reject credentials, markup, paths and insecure protocols', () => {
  for (const origin of [
    'http://example.test', 'javascript:alert(1)', 'https://user:password@example.test',
    'https://example.test/path', 'https://example.test/?query=value',
    'https://example.test/#fragment', 'https://example.test/</script><img src=x>'
  ]) assert.throws(() => compatibleAttendancePage(false, origin));
});

test('both complete bundles initialize with old noniterable NodeLists and no fetch or AbortSignal', () => {
  for (const html of pages) {
    const h = harness({html});
    vm.runInContext(inline(html, 'script'), h.context);
    assert.equal(h.ids.get('attendance-startup').hidden, true);
    assert.equal(h.requests.length, 0);
  }
});

test('production kiosk shows required name, company and host markers and omits the reason field', () => {
  assert.ok((pages[0].match(/class="attendance-required"/g) || []).length >= 4);
  assert.match(pages[0], /Full name <span class="attendance-required" aria-hidden="true">\*<\/span>/);
  assert.match(pages[0], /Company <span id="company-required" class="attendance-required" aria-hidden="true">\*<\/span>/);
  assert.match(pages[0], /Person you’re visiting <span class="attendance-required" aria-hidden="true">\*<\/span>/);
  assert.match(pages[0], /<span><span class="attendance-required" aria-hidden="true">\*<\/span> Required<\/span>/);
  assert.match(pages[0], /id="company" name="company" required/);
  assert.doesNotMatch(pages[0], /purpose|Reason for visit|company-optional/);
  assert.match(pages[0], /Phone or email <small>\(optional\)<\/small>/);
  const modern = buildAttendancePage('modern-test');
  assert.match(modern, /Reason for visit/);
  assert.match(modern, /company-optional/);
  assert.doesNotMatch(modern, /attendance-required/);
});

test('role changes retain employee contact and host, require company for other roles, and keep keyboard order usable', () => {
  const h = harness({html: pages[0], hash: '#' + stationToken});
  vm.runInContext(inline(pages[0], 'script'), h.context);
  h.ids.get('mode-in').listeners.click();
  assert.equal(h.roleButtons.length, 3);
  assert.deepEqual(h.formInputs.filter(input => !['checkbox', 'radio'].includes(input.type)).map(input => input.id), ['name', 'company', 'contact', 'host']);
  h.ids.get('company').value = 'Previous company';
  h.ids.get('contact').value = 'employee@example.test';
  h.ids.get('host').value = 'Site manager';
  for (const role of ['contractor', 'employee', 'visitor']) {
    if (h.ids.get('role-screen').hidden) h.ids.get('back-to-roles').listeners.click();
    h.roleButtons.find(button => button.dataset.role === role).listeners.click();
    const employee = role === 'employee';
    for (const button of h.roleButtons) assert.equal(button.attributes['aria-pressed'], String(button.dataset.role === role));
    assert.equal(h.ids.get('name').required, true);
    assert.equal(h.ids.get('company').required, !employee);
    assert.equal(h.ids.get('company').disabled, employee);
    assert.equal(h.ids.get('company-field').hidden, employee);
    assert.equal(h.ids.get('host').required, true);
    assert.equal(h.ids.get('contact').required, false);
    for (const id of ['contact', 'host']) {
      assert.equal(h.ids.get(id).disabled, false);
      assert.equal(h.ids.get(id + '-field').hidden, false);
    }
    assert.equal(h.ids.get('contact').value, 'employee@example.test');
    assert.equal(h.ids.get('host').value, 'Site manager');
    if (role !== 'contractor') assert.equal(h.ids.get('company').value, '');
    const activeInputs = h.formInputs.filter(input => !input.disabled && !['checkbox', 'radio'].includes(input.type));
    for (const [index, input] of activeInputs.entries()) assert.equal(input.enterKeyHint, index === activeInputs.length - 1 ? 'done' : 'next');
    let prevented = false;
    h.ids.get('check-in').listeners.keydown({key: 'Enter', target: h.ids.get('name'), preventDefault() { prevented = true; }});
    assert.equal(prevented, true);
    assert.equal(h.document.activeElement, h.ids.get(employee ? 'contact' : 'company'));
    prevented = false;
    h.ids.get('check-in').listeners.keydown({key: 'Enter', target: h.ids.get('host'), preventDefault() { prevented = true; }});
    assert.equal(prevented, false);
  }
});

test('every role submits contact and host without purpose, keeps retries stable and resets to a clean visitor form', async () => {
  for (const role of ['visitor', 'contractor', 'employee']) {
    const h = harness({html: pages[0], hash: '#' + stationToken});
    vm.runInContext(inline(pages[0], 'script'), h.context);
    startSignIn(h, role);
    for (const [id, value] of Object.entries({name: '  Example Person  ', company: '  Example Company  ', contact: '  person@example.test  ', host: '  Site Manager  '})) h.ids.get(id).value = value;
    const form = h.ids.get('check-in');
    if (role !== 'employee') answerSafety(h);
    const first = form.listeners.submit({preventDefault() {}});
    const data = JSON.parse(h.requests[0].body);
    assert.equal(data.kioskToken, stationToken);
    assert.equal(data.type, role);
    assert.equal(data.name, 'Example Person');
    assert.equal(data.company, role === 'employee' ? '' : 'Example Company');
    assert.equal(data.contact, 'person@example.test');
    assert.equal(data.host, 'Site Manager');
    assert.equal('purpose' in data, false);
    assert.equal(h.document.getElementById('purpose'), null);
    assert.match(data.requestId, /^[0-9a-f-]{36}$/);
    h.requests[0].ontimeout();
    await first;
    const retry = form.listeners.submit({preventDefault() {}});
    assert.equal(h.requests[1].body, h.requests[0].body);
    h.requests[1].respond(200, '{"ok":true,"entry":{"name":"Example Person","signedInAt":"2026-11-05T00:00:00Z"}}');
    await retry;
    assert.equal(h.ids.get('success-title').textContent, 'You’re signed in');
    for (const input of h.formInputs) { assert.equal(input.value, input.defaultValue); assert.equal(input.checked, false); }
    h.ids.get('next-person').listeners.click();
    assert.equal(h.ids.get('success').hidden, true);
    assert.equal(h.ids.get('in-screen').hidden, true);
    assert.equal(h.ids.get('role-screen').hidden, true);
    assert.equal(h.ids.get('action-screen').hidden, false);
    assert.equal(h.ids.get('out-screen').hidden, true);
    assert.equal(h.roleButtons.find(button => button.dataset.role === 'visitor').attributes['aria-pressed'], 'false');
    assert.equal(h.ids.get('company-field').hidden, false);
    assert.equal(h.ids.get('company').disabled, false);
    assert.equal(h.ids.get('company').required, true);
    assert.equal(h.ids.get('host').required, true);
    assert.equal(h.ids.get('host-field').hidden, false);
    assert.equal(h.ids.get('contact-field').hidden, false);
    for (const input of h.formInputs) { assert.equal(input.value, input.defaultValue); assert.equal(input.checked, false); }
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
  assert.equal(reopened.ids.get('attendance-startup').hidden, true);
  assert.equal(reopened.ids.get('setup').hidden, true);
  assert.equal(reopened.context.sessionStorage.getItem(stationKey), stationToken);
  assert.equal(reopened.ids.get('attendance-install').hidden, false);
});

test('fresh standalone administrator setup logs in, pairs and logs out in place, saving only the station credential', async () => {
  const h = harness({html: pages[0], standalone: true});
  vm.runInContext(inline(pages[0], 'script'), h.context);
  assert.equal(h.ids.get('setup').hidden, false);
  for (const id of ['attendance-install']) assert.equal(h.ids.get(id).hidden, true);
  h.ids.get('attendance-install').listeners.click();
  assert.equal(h.requests.length, 0);
  h.ids.get('attendance-admin-username').value = ' setup-admin ';
  h.ids.get('attendance-admin-pin').value = '783912';
  const pending = h.ids.get('attendance-admin-connect').listeners.submit({preventDefault() {}});
  assert.equal(h.ids.get('attendance-admin-pin').value, '');
  assert.equal(h.ids.get('attendance-admin-connect-button').disabled, true);
  h.ids.get('attendance-admin-connect').listeners.submit({preventDefault() {}});
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, '/login');
  assert.deepEqual(JSON.parse(h.requests[0].body), {username: 'setup-admin', pin: '783912'});
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
  for (const id of ['attendance-install']) assert.equal(h.ids.get(id).hidden, true);
  assert.equal(h.context.session, undefined);
  assert.equal(h.context.token, undefined);
  assert.equal(h.context.location.hash, '');
  startSignIn(h);
  fillDetails(h, 'Connected iPad Visitor');
  answerSafety(h);
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
  assert.equal(reopened.requests.length, 0);
  for (const url of h.requests.map(request => request.url).concat(h.context.history.urls)) assert.doesNotMatch(url, /temporary-admin-session|783912|setup-admin|a1a1a1a1/);
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
    h.ids.get('attendance-admin-username').value = 'setup-admin';
    h.ids.get('attendance-admin-pin').value = '783912';
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
    h.ids.get('attendance-admin-username').value = 'setup-admin';
    h.ids.get('attendance-admin-pin').value = '783912';
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
  h.ids.get('attendance-admin-username').value = 'setup-admin';
  h.ids.get('attendance-admin-pin').value = '783912';
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

test('Safari installation explains direct in-app setup without creating a temporary code or URL credential', () => {
  const h = harness({html: pages[0], hash: '#' + stationToken});
  vm.runInContext(inline(pages[0], 'script'), h.context);
  assert.equal(h.ids.get('attendance-install').hidden, false);
  h.ids.get('attendance-install').listeners.click();
  assert.equal(h.requests.length, 0);
  assert.equal(h.context.location.hash, '');
  const panel = h.document.getElementById('attendance-install-panel');
  assert.equal(panel.className, 'attendance-install-panel');
  assert.equal(panel.attributes.role, 'dialog');
  assert.match(panel.children.map(node => node.textContent).join(' '), /Share → Add to Home Screen → Add/);
  const steps = panel.children.find(node => node.tagName === 'OL');
  assert.match(steps.children.at(-1).textContent, /Open Lennox Sign In.*administrator username and PIN.*Connect this iPad/);
  h.document.getElementById('attendance-install-close').listeners.click();
  assert.equal(h.document.getElementById('attendance-install-panel'), null);
  assert.equal(h.document.activeElement, h.ids.get('attendance-install'));
});

test('web-hosted standalone setup sends login, pairing, logout and attendance to the configured API origin', async () => {
  const {html, policy} = compatibleAttendancePage(false, apiOrigin);
  assert.ok(policy.includes(apiOrigin));
  const h = harness({html, standalone: true});
  vm.runInContext(inline(html, 'script'), h.context);
  assert.equal(h.context.attendanceApiOrigin, apiOrigin);
  h.ids.get('attendance-admin-username').value = 'setup-admin';
  h.ids.get('attendance-admin-pin').value = '783912';
  const pending = h.ids.get('attendance-admin-connect').listeners.submit({preventDefault() {}});
  assert.equal(h.requests[0].url, apiOrigin + '/login');
  h.requests[0].respond(200, '{"ok":true,"isAdmin":true,"token":"temporary-web-session"}');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.requests[1].url, apiOrigin + '/attendance/kiosk');
  assert.equal(h.requests[1].headers.Authorization, 'Bearer temporary-web-session');
  h.requests[1].respond(200, JSON.stringify({ok: true, kioskToken: stationToken}));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.requests[2].url, apiOrigin + '/logout');
  h.requests[2].respond(200, '{"ok":true}');
  await pending;
  assert.equal(h.ids.get('station').hidden, false);
  assert.deepEqual([...h.context.localStorage.values], [[stationKey, stationToken]]);
  assert.deepEqual([...h.context.sessionStorage.values], [[stationKey, stationToken]]);
  h.ids.get('mode-out').listeners.click();
  assert.equal(h.requests[3].url, apiOrigin + '/attendance/lookup');
  assert.equal(JSON.parse(h.requests[3].body).kioskToken, stationToken);
  h.requests[3].respond(401, '{"ok":false,"error":"Station access has expired"}');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.context.localStorage.getItem(stationKey), null);
  assert.equal(h.context.sessionStorage.getItem(stationKey), null);
  assert.equal(h.ids.get('station').hidden, true);
  assert.equal(h.ids.get('setup').hidden, false);
});

test('existing Home Screen icons can still restore a direct station fragment as a fallback', () => {
  const installed = harness({html: pages[0], hash: '#' + stationToken, standalone: true});
  vm.runInContext(inline(pages[0], 'script'), installed.context);
  assert.equal(installed.ids.get('setup').hidden, true);
  assert.equal(installed.context.localStorage.getItem(stationKey), stationToken);
  assert.equal(installed.context.location.hash, '');
  assert.equal(installed.ids.get('attendance-install').hidden, true);
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
    assert.equal(h.ids.get('attendance-startup').hidden, true);
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
  assert.equal(blocked.ids.get('attendance-startup').hidden, true);
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
  for (const path of ['/attendance/check-in', '/attendance/lookup', '/attendance/check-out', '/attendance/check-in?retry=1']) {
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
  for (const path of ['/session', '/attendance', '/attendance/kiosk', '/attendance/kiosk/revoke', '/attendance/check-in/admin']) {
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

test('absolute 401 responses clear pairing only for the configured API or this page origin', async () => {
  const publicPath = '/attendance/check-in';
  const pageOrigin = 'https://web.panelstockhq.com';
  for (const origin of [apiOrigin, pageOrigin]) {
    const h = harness({hash: '#' + stationToken, apiOrigin});
    h.load();
    h.context.attendanceLegacyRestoreStation();
    const pending = h.context.attendanceLegacyRequest(origin + publicPath);
    h.requests[0].respond(401, '{"ok":false,"error":"Station access has expired"}');
    await pending;
    assert.equal(h.context.localStorage.getItem(stationKey), null);
    assert.equal(h.context.sessionStorage.getItem(stationKey), null);
  }
  for (const url of [
    apiOrigin + '/login', apiOrigin + '/attendance/kiosk',
    'https://other.example' + publicPath,
    apiOrigin + '.other.example' + publicPath,
    pageOrigin + '.other.example' + publicPath
  ]) {
    const h = harness({hash: '#' + stationToken, apiOrigin});
    h.load();
    h.context.attendanceLegacyRestoreStation();
    const pending = h.context.attendanceLegacyRequest(url);
    h.requests[0].respond(401, '{"ok":false,"error":"Authentication failed"}');
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
  h.ids.get('attendance-install').listeners.click();
  const expired = h.context.attendanceLegacyRequest('/attendance/check-out');
  h.requests[2].respond(401, '{"ok":false,"error":"Station access has expired"}');
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
  startSignIn(kiosk);
  fillDetails(kiosk, 'Made Up Visitor');
  answerSafety(kiosk);
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
  admin.ids.get('username').value = 'setup-admin';
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

test('visitor safety uses named checkbox and radio values with accessible instructions and conditional requirements', () => {
  const html = pages[0];
  assert.match(html, /I have read and understood the visitor safety instructions provided by my host\./);
  assert.match(html, /Ask your host for the instructions if you have not received them\./);
  assert.match(html, /Will you need access to the workshop\?/);
  assert.match(html, /Do you have the required PPE for the workshop\?/);
  assert.match(html, /Speak to your host before entering the workshop\./);
  const h = harness({html, hash: '#' + stationToken});
  vm.runInContext(inline(html, 'script'), h.context);
  startSignIn(h);
  assert.equal(h.ids.get('visitor-safety').hidden, false);
  assert.equal(h.ids.get('visitor-safety-acknowledged').type, 'checkbox');
  assert.equal(h.ids.get('visitor-safety-acknowledged').required, true);
  for (const [group, prefix] of [['workshopAccess', 'workshop-access'], ['ppeConfirmed', 'ppe-confirmed']]) {
    for (const value of ['yes', 'no']) {
      const input = h.ids.get(prefix + '-' + value);
      assert.equal(input.type, 'radio');
      assert.equal(input.name, group);
      assert.equal(input.value, value);
      assert.equal(input.required, group === 'workshopAccess');
      assert.equal(input.disabled, group === 'ppeConfirmed');
      assert.equal(input.checked, false);
    }
  }
  choose(h, 'workshop-access-yes');
  assert.equal(h.ids.get('ppe-field').hidden, false);
  for (const id of ['ppe-confirmed-yes', 'ppe-confirmed-no']) {
    assert.equal(h.ids.get(id).required, true);
    assert.equal(h.ids.get(id).disabled, false);
  }
  choose(h, 'ppe-confirmed-no');
  assert.equal(h.ids.get('visitor-workshop-warning').hidden, false);
  choose(h, 'ppe-confirmed-yes');
  assert.equal(h.ids.get('visitor-workshop-warning').hidden, true);
  choose(h, 'workshop-access-no');
  assert.equal(h.ids.get('ppe-field').hidden, true);
  for (const id of ['ppe-confirmed-yes', 'ppe-confirmed-no']) {
    assert.equal(h.ids.get(id).required, false);
    assert.equal(h.ids.get(id).disabled, true);
    assert.equal(h.ids.get(id).checked, false);
  }
  choose(h, 'workshop-access-yes');
  assert.equal(h.ids.get('ppe-confirmed-yes').checked, false);
  assert.equal(h.ids.get('ppe-confirmed-no').checked, false);
});

test('incomplete visitor and contractor answers block requests while PPE No permits attendance and preserves timeout retries', async () => {
  for (const role of ['visitor', 'contractor']) for (const answers of [{workshop: false, ppe: null}, {workshop: true, ppe: true}, {workshop: true, ppe: false}]) {
    const h = harness({html: pages[0], hash: '#' + stationToken});
    vm.runInContext(inline(pages[0], 'script'), h.context);
    startSignIn(h, role);
    fillDetails(h);
    const form = h.ids.get('check-in');
    await form.listeners.submit({preventDefault() {}});
    assert.equal(h.requests.length, 0);
    assert.match(h.ids.get('status').textContent, new RegExp(role + ' safety'));
    choose(h, 'visitor-safety-acknowledged');
    await form.listeners.submit({preventDefault() {}});
    assert.equal(h.requests.length, 0);
    choose(h, answers.workshop ? 'workshop-access-yes' : 'workshop-access-no');
    if (answers.workshop) {
      await form.listeners.submit({preventDefault() {}});
      assert.equal(h.requests.length, 0);
      choose(h, answers.ppe ? 'ppe-confirmed-yes' : 'ppe-confirmed-no');
    }
    answerFollowupSafety(h);
    const pending = form.listeners.submit({preventDefault() {}});
    assert.equal(h.requests.length, 1);
    const payload = JSON.parse(h.requests[0].body);
    assert.equal(payload.type, role);
    assert.equal(payload.visitorSafetyAcknowledged, true);
    assert.equal(payload.workshopAccess, answers.workshop);
    assert.equal(payload.ppeConfirmed, answers.ppe);
    assert.equal(h.ids.get('visitor-workshop-warning').hidden, !(answers.workshop && answers.ppe === false));
    h.requests[0].ontimeout();
    await pending;
    assert.equal(h.ids.get('visitor-safety-acknowledged').checked, true);
    assert.equal(h.ids.get(answers.workshop ? 'workshop-access-yes' : 'workshop-access-no').checked, true);
    const retry = form.listeners.submit({preventDefault() {}});
    assert.equal(h.requests[1].body, h.requests[0].body);
    h.requests[1].respond(200, JSON.stringify({ok: true, entry: {name: 'Example Visitor', signedInAt: '2026-11-05T00:00:00Z'}}));
    await retry;
    assert.equal(h.ids.get('success-title').textContent, 'You’re signed in');
    assert.equal(h.ids.get('success-workshop-warning').hidden, !(answers.workshop && answers.ppe === false));
    if (answers.workshop && answers.ppe === false) assert.equal(h.ids.get('success-workshop-warning').textContent, role === 'contractor' ? 'Speak to your Lennox Facades contact before entering the work area or starting work.' : 'Speak to your host before entering the workshop.');
    assertSafetyCleared(h);
    h.ids.get('next-person').listeners.click();
    assertSafetyCleared(h);
    assert.equal(h.ids.get('success-workshop-warning').hidden, true);
    assert.equal(h.ids.get('visitor-safety').hidden, false);
  }
});

test('employee role hides, disables and clears safety answers and omits all safety metadata', async () => {
  const h = harness({html: pages[0], hash: '#' + stationToken});
  vm.runInContext(inline(pages[0], 'script'), h.context);
  const role = 'employee';
  startSignIn(h);
  answerSafety(h, true, false);
  h.ids.get('back-to-roles').listeners.click();
  h.roleButtons.find(button => button.dataset.role === role).listeners.click();
  assert.equal(h.ids.get('visitor-safety').hidden, true);
  assertSafetyCleared(h);
  for (const id of safetyIds) {
    assert.equal(h.ids.get(id).disabled, true);
    assert.equal(h.ids.get(id).required, false);
  }
  fillDetails(h);
  const pending = h.ids.get('check-in').listeners.submit({preventDefault() {}});
  const request = h.requests.at(-1), payload = JSON.parse(request.body);
  for (const field of safetyFields) assert.equal(field in payload, false);
  request.respond(200, JSON.stringify({ok: true, entry: {name: 'Example Visitor', signedInAt: '2026-11-05T00:00:00Z'}}));
  await pending;
  h.ids.get('next-person').listeners.click();
  assertSafetyCleared(h);
  assert.equal(h.ids.get('success-workshop-warning').hidden, true);
  assert.equal(h.ids.get('visitor-safety').hidden, false);
});


test('visitor and contractor answers clear on Back, mode changes, idle reset and revoked station pairing', async () => {
  for (const role of ['visitor', 'contractor']) {
    const h = harness({html: pages[0], hash: '#' + stationToken});
    vm.runInContext(inline(pages[0], 'script'), h.context);
    startSignIn(h, role);
    fillDetails(h);
    answerSafety(h, true, false);
    h.ids.get('back-to-roles').listeners.click();
    assertSafetyCleared(h);
    h.ids.get('back-to-actions-role').listeners.click();
    h.ids.get('mode-out').listeners.click();
    assertSafetyCleared(h);
    h.requests[0].respond(200, '{"ok":true,"entries":[]}');
    await new Promise(resolve => setImmediate(resolve));
    h.ids.get('back-to-actions-out').listeners.click();
    startSignIn(h, role);
    answerSafety(h, true, false);
    h.advanceTime(120001);
    assertSafetyCleared(h);
    assert.equal(h.ids.get('name').value, '');
    assert.equal(h.ids.get('action-screen').hidden, false);
    startSignIn(h, role);
    answerSafety(h, true, false);
    const revoked = h.context.attendanceLegacyRequest('/attendance/check-out');
    h.requests.at(-1).respond(401, '{"ok":false,"error":"Station access has expired"}');
    await revoked;
    assertSafetyCleared(h);
    assert.equal(h.ids.get('station').hidden, true);
    assert.equal(h.ids.get('setup').hidden, false);
  }
});


test('public sign-out rows ignore safety metadata even if it is supplied unexpectedly', async () => {
  for (const role of ['visitor', 'contractor']) {
    const h = harness({html: pages[0], hash: '#' + stationToken});
    vm.runInContext(inline(pages[0], 'script'), h.context);
    h.ids.get('mode-out').listeners.click();
    h.requests[0].respond(200, JSON.stringify({ok: true, entries: [{id: 'private-metadata', type: role, name: 'Example Person', company: 'Example Company', signedInAt: '2026-11-05T00:00:00Z', visitorSafetyAcknowledged: true, workshopAccess: true, ppeConfirmed: false, emergencyProcedureUnderstood: false, siteAccessUnderstood: false, hazardReportingUnderstood: false, undertakingWork: true, siteInductionCompleted: false, workRisksDiscussed: false}]}));
    await new Promise(resolve => setImmediate(resolve));
    const visible = textContent(h.ids.get('matches'));
    assert.match(visible, /Example Person/);
    assert.doesNotMatch(visible, /safety|workshop|PPE|acknowledged|confirmed|emergency|hazard|induction|risks|follow.up|true|false/i);
  }
});


test('administrator rows and CSV preserve visitor and contractor answers, historical unknowns and employee applicability', async () => {
  const h = harness({html: pages[1], sessionStorage: memoryStorage({'panelstock-attendance-admin': 'real-admin-session'})});
  vm.runInContext(inline(pages[1], 'script'), h.context);
  h.requests[0].respond(200, '{"ok":true,"isAdmin":true}');
  await new Promise(resolve => setImmediate(resolve));
  const entries = [
    {id: 'visitor-yes', type: 'visitor', name: 'Workshop Visitor', visitorSafetyAcknowledged: true, workshopAccess: true, ppeConfirmed: false},
    {id: 'visitor-no', type: 'visitor', name: 'Office Visitor', visitorSafetyAcknowledged: true, workshopAccess: false, ppeConfirmed: null},
    {id: 'historical-visitor', type: 'visitor', name: 'Historical Visitor', visitorSafetyAcknowledged: null, workshopAccess: null, ppeConfirmed: null},
    {id: 'contractor-yes', type: 'contractor', name: 'Work Area Contractor', visitorSafetyAcknowledged: true, workshopAccess: true, ppeConfirmed: true},
    {id: 'contractor-no', type: 'contractor', name: 'Office Contractor', visitorSafetyAcknowledged: true, workshopAccess: false, ppeConfirmed: null},
    {id: 'historical-contractor', type: 'contractor', name: 'Historical Contractor', visitorSafetyAcknowledged: null, workshopAccess: null, ppeConfirmed: null},
    {id: 'employee', type: 'employee', name: 'Example Employee'}
  ].map(entry => ({company: 'Example Company', contact: '', host: 'Site Host', purpose: '', signedInAt: '2026-11-05T00:00:00Z', signedOutAt: null, ...entry}));
  h.requests[1].respond(200, JSON.stringify({ok: true, entries, activeEntries: entries, counts: {active: 7, visitors: 3, contractors: 3, employees: 1}}));
  await new Promise(resolve => setImmediate(resolve));
  const rows = h.ids.get('rows').children;
  assert.match(textContent(rows[0]), /Visitor safety/);
  assert.match(textContent(rows[0]), /Safety acknowledged[\s\S]*Yes/);
  assert.match(textContent(rows[0]), /Workshop \/ work area access[\s\S]*Yes/);
  assert.match(textContent(rows[0]), /PPE confirmed[\s\S]*No/);
  assert.match(textContent(rows[1]), /PPE confirmed[\s\S]*Not applicable/);
  for (const [index, unknownCount] of [[2, 7], [5, 10]]) {
    assert.equal((textContent(rows[index]).match(/Not collected/g) || []).length, unknownCount);
    assert.doesNotMatch(textContent(rows[index]), /\b(?:Yes|No)\b/);
  }
  assert.match(textContent(rows[3]), /Contractor safety/);
  assert.match(textContent(rows[3]), /Safety acknowledged[\s\S]*Yes/);
  assert.match(textContent(rows[3]), /Workshop \/ work area access[\s\S]*Yes/);
  assert.match(textContent(rows[3]), /PPE confirmed[\s\S]*Yes/);
  assert.match(textContent(rows[4]), /PPE confirmed[\s\S]*Not applicable/);
  assert.doesNotMatch(textContent(rows[6]), /Safety acknowledged|Workshop \/ work area access|PPE confirmed/);
  const pending = h.ids.get('export').listeners.click();
  assert.equal(h.readers.length, 1);
  const csv = await h.readers[0].blob.text();
  h.readers[0].complete(csv);
  await pending;
  const lines = csv.trim().split('\r\n');
  assert.match(lines[0], /"Site safety acknowledged","Workshop \/ work area access","PPE confirmed"/);
  assert.match(lines[1], /"Yes","Yes","No"/);
  assert.match(lines[2], /"Yes","No","Not applicable"/);
  assert.match(lines[3], /"Not collected","Not collected","Not collected"/);
  assert.match(lines[4], /"Yes","Yes","Yes"/);
  assert.match(lines[5], /"Yes","No","Not applicable"/);
  assert.match(lines[6], /"Not collected","Not collected","Not collected"/);
  assert.match(lines[7], /"Not applicable","Not applicable","Not applicable"/);
});

test('paired kiosk opens with actions only and provides a separate role step, details step and back navigation', () => {
  const h = harness({html: pages[0], hash: '#' + stationToken});
  vm.runInContext(inline(pages[0], 'script'), h.context);
  assert.equal(h.ids.get('station').hidden, false);
  assert.equal(h.ids.get('action-screen').hidden, false);
  for (const id of ['role-screen', 'in-screen', 'out-screen', 'success']) assert.equal(h.ids.get(id).hidden, true, id);
  assert.equal(h.requests.length, 0);
  h.ids.get('mode-in').listeners.click();
  assert.equal(h.ids.get('action-screen').hidden, true);
  assert.equal(h.ids.get('role-screen').hidden, false);
  assert.equal(h.ids.get('in-screen').hidden, true);
  for (const button of h.roleButtons) assert.equal(button.attributes['aria-pressed'], 'false');
  h.roleButtons.find(button => button.dataset.role === 'visitor').listeners.click();
  assert.equal(h.ids.get('role-screen').hidden, true);
  assert.equal(h.ids.get('in-screen').hidden, false);
  assert.equal(h.document.activeElement, h.ids.get('name'));
  answerSafety(h, true, false);
  h.ids.get('back-to-roles').listeners.click();
  assert.equal(h.ids.get('role-screen').hidden, false);
  assert.equal(h.ids.get('in-screen').hidden, true);
  assertSafetyCleared(h);
  h.ids.get('back-to-actions-role').listeners.click();
  assert.equal(h.ids.get('action-screen').hidden, false);
  assert.equal(h.ids.get('role-screen').hidden, true);
  h.ids.get('mode-out').listeners.click();
  assert.equal(h.ids.get('out-screen').hidden, false);
  assert.equal(h.ids.get('action-screen').hidden, true);
  assert.equal(h.requests.length, 1);
  h.ids.get('back-to-actions-out').listeners.click();
  assert.equal(h.ids.get('action-screen').hidden, false);
  assert.equal(h.ids.get('out-screen').hidden, true);
});

test('automatic success reset returns to actions and never carries visitor or contractor answers to the next arrival', async () => {
  for (const role of ['visitor', 'contractor']) {
    const h = harness({html: pages[0], hash: '#' + stationToken});
    vm.runInContext(inline(pages[0], 'script'), h.context);
    startSignIn(h, role);
    fillDetails(h);
    answerSafety(h, true, false);
    const pending = h.ids.get('check-in').listeners.submit({preventDefault() {}});
    h.requests[0].respond(200, '{"ok":true,"entry":{"name":"Example Visitor","signedInAt":"2026-11-05T00:00:00Z"}}');
    await pending;
    const resetTimer = h.timers.find(timer => timer.delay === 15000 && !timer.cleared);
    assert.ok(resetTimer);
    resetTimer.callback();
    assert.equal(h.ids.get('action-screen').hidden, false);
    assert.equal(h.ids.get('success').hidden, true);
    assert.equal(h.ids.get('success-workshop-warning').hidden, true);
    assertSafetyCleared(h);
    startSignIn(h, role);
    assertSafetyCleared(h);
    assert.equal(h.ids.get('name').value, '');
    assert.equal(h.ids.get('company').value, '');
    assert.equal(h.ids.get('host').value, '');
  }
});


test('contractor safety wording and required answers change cleanly when switching between contractor, visitor and employee', () => {
  const h = harness({html: pages[0], hash: '#' + stationToken});
  vm.runInContext(inline(pages[0], 'script'), h.context);
  startSignIn(h);
  answerSafety(h, true, false);
  h.ids.get('back-to-roles').listeners.click();
  h.roleButtons.find(button => button.dataset.role === 'contractor').listeners.click();
  assertSafetyCleared(h);
  assert.equal(h.ids.get('visitor-safety').hidden, false);
  assert.equal(h.ids.get('visitor-safety-title').textContent, 'Contractor safety');
  assert.equal(h.ids.get('safety-acknowledgement-text').textContent, 'I have read and understood the site safety instructions provided by my Lennox Facades contact.');
  assert.equal(h.ids.get('visitor-safety-help').textContent, 'Ask your Lennox Facades contact for the instructions if you have not received them.');
  assert.equal(h.ids.get('workshop-access-question').textContent, 'Will you be entering the workshop or work areas?');
  assert.equal(h.ids.get('ppe-confirmed-question').textContent, 'Do you have the PPE required for your work area?');
  for (const id of ['visitor-safety-acknowledged', 'workshop-access-yes', 'workshop-access-no']) {
    assert.equal(h.ids.get(id).disabled, false);
    assert.equal(h.ids.get(id).required, true);
  }
  fillDetails(h, 'Example Contractor');
  assert.equal(h.ids.get('check-in').checkValidity(), false);
  choose(h, 'visitor-safety-acknowledged');
  assert.equal(h.ids.get('check-in').checkValidity(), false);
  choose(h, 'workshop-access-yes');
  assert.equal(h.ids.get('check-in').checkValidity(), false);
  for (const id of ['ppe-confirmed-yes', 'ppe-confirmed-no']) {
    assert.equal(h.ids.get(id).disabled, false);
    assert.equal(h.ids.get(id).required, true);
  }
  choose(h, 'ppe-confirmed-no');
  answerFollowupSafety(h);
  assert.equal(h.ids.get('check-in').checkValidity(), true);
  assert.equal(h.ids.get('visitor-workshop-warning').hidden, false);
  assert.equal(h.ids.get('visitor-workshop-warning').textContent, 'Speak to your Lennox Facades contact before entering the work area or starting work.');
  choose(h, 'workshop-access-no');
  assert.equal(h.ids.get('ppe-field').hidden, true);
  assert.equal(h.ids.get('visitor-workshop-warning').hidden, true);
  for (const id of ['ppe-confirmed-yes', 'ppe-confirmed-no']) {
    assert.equal(h.ids.get(id).checked, false);
    assert.equal(h.ids.get(id).disabled, true);
    assert.equal(h.ids.get(id).required, false);
  }
  assert.equal(h.ids.get('check-in').checkValidity(), true);
  h.ids.get('back-to-roles').listeners.click();
  h.roleButtons.find(button => button.dataset.role === 'visitor').listeners.click();
  assertSafetyCleared(h);
  assert.equal(h.ids.get('visitor-safety-title').textContent, 'Visitor safety');
  assert.equal(h.ids.get('safety-acknowledgement-text').textContent, 'I have read and understood the visitor safety instructions provided by my host.');
  assert.equal(h.ids.get('visitor-safety-help').textContent, 'Ask your host for the instructions if you have not received them.');
  assert.equal(h.ids.get('workshop-access-question').textContent, 'Will you need access to the workshop?');
  assert.equal(h.ids.get('ppe-confirmed-question').textContent, 'Do you have the required PPE for the workshop?');
  answerSafety(h, true, false);
  assert.equal(h.ids.get('visitor-workshop-warning').textContent, 'Speak to your host before entering the workshop.');
  h.ids.get('back-to-roles').listeners.click();
  h.roleButtons.find(button => button.dataset.role === 'employee').listeners.click();
  assertSafetyCleared(h);
  assert.equal(h.ids.get('visitor-safety').hidden, true);
  for (const id of safetyIds) {
    assert.equal(h.ids.get(id).disabled, true);
    assert.equal(h.ids.get(id).required, false);
  }
});

test('site information questions use required native Yes or No groups for visitors and contractors', async () => {
  const questions = [
    'Do you know the emergency evacuation procedure and assembly point?',
    'Have you been told which areas you may enter?',
    'Do you know who to contact if you identify a hazard or have an incident?'
  ];
  for (const question of questions) assert.ok(pages[0].includes(question));
  for (const role of ['visitor', 'contractor']) {
    const h = harness({html: pages[0], hash: '#' + stationToken});
    vm.runInContext(inline(pages[0], 'script'), h.context);
    startSignIn(h, role);
    fillDetails(h);
    choose(h, 'visitor-safety-acknowledged');
    choose(h, 'workshop-access-no');
    if (role === 'contractor') choose(h, 'undertaking-work-no');
    const form = h.ids.get('check-in');
    for (const [index, [field, prefix]] of commonSafetyFields.entries()) {
      for (const value of ['yes', 'no']) {
        const input = h.ids.get(prefix + '-' + value);
        assert.equal(input.type, 'radio');
        assert.equal(input.name, field);
        assert.equal(input.value, value);
        assert.equal(input.disabled, false);
        assert.equal(input.required, true);
        assert.equal(input.checked, false);
      }
      assert.equal(form.checkValidity(), false);
      await form.listeners.submit({preventDefault() {}});
      assert.equal(h.requests.length, 0);
      choose(h, prefix + '-yes');
      assert.equal(form.checkValidity(), index === commonSafetyFields.length - 1);
    }
    const pending = form.listeners.submit({preventDefault() {}});
    assert.equal(h.requests.length, 1);
    const payload = JSON.parse(h.requests[0].body);
    for (const [field] of commonSafetyFields) assert.equal(payload[field], true);
    if (role === 'visitor') {
      for (const [field] of contractorSafetyFields) assert.equal(field in payload, false);
      assert.equal(h.ids.get('contractor-work-field').hidden, true);
    } else {
      assert.equal(payload.undertakingWork, false);
      assert.equal(payload.siteInductionCompleted, null);
      assert.equal(payload.workRisksDiscussed, null);
    }
    h.requests[0].respond(200, JSON.stringify({ok: true, entry: {name: 'Example Person', signedInAt: '2026-11-05T00:00:00Z'}}));
    await pending;
  }
});

test('contractor work questions are required only while undertaking work and clear when the answer changes to No', async () => {
  for (const question of [
    'Will you be carrying out work on site today?',
    'Have you completed the induction required for your work on this site?',
    'Have today’s work activities, hazards and controls been discussed with your Lennox Facades contact?'
  ]) assert.ok(pages[0].includes(question));
  const h = harness({html: pages[0], hash: '#' + stationToken});
  vm.runInContext(inline(pages[0], 'script'), h.context);
  startSignIn(h, 'contractor');
  fillDetails(h);
  choose(h, 'visitor-safety-acknowledged');
  choose(h, 'workshop-access-no');
  for (const [, prefix] of commonSafetyFields) choose(h, prefix + '-yes');
  const form = h.ids.get('check-in');
  assert.equal(h.ids.get('contractor-work-field').hidden, false);
  assert.equal(h.ids.get('contractor-work-questions').hidden, true);
  for (const value of ['yes', 'no']) {
    const input = h.ids.get('undertaking-work-' + value);
    assert.equal(input.name, 'undertakingWork');
    assert.equal(input.value, value);
    assert.equal(input.required, true);
    assert.equal(input.disabled, false);
  }
  assert.equal(form.checkValidity(), false);
  await form.listeners.submit({preventDefault() {}});
  assert.equal(h.requests.length, 0);
  choose(h, 'undertaking-work-yes');
  assert.equal(h.ids.get('contractor-work-questions').hidden, false);
  for (const [field, prefix] of contractorSafetyFields.slice(1)) for (const value of ['yes', 'no']) {
    const input = h.ids.get(prefix + '-' + value);
    assert.equal(input.type, 'radio');
    assert.equal(input.name, field);
    assert.equal(input.value, value);
    assert.equal(input.required, true);
    assert.equal(input.disabled, false);
  }
  await form.listeners.submit({preventDefault() {}});
  assert.equal(h.requests.length, 0);
  choose(h, 'site-induction-completed-no');
  assert.equal(form.checkValidity(), false);
  choose(h, 'work-risks-discussed-no');
  assert.equal(form.checkValidity(), true);
  assert.equal(h.ids.get('visitor-workshop-warning').hidden, false);
  choose(h, 'undertaking-work-no');
  assert.equal(h.ids.get('contractor-work-questions').hidden, true);
  for (const [, prefix] of contractorSafetyFields.slice(1)) for (const value of ['yes', 'no']) {
    const input = h.ids.get(prefix + '-' + value);
    assert.equal(input.checked, false);
    assert.equal(input.disabled, true);
    assert.equal(input.required, false);
  }
  assert.equal(h.ids.get('visitor-workshop-warning').hidden, true);
  assert.equal(form.checkValidity(), true);
  const pending = form.listeners.submit({preventDefault() {}});
  const payload = JSON.parse(h.requests[0].body);
  assert.equal(payload.undertakingWork, false);
  assert.equal(payload.siteInductionCompleted, null);
  assert.equal(payload.workRisksDiscussed, null);
  h.requests[0].respond(200, JSON.stringify({ok: true, entry: {name: 'Example Contractor', signedInAt: '2026-11-05T00:00:00Z'}}));
  await pending;
  assert.equal(h.ids.get('success-workshop-warning').hidden, true);
});

test('each No site-information answer saves attendance, preserves retry payloads and shows role-specific guidance before and after saving', async () => {
  for (const role of ['visitor', 'contractor']) for (const [falseIndex, [falseField]] of commonSafetyFields.entries()) {
    const h = harness({html: pages[0], hash: '#' + stationToken});
    vm.runInContext(inline(pages[0], 'script'), h.context);
    startSignIn(h, role);
    fillDetails(h);
    answerSafety(h);
    const common = commonSafetyFields.map((_, index) => index !== falseIndex);
    answerFollowupSafety(h, {common});
    const guidance = role === 'contractor' ? 'Speak to your Lennox Facades contact before entering the site areas.' : 'Speak to your host before entering the site areas.';
    assert.equal(h.ids.get('check-in').checkValidity(), true);
    assert.equal(h.ids.get('visitor-workshop-warning').hidden, false);
    assert.equal(h.ids.get('visitor-workshop-warning').textContent, guidance);
    const first = h.ids.get('check-in').listeners.submit({preventDefault() {}});
    const payload = JSON.parse(h.requests[0].body);
    assert.equal(payload[falseField], false);
    for (const [index, [field]] of commonSafetyFields.entries()) assert.equal(payload[field], common[index]);
    if (role === 'visitor') for (const [field] of contractorSafetyFields) assert.equal(field in payload, false);
    h.requests[0].ontimeout();
    await first;
    assert.equal(h.ids.get('visitor-workshop-warning').textContent, guidance);
    const retry = h.ids.get('check-in').listeners.submit({preventDefault() {}});
    assert.equal(h.requests[1].body, h.requests[0].body);
    h.requests[1].respond(200, JSON.stringify({ok: true, entry: {name: 'Example Person', signedInAt: '2026-11-05T00:00:00Z'}}));
    await retry;
    assert.equal(h.ids.get('success-title').textContent, 'You’re signed in');
    assert.equal(h.ids.get('success-workshop-warning').hidden, false);
    assert.equal(h.ids.get('success-workshop-warning').textContent, guidance);
    assertSafetyCleared(h);
    h.ids.get('next-person').listeners.click();
    assert.equal(h.ids.get('success-workshop-warning').hidden, true);
    assertSafetyCleared(h);
  }
});

test('contractor No work-readiness answers save and combine PPE, site and work guidance in one concise callout', async () => {
  for (const answers of [{induction: false, risks: true}, {induction: true, risks: false}, {induction: false, risks: false}]) {
    const h = harness({html: pages[0], hash: '#' + stationToken});
    vm.runInContext(inline(pages[0], 'script'), h.context);
    startSignIn(h, 'contractor');
    fillDetails(h);
    answerSafety(h, true, false);
    answerFollowupSafety(h, {common: [false, true, true], undertakingWork: true, ...answers});
    const reminder = h.ids.get('visitor-workshop-warning');
    assert.equal(reminder.hidden, false);
    assert.equal(reminder.textContent, 'Speak to your Lennox Facades contact before entering the site areas or starting work.');
    assert.equal((reminder.textContent.match(/Speak to/g) || []).length, 1);
    const guidance = reminder.textContent;
    assert.equal(h.ids.get('check-in').checkValidity(), true);
    const pending = h.ids.get('check-in').listeners.submit({preventDefault() {}});
    const payload = JSON.parse(h.requests[0].body);
    assert.equal(payload.ppeConfirmed, false);
    assert.equal(payload.emergencyProcedureUnderstood, false);
    assert.equal(payload.undertakingWork, true);
    assert.equal(payload.siteInductionCompleted, answers.induction);
    assert.equal(payload.workRisksDiscussed, answers.risks);
    h.requests[0].respond(200, JSON.stringify({ok: true, entry: {name: 'Example Contractor', signedInAt: '2026-11-05T00:00:00Z'}}));
    await pending;
    assert.equal(h.ids.get('success-title').textContent, 'You’re signed in');
    assert.equal(h.ids.get('success-workshop-warning').hidden, false);
    assert.equal(h.ids.get('success-workshop-warning').textContent, guidance);
    assertSafetyCleared(h);
  }
});

test('contractor work answers and guidance clear on role changes, Back, idle, pairing reset, Done and success timeout', async () => {
  for (const action of ['role', 'back', 'idle', 'pairing', 'done', 'timeout']) {
    const h = harness({html: pages[0], hash: '#' + stationToken});
    vm.runInContext(inline(pages[0], 'script'), h.context);
    startSignIn(h, 'contractor');
    fillDetails(h);
    answerSafety(h, true, false);
    answerFollowupSafety(h, {common: [false, false, false], undertakingWork: true, induction: false, risks: false});
    if (action === 'role' || action === 'back') {
      h.ids.get('back-to-roles').listeners.click();
      assertSafetyCleared(h);
      if (action === 'role') {
        h.roleButtons.find(button => button.dataset.role === 'visitor').listeners.click();
        assert.equal(h.ids.get('contractor-work-field').hidden, true);
        for (const [, prefix] of contractorSafetyFields) for (const value of ['yes', 'no']) {
          assert.equal(h.ids.get(prefix + '-' + value).disabled, true);
          assert.equal(h.ids.get(prefix + '-' + value).required, false);
        }
      }
    } else if (action === 'idle') {
      h.advanceTime(120001);
      assert.equal(h.ids.get('action-screen').hidden, false);
    } else if (action === 'pairing') {
      const pending = h.context.attendanceLegacyRequest('/attendance/check-out');
      h.requests[0].respond(401, '{"ok":false,"error":"Station access has expired"}');
      await pending;
      assert.equal(h.ids.get('setup').hidden, false);
    } else {
      const pending = h.ids.get('check-in').listeners.submit({preventDefault() {}});
      h.requests[0].respond(200, JSON.stringify({ok: true, entry: {name: 'Example Contractor', signedInAt: '2026-11-05T00:00:00Z'}}));
      await pending;
      assert.equal(h.ids.get('success-workshop-warning').hidden, false);
      if (action === 'done') h.ids.get('next-person').listeners.click();
      else h.timers.find(timer => timer.delay === 15000 && !timer.cleared).callback();
      assert.equal(h.ids.get('action-screen').hidden, false);
    }
    assertSafetyCleared(h);
    assert.equal(h.ids.get('success-workshop-warning').hidden, true);
  }
});

test('admin details and CSV preserve all six follow-up answers, historical unknowns and conditional applicability', async () => {
  const h = harness({html: pages[1], sessionStorage: memoryStorage({'panelstock-attendance-admin': 'real-admin-session'})});
  vm.runInContext(inline(pages[1], 'script'), h.context);
  h.requests[0].respond(200, '{"ok":true,"isAdmin":true}');
  await new Promise(resolve => setImmediate(resolve));
  const commonYes = {emergencyProcedureUnderstood: true, siteAccessUnderstood: true, hazardReportingUnderstood: true};
  const entries = [
    {id: 'visitor-followup', type: 'visitor', name: 'Visitor Follow-up', ...commonYes, siteAccessUnderstood: false},
    {id: 'visitor-clear', type: 'visitor', name: 'Visitor Clear', ...commonYes},
    {id: 'contractor-work', type: 'contractor', name: 'Contractor Work', ...commonYes, undertakingWork: true, siteInductionCompleted: false, workRisksDiscussed: true},
    {id: 'contractor-no-work', type: 'contractor', name: 'Contractor No Work', ...commonYes, undertakingWork: false, siteInductionCompleted: null, workRisksDiscussed: null},
    {id: 'visitor-history', type: 'visitor', name: 'Visitor Historical', ...Object.fromEntries(safetyFields.map(field => [field, null]))},
    {id: 'contractor-history', type: 'contractor', name: 'Contractor Historical', ...Object.fromEntries(safetyFields.map(field => [field, null]))},
    {id: 'employee', type: 'employee', name: 'Example Employee'}
  ].map(entry => ({company: 'Example Company', contact: '', host: 'Site Host', purpose: '', signedInAt: '2026-11-05T00:00:00Z', signedOutAt: null, visitorSafetyAcknowledged: true, workshopAccess: false, ppeConfirmed: null, ...entry}));
  h.requests[1].respond(200, JSON.stringify({ok: true, entries, activeEntries: entries, counts: {active: entries.length, visitors: 3, contractors: 3, employees: 1}}));
  await new Promise(resolve => setImmediate(resolve));
  const rows = h.ids.get('rows').children;
  assert.match(textContent(rows[0]), /Emergency procedure understood[\s\S]*Yes/);
  assert.match(textContent(rows[0]), /Site access understood[\s\S]*No/);
  assert.match(textContent(rows[0]), /Hazard reporting understood[\s\S]*Yes/);
  assert.match(textContent(rows[0]), /Staff follow-up/);
  assert.match(textContent(rows[1]), /Staff follow-up[\s\S]*No/);
  assert.equal(rows[1].children[0].children.some(node => node.className === 'follow-up-flag'), false);
  assert.match(textContent(rows[2]), /Undertaking work[\s\S]*Yes/);
  assert.match(textContent(rows[2]), /Site induction completed[\s\S]*No/);
  assert.match(textContent(rows[2]), /Work risks discussed[\s\S]*Yes/);
  assert.match(textContent(rows[2]), /Staff follow-up/);
  assert.match(textContent(rows[3]), /Undertaking work[\s\S]*No/);
  assert.match(textContent(rows[3]), /Site induction completed[\s\S]*Not applicable/);
  assert.match(textContent(rows[3]), /Work risks discussed[\s\S]*Not applicable/);
  assert.match(textContent(rows[3]), /Staff follow-up[\s\S]*No/);
  assert.equal(rows[3].children[0].children.some(node => node.className === 'follow-up-flag'), false);
  assert.equal((textContent(rows[4]).match(/Not collected/g) || []).length, 7);
  assert.equal((textContent(rows[5]).match(/Not collected/g) || []).length, 10);
  for (const index of [4, 5]) {
    assert.doesNotMatch(textContent(rows[index]), /\bYes\b|\bNo\b/);
    assert.equal(rows[index].children[0].children.some(node => node.className === 'follow-up-flag'), false);
  }
  assert.doesNotMatch(textContent(rows[6]), /Emergency procedure understood|Site access understood|Hazard reporting understood|Undertaking work|Site induction completed|Work risks discussed|Staff follow-up/);
  const pending = h.ids.get('export').listeners.click();
  const csv = await h.readers[0].blob.text();
  h.readers[0].complete(csv);
  await pending;
  const lines = csv.replace(/^\uFEFF/, '').trim().split('\r\n').map(line => JSON.parse('[' + line + ']'));
  const headings = lines[0];
  const fields = ['Emergency procedure understood', 'Site access understood', 'Hazard reporting understood', 'Undertaking work', 'Site induction completed', 'Work risks discussed', 'Staff follow-up'];
  for (const field of fields) assert.ok(headings.includes(field), field);
  const values = row => Object.fromEntries(fields.map(field => [field, lines[row][headings.indexOf(field)]]));
  assert.deepEqual(Object.values(values(1)), ['Yes', 'No', 'Yes', 'Not applicable', 'Not applicable', 'Not applicable', 'Yes']);
  assert.deepEqual(Object.values(values(2)), ['Yes', 'Yes', 'Yes', 'Not applicable', 'Not applicable', 'Not applicable', 'No']);
  assert.deepEqual(Object.values(values(3)), ['Yes', 'Yes', 'Yes', 'Yes', 'No', 'Yes', 'Yes']);
  assert.deepEqual(Object.values(values(4)), ['Yes', 'Yes', 'Yes', 'No', 'Not applicable', 'Not applicable', 'No']);
  assert.deepEqual(Object.values(values(5)), ['Not collected', 'Not collected', 'Not collected', 'Not applicable', 'Not applicable', 'Not applicable', 'Not collected']);
  assert.deepEqual(Object.values(values(6)), Array(7).fill('Not collected'));
  assert.deepEqual(Object.values(values(7)), Array(7).fill('Not applicable'));
});

test('combined reminders cover visitor workshop access and contractor work readiness without duplicate guidance', async () => {
  const cases = [
    {role: 'visitor', workshop: true, ppe: false, common: [true, false, true], guidance: 'Speak to your host before entering the site areas or workshop.'},
    {role: 'contractor', workshop: false, undertakingWork: true, induction: false, guidance: 'Speak to your Lennox Facades contact before starting work.'},
    {role: 'contractor', workshop: true, ppe: false, undertakingWork: true, risks: false, guidance: 'Speak to your Lennox Facades contact before entering the work area or starting work.'},
    {role: 'contractor', workshop: false, undertakingWork: true, induction: false, common: [false, true, true], guidance: 'Speak to your Lennox Facades contact before entering the site areas or starting work.'},
    {role: 'contractor', workshop: false, undertakingWork: true, guidance: ''}
  ];
  for (const example of cases) {
    const h = harness({html: pages[0], hash: '#' + stationToken});
    vm.runInContext(inline(pages[0], 'script'), h.context);
    startSignIn(h, example.role);
    fillDetails(h);
    answerSafety(h, example.workshop, example.ppe ?? null);
    answerFollowupSafety(h, example);
    assert.equal(h.ids.get('check-in').checkValidity(), true);
    assert.equal(h.ids.get('visitor-workshop-warning').hidden, !example.guidance);
    if (example.guidance) {
      assert.equal(h.ids.get('visitor-workshop-warning').textContent, example.guidance);
      assert.equal((h.ids.get('visitor-workshop-warning').textContent.match(/Speak to/g) || []).length, 1);
    }
    const pending = h.ids.get('check-in').listeners.submit({preventDefault() {}});
    h.requests[0].respond(200, JSON.stringify({ok: true, entry: {name: 'Example Person', signedInAt: '2026-11-05T00:00:00Z'}}));
    await pending;
    assert.equal(h.ids.get('success-workshop-warning').hidden, !example.guidance);
    if (example.guidance) assert.equal(h.ids.get('success-workshop-warning').textContent, example.guidance);
  }
});
