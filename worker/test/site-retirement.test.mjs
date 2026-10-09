import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const destination = 'https://site.panelstockhq.com/';
const origin = 'https://app.panelstockhq.com';
const source = file => fs.readFileSync(new URL('../../' + file, import.meta.url), 'utf8');

for (const file of ['site/index.html', 'site-orders/index.html']) {
  test(file + ' replaces the old page without forwarding private URL data', () => {
    const html = source(file), redirects = [];
    assert.ok(html.includes('content="0;url=' + destination + '"'));
    assert.ok(html.includes('rel="canonical" href="' + destination + '"'));
    assert.ok(html.includes('name="referrer" content="no-referrer"'));
    assert.doesNotMatch(html, /app-loader|manifest.webmanifest/);
    const scripts = [...html.matchAll(/<script>([^]*?)<\/script>/g)];
    assert.equal(scripts.length, 1);
    vm.runInNewContext(scripts[0][1], {window: {location: {
      search: '?token=private', hash: '#private', replace: url => redirects.push(url)
    }}});
    assert.deepEqual(redirects, [destination]);
  });
}

test('cached old pages redirect before loading a client while new-domain clients still boot', () => {
  for (const hostname of ['app.panelstockhq.com', 'site.panelstockhq.com', 'localhost']) {
    for (const userAgent of ['', 'iPhone OS 10_3 Version/10']) {
      const redirects = [], scripts = [];
      vm.runInNewContext(source('site/app-loader.js'), {
        window: {location: {hostname, replace: url => redirects.push(url)}},
        navigator: {userAgent},
        document: {createElement: () => ({}), body: {appendChild: script => scripts.push(script)}}
      });
      if (hostname === 'app.panelstockhq.com') {
        assert.deepEqual(redirects, [destination]);
        assert.equal(scripts.length, 0);
      } else {
        assert.equal(redirects.length, 0);
        assert.equal(scripts.length, 1);
        assert.equal(scripts[0].src, userAgent ? 'app.legacy.js?v=required-fields-20261009' : 'app.js?v=required-fields-20261009');
      }
    }
  }
});

function retirementHarness(workerOrigin = origin) {
  const handlers = {}, removed = [], navigated = [];
  let claimed = false, skipped = false;
  const urls = [origin + '/site/?token=private#fragment', origin + '/site-orders/',
    origin + '/', origin + '/index.html', origin + '/site-settings/', destination, origin + '/site/closing'];
  const clients = {
    claim: async () => {claimed = true;},
    matchAll: async options => {
      assert.equal(options.type, 'window');
      assert.equal(options.includeUncontrolled, true);
      return urls.map(url => ({url, navigate: async target => {
        if (url.endsWith('/closing')) throw Error('Tab closed');
        navigated.push({from: url, to: target});
      }}));
    }
  };
  vm.runInNewContext(source('site/sw.js'), {URL, Response,
    caches: {
      keys: async () => ['panelstock-site-v33', 'panelstock-site-v34', 'panelstock-shell-v2', 'unrelated-cache'],
      delete: async key => {removed.push(key); return true;}
    },
    self: {location: new URL(workerOrigin), clients, skipWaiting: async () => {skipped = true;},
      addEventListener: (event, handler) => handlers[event] = handler}
  });
  return {removed, navigated, claimed: () => claimed, skipped: () => skipped,
    dispatch: async (event, request) => {
      const pending = []; let response;
      handlers[event]({request, waitUntil: value => pending.push(value), respondWith: value => response = value});
      await Promise.all(pending); return await response;
    }};
}

test('retirement updates old shortcuts and removes only obsolete Site Orders caches', async () => {
  const h = retirementHarness();
  await h.dispatch('install'); await h.dispatch('activate');
  assert.equal(h.skipped(), true); assert.equal(h.claimed(), true);
  assert.deepEqual(h.removed, ['panelstock-site-v33', 'panelstock-site-v34']);
  assert.deepEqual(h.navigated, [
    {from: origin + '/site/?token=private#fragment', to: destination},
    {from: origin + '/site-orders/', to: destination}
  ]);
  assert.doesNotMatch(source('site/sw.js'), /localStorage|sessionStorage|indexedDB|unregister\(/);
});

test('retirement redirects only old page navigation, not APIs, posts, assets or other apps', async () => {
  const h = retirementHarness();
  const request = (url, overrides = {}) => ({url, mode: 'navigate', method: 'GET', ...overrides});
  for (const path of ['/site', '/site/', '/site/index.html?token=private', '/site-orders/']) {
    const response = await h.dispatch('fetch', request(origin + path));
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('Location'), destination);
  }
  for (const value of [
    request(origin + '/site/', {method: 'POST'}),
    request(origin + '/site/cnc', {mode: 'cors'}),
    request(origin + '/site/app.js', {mode: 'no-cors'}),
    request(origin + '/'), request(origin + '/site-settings/'),
    request(destination), request('https://api.example/site/cnc')
  ]) assert.equal(await h.dispatch('fetch', value), undefined);
});

test('retirement cannot clear caches or navigate tabs on the new origin', async () => {
  const h = retirementHarness(destination);
  await h.dispatch('activate');
  assert.deepEqual(h.removed, []);
  assert.deepEqual(h.navigated, []);
  assert.equal(h.claimed(), false);
});
