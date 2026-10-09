import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {buildSiteOrders} from '../scripts/site-orders.mjs';

let output, result;
const read = file => fs.readFile(path.join(output, file), 'utf8');
before(async () => {
  output = await fs.mkdtemp(path.join(os.tmpdir(), 'panelstock-site-domain-'));
  result = await buildSiteOrders(output);
});
after(async () => { if (output) await fs.rm(output, {recursive: true, force: true}); });

test('dedicated domain has a root manifest and a closed, public asset allowlist', async () => {
  const manifest = JSON.parse(await read('manifest.webmanifest'));
  assert.equal(manifest.id, '/');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  for (const icon of manifest.icons) assert.ok(result.files.includes(icon.src.slice(1)));
  const html = await read('index.html');
  assert.match(html, /PanelStock Site Orders/);
  for (const [, url] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const file = new URL(url, 'https://site.panelstockhq.com/').pathname.slice(1);
    assert.ok(result.files.includes(file), `Missing ${url}`);
  }
  assert.equal(result.files.length, 17);
  assert.ok(result.files.every(file => !file.includes('/') && !file.includes('.env')));
  assert.match(await read('_headers'), /Cache-Control: no-cache/);
  const config = JSON.parse(await fs.readFile(new URL('../wrangler.site-orders.jsonc', import.meta.url)));
  assert.deepEqual(config.routes, [{pattern: 'site.panelstockhq.com', custom_domain: true}]);
  assert.equal(config.assets.not_found_handling, 'none');
  assert.equal(config.assets.html_handling, 'auto-trailing-slash');
  assert.equal(config.main, undefined);
});

test('mobile hostname remains unchanged and the new app is not a retired entry point', async () => {
  assert.equal((await fs.readFile(new URL('../../CNAME', import.meta.url), 'utf8')).trim(), 'app.panelstockhq.com');
  const old = JSON.parse(await fs.readFile(new URL('../../site/manifest.webmanifest', import.meta.url)));
  assert.equal(old.start_url, '/site/');
  assert.equal(old.scope, '/site/');
  const oldApp = await fs.readFile(new URL('../../site/app.js', import.meta.url), 'utf8');
  assert.match(oldApp, /register\('\/site\/sw.js'/);
  assert.doesNotMatch(oldApp, /location\.(?:href|replace).*site\.panelstockhq/);
  assert.doesNotMatch(await read('index.html'), /http-equiv="refresh"|location\.replace/);
  assert.doesNotMatch(await read('sw.js'), /DESTINATION|client\.navigate/);
});

for (const client of ['app.js', 'app.legacy.js']) {
  test(`${client} boots as a browser script and preserves the owner-scoped outbox`, async () => {
    const source = await read(client), registrations = [];
    assert.doesNotMatch(source, /\brequire\s*\(|^import\s/m);
    assert.match(source, /['"]\/site\/cnc['"]/);
    const outboxKey = 'panelstock:site-orders:outbox:v1';
    const queue = JSON.stringify({owner: 'synthetic-user', queue: [{localId: 'pending-order', order: {project: 'Test'}}]});
    const values = new Map([[outboxKey, queue]]);
    const storage = {
      getItem: key => values.get(key) || null,
      setItem: (key, value) => values.set(key, value),
      removeItem: key => values.delete(key)
    };
    const node = {innerHTML: '', querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, appendChild() {}, prepend() {}};
    const document = {getElementById: () => node, createElement: () => ({...node}), head: node, body: node, querySelectorAll: () => []};
    const context = {console, URL, Headers, Response, Request, AbortSignal, Map, Set, Date, Promise, Symbol,
      document, localStorage: storage, sessionStorage: {getItem: () => null},
      window: {Promise, Symbol, crypto: {randomUUID() {}}, AbortSignal, queueMicrotask, setInterval(callback,delay) {assert.equal(delay,60000);}, addEventListener() {}},
      Element: function () {}, MutationObserver: class {observe() {}},
      navigator: {onLine: true, serviceWorker: {register: async (url, options) => {
        registrations.push({url, options}); return {update() {}};
      }}},
      fetch: () => {throw new Error('No network or order submission is allowed during a signed-out boot');}
    };
    vm.runInNewContext(source, context);
    assert.match(node.innerHTML, /Log in to PanelStock/);
    assert.match(node.innerHTML, /name="username"/);
    assert.equal(registrations.length, 1);
    assert.equal(registrations[0].url, '/sw.js');
    assert.equal(registrations[0].options.updateViaCache, 'none');
    assert.equal(values.get(outboxKey), queue);
  });
}

test('root service worker caches only packaged static assets and supports offline launch', async () => {
  const handlers = {}, buckets = new Map(), origin = 'https://site.panelstockhq.com';
  let offline = false;
  const key = value => new URL(typeof value === 'string' ? value : value.url, origin).href;
  const caches = {
    keys: async () => [...buckets.keys()], delete: async name => buckets.delete(name),
    open: async name => {
      if (!buckets.has(name)) buckets.set(name, new Map());
      const entries = buckets.get(name);
      return {
        addAll: async assets => {
          assert.equal(new Set(assets.map(key)).size, assets.length, 'Cache.addAll rejects duplicate requests');
          for (const asset of assets) {
            const url = new URL(asset, origin);
            const filename = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
            assert.ok(result.files.includes(filename), `Missing precache asset ${asset}`);
            entries.set(key(asset), new Response(await read(filename)));
          }
        },
        put: async (request, response) => entries.set(key(request), response.clone()),
        match: async request => entries.get(key(request))?.clone()
      };
    }
  };
  vm.runInNewContext(await read('sw.js'), {URL, Response, caches,
    self: {location: new URL(origin), skipWaiting: async () => {}, clients: {claim: async () => {}},
      addEventListener: (event, handler) => handlers[event] = handler},
    fetch: async () => {if (offline) throw Error('Offline'); return new Response('static');}
  });
  async function dispatch(event, request) {
    let response; const pending = [];
    handlers[event]({request, waitUntil: value => pending.push(value), respondWith: value => response = value});
    const value = await response; await Promise.all(pending); return value;
  }
  await caches.open('panelstock-site-old');
  await caches.open('panelstock-shell-untouched');
  await dispatch('install'); await dispatch('activate'); offline = true;
  assert.deepEqual(await caches.keys(), ['panelstock-shell-untouched', 'panelstock-site-' + result.revision]);
  const home = await dispatch('fetch', new Request(origin + '/'));
  assert.equal(home.status, 200); assert.match(await home.text(), /PanelStock Site Orders/);
  for (const url of [origin + '/orders', origin + '/site/cnc', origin + '/?token=private',
    'https://panelstock-reports.matthewlakerdis.workers.dev/orders']) {
    assert.equal(await dispatch('fetch', new Request(url)), undefined);
  }
  assert.equal(await dispatch('fetch', new Request(origin + '/', {headers: {Authorization: 'Bearer test'}})), undefined);
  assert.equal(await dispatch('fetch', new Request(origin + '/', {method: 'POST'})), undefined);
});

test('production API permits the new hostname without removing existing apps or migrating storage', async () => {
  const source = await fs.readFile(new URL('../wrangler.production.jsonc', import.meta.url), 'utf8');
  const config = JSON.parse(source.replace(/^\s*\/\/.*$/gm, ''));
  assert.deepEqual(config.vars.ALLOWED_ORIGINS.split(','), [
    'https://app.panelstockhq.com', 'https://web.panelstockhq.com', 'https://site.panelstockhq.com'
  ]);
  assert.equal(config.vars.MIGRATION_READY, 'false');
  assert.equal(config.vars.READ_ONLY, 'false');
});

test('build refuses unexpected files and produces a repeatable cache revision', async () => {
  assert.equal((await buildSiteOrders(output)).revision, result.revision);
  await fs.writeFile(path.join(output, 'unlisted.txt'), 'must not publish');
  await assert.rejects(buildSiteOrders(output), /Unexpected build output: unlisted.txt/);
  assert.equal(await read('unlisted.txt'), 'must not publish');
});
