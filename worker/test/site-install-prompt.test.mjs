import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../../site/install-prompt.js', import.meta.url), 'utf8');
const key = 'panelstock:site-orders:install-snoozed-until:v1';
const week = 7 * 24 * 60 * 60 * 1000;

class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.listeners = {}; this.controls = {}; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, handler) { this.listeners[name] = handler; }
  appendChild(node) { this.children.push(node); node.parentNode = this; }
  removeChild(node) { this.children.splice(this.children.indexOf(node), 1); node.parentNode = null; }
  querySelector(selector) { return this.controls[selector]; }
  set innerHTML(html) {
    this.html = html;
    for (const match of html.matchAll(/<(button|p|ol)([^>]*\bdata-[a-z]+\b[^>]*)>([\s\S]*?)<\/\1>/g)) {
      const node = new Node(match[1]), name = match[2].match(/\bdata-([a-z]+)/)[1];
      node.hidden = /\bhidden\b/.test(match[2]);
      node.textContent = match[3].replace(/<[^>]+>/g, '');
      this.controls['[data-' + name + ']'] = node;
    }
  }
}

function harness(options = {}) {
  const handlers = {}, timers = new Map(), saved = options.saved || new Map();
  let now = options.now || 1000000000, nextTimer = 0;
  const body = new Node('body'), head = new Node('head'), app = new Node('app'); body.appendChild(app);
  const mode = {matches: !!options.standalone, addEventListener(name, handler) { this.change = handler; }};
  const document = {body, head, hidden: !!options.hidden, createElement: tag => new Node(tag),
    getElementById: id => head.children.find(node => node.id === id),
    addEventListener: (name, handler) => handlers[name] = handler};
  const window = {matchMedia: () => mode, addEventListener: (name, handler) => handlers[name] = handler,
    setTimeout: handler => { timers.set(++nextTimer, handler); return nextTimer; }, clearTimeout: id => timers.delete(id)};
  window.top = options.embedded ? {} : window;
  if (options.mobileHost) window.PanelStockSiteHost = {};
  const navigator = {userAgent: options.ios ? 'iPhone OS 18_0' : 'Android Chrome', standalone: !!options.appleStandalone,
    platform: options.ipad ? 'MacIntel' : '', maxTouchPoints: options.ipad ? 5 : 0};
  const localStorage = {getItem: name => { if (options.blockedStorage) throw Error('Blocked'); return saved.get(name) || null; },
    setItem: (name, value) => { if (options.blockedStorage) throw Error('Blocked'); saved.set(name, value); }};
  vm.runInNewContext(source, {window, navigator, document, localStorage, Promise, Date: {now: () => now}});
  const emit = (name, event = {}) => { handlers[name]?.(event); return event; };
  return {window, document, body, app, mode, saved, emit,
    popup: () => body.children.find(node => node.tag === 'section'),
    tick: () => { const pending = [...timers.values()]; timers.clear(); pending.forEach(handler => handler()); },
    advance: milliseconds => { now += milliseconds; }};
}
function offer(h, options = {}) {
  let calls = 0, finish;
  const event = {prevented: false, preventDefault() { this.prevented = true; },
    prompt() { calls++; if (options.error) throw Error('Unavailable'); return Promise.resolve(); },
    userChoice: new Promise(resolve => finish = resolve)};
  h.emit('beforeinstallprompt', event);
  return {event, calls: () => calls, finish};
}
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

test('native installation is offered after eligibility and invoked only by an explicit click', async () => {
  const h = harness(); h.tick(); assert.equal(h.popup(), undefined);
  const install = offer(h);
  assert.equal(install.event.prevented, true); assert.equal(install.calls(), 0);
  h.tick(); const popup = h.popup();
  assert.equal(popup.attributes.role, 'dialog'); assert.equal(popup.attributes['aria-modal'], 'false');
  const button = popup.querySelector('[data-install]'); assert.equal(button.textContent, 'Install app');
  button.listeners.click(); assert.equal(install.calls(), 1); assert.equal(button.disabled, true);
  install.finish({outcome: 'accepted'}); await settle();
  assert.equal(h.popup(), undefined); assert.ok(h.saved.has(key));
  offer(h); h.tick(); assert.equal(h.popup(), undefined);
  assert.deepEqual(h.body.children, [h.app]);
});

test('Not now and a dismissed browser prompt postpone reminders for a week across visits', async () => {
  const h = harness(); offer(h); h.tick(); h.popup().querySelector('[data-later]').listeners.click();
  const snoozed = harness({saved: h.saved}); const ignored = offer(snoozed); snoozed.tick();
  assert.equal(ignored.event.prevented, false); assert.equal(snoozed.popup(), undefined);
  const later = harness({saved: h.saved, now: 1000000000 + week + 1});
  const install = offer(later); later.tick(); assert.ok(later.popup());
  later.popup().querySelector('[data-install]').listeners.click();
  install.finish({outcome: 'dismissed'}); await settle(); assert.equal(later.popup(), undefined);
});

test('iPhone and iPad show Home Screen instructions without pretending to open a native install dialog', () => {
  for (const options of [{ios: true}, {ipad: true}]) {
    const h = harness(options); h.tick(); const popup = h.popup(), button = popup.querySelector('[data-install]');
    assert.equal(button.textContent, 'Show install steps');
    assert.equal(popup.querySelector('[data-steps]').hidden, true);
    button.listeners.click();
    assert.equal(button.attributes['aria-expanded'], 'true');
    assert.equal(popup.querySelector('[data-steps]').hidden, false);
    assert.match(popup.querySelector('[data-steps]').textContent, /Share.*Add to Home Screen.*Add/);
    button.listeners.click(); assert.equal(popup.querySelector('[data-steps]').hidden, true);
    popup.querySelector('[data-close]').listeners.click(); assert.equal(h.popup(), undefined);
  }
});

test('installed apps, embedded views and browsers without installation support are quiet', () => {
  for (const options of [{ios: true, standalone: true}, {ios: true, appleStandalone: true},
    {embedded: true}, {mobileHost: true}, {}]) {
    const h = harness(options); if (options.standalone || options.appleStandalone) offer(h);
    h.tick(); assert.equal(h.popup(), undefined); assert.equal(h.saved.size, 0);
  }
});

test('installation and standalone mode changes remove an open reminder', () => {
  for (const action of ['installed', 'standalone']) {
    const h = harness(); offer(h); h.tick(); assert.ok(h.popup());
    if (action === 'installed') h.emit('appinstalled');
    else { h.mode.matches = true; h.mode.change(); }
    assert.equal(h.popup(), undefined);
  }
});

test('private browsing storage errors do not break dismissal or reopen the popup', () => {
  const h = harness({ios: true, blockedStorage: true}); h.tick();
  h.popup().listeners.keydown({key: 'Escape'}); assert.equal(h.popup(), undefined);
  h.emit('visibilitychange'); h.tick(); assert.equal(h.popup(), undefined);
});

test('hidden tabs wait until visible and repeated install events do not duplicate the popup', () => {
  const h = harness({hidden: true}); offer(h); h.tick(); assert.equal(h.popup(), undefined);
  h.document.hidden = false; h.emit('visibilitychange'); offer(h); h.tick();
  assert.equal(h.body.children.filter(node => node.tag === 'section').length, 1);
  assert.equal(h.body.children[0], h.app);
});

test('a rejected native prompt leaves a useful browser-menu fallback without an unhandled rejection', async () => {
  const h = harness(); offer(h, {error: true}); h.tick(); h.popup().querySelector('[data-install]').listeners.click();
  await settle();
  assert.equal(h.popup().querySelector('[data-install]').hidden, true);
  assert.match(h.popup().querySelector('[data-description]').textContent, /browser menu.*Install app or Add to Home Screen/);
  h.popup().querySelector('[data-later]').listeners.click(); assert.equal(h.popup(), undefined);
});
