import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const clients = ['app.js', 'app.legacy.js'].map(name => fs.readFileSync(new URL('../../site/' + name, import.meta.url), 'utf8'));
function historyHarness({installed = false, embedded = false, legacy = false, unavailable = false} = {}) {
  const client = clients[legacy ? 1 : 0];
  const start = client.indexOf('  var siteNavOwner =');
  const renderStart = client.indexOf('  function render()', start);
  const tail = client.slice(renderStart), renderEnd = tail.search(/\n  if\s*\(mobileHost\)\s*window\.PanelStockMobileOrdersCapture/);
  assert.ok(start >= 0 && renderStart > start && renderEnd > 0);
  const listeners = {}, rootHandlers = {}, captures = [], loads = [];
  const entries = [{outside: true}, null]; let position = 1;
  const copy = value => JSON.parse(JSON.stringify(value));
  const history = {
    get state() { return entries[position]; },
    replaceState(state) { entries[position] = copy(state); },
    pushState(state) { entries.splice(position + 1); entries.push(copy(state)); position++; },
    back() { if (position > 0) { position--; listeners.popstate({state: entries[position]}); } },
    forward() { if (position + 1 < entries.length) { position++; listeners.popstate({state: entries[position]}); } }
  };
  const root = {innerHTML: '', addEventListener: (name, handler) => rootHandlers[name] = handler};
  const window = {history: unavailable ? undefined : history, matchMedia: () => ({matches: installed}),
    addEventListener: (name, handler) => listeners[name] = handler};
  const context = {editorReady:true,window, navigator: {}, document: {querySelectorAll: () => []}, root, captures, loads, embedded,
    captureOrderTypeCorrection() {}, captureGateProgress() {}, capturePanelDrawing() {}, captureOrderDelivery() {}, captureComment() {}, captureReceipt() {},
    captureDraft: () => captures.push(vm.runInContext('view', context)),
    shell: content => content, wire() {}, wireOrders() {}, wireCnc() {}, wireSupport() {},
    loginScreen: () => { root.innerHTML = 'login'; },
    orderAlertsView: () => 'notifications', cloudDraftView: () => 'drafts', orderAttentionView: () => 'order-attention',
    newOrder: () => 'new', orderDetails: () => 'order', cncView: () => 'cnc', supportView: () => 'support',
    settingsView: () => 'settings', orderList: () => 'orders',
    loadNotificationOrder: id => loads.push(['order', id]), loadOrderHistory: id => loads.push(['history', id]),
    loadProductionProgress: id => loads.push(['production', id])};
  vm.createContext(context);
  vm.runInContext(`
    var mobileHost=embedded,session={username:'alice',token:'secret-token'},view='orders',selectedOrderId='',supportSelected='',orderReturnView='orders';
    var orderDraft={id:'draft-1',fields:{siteContact:'Unsaved contact'},attachments:[{id:'local-photo'}]},draftOwner='alice';
    var message='',discardDraftArmed=false,clearNotificationsArmed=false,historyState={},productionState={},commentVisibleId='';
    var orders=[{id:'one'},{id:'two'}],pending=[],permissions={};
    function pendingOrders(){return pending;}
    function can(task){return permissions[task]!==false;}
  ` + client.slice(start, renderStart) + tail.slice(0, renderEnd) + `
    globalThis.ui={render:render,go:function(next,fields){if(fields)Object.assign(globalThis,fields);view=next;render();},
      snapshot:function(){return {view:view,orderId:selectedOrderId,supportId:supportSelected,draft:orderDraft};},
      logout:function(){session=null;render();},login:function(username,access){session={username:username};permissions=access||{};view='orders';render();},
      discard:function(){orderDraft=null;},pending:function(id){pending=[{id:id}];}};
  `, context);
  const ui = context.ui;
  ui.render();
  return {ui, history, entries, captures, loads, root, rootHandlers, snapshot: () => copy(ui.snapshot()),
    position: () => position, emit: state => listeners.popstate({state})};
}

for (const legacy of [false, true]) {
  test(`${legacy ? 'legacy' : 'modern'} phone Back and Forward follow visited screens without reloads or duplicate refresh entries`, () => {
    const h = historyHarness({installed: true, legacy});
    h.ui.go('cnc'); h.ui.go('support'); h.ui.go('settings');
    const count = h.entries.length; h.ui.render(); h.ui.render(); assert.equal(h.entries.length, count);
    for (const expected of ['support', 'cnc', 'orders']) { h.history.back(); assert.equal(h.snapshot().view, expected); }
    h.history.forward(); assert.equal(h.snapshot().view, 'cnc');
    assert.equal(h.history.state.owner, 'alice');
    assert.ok(!JSON.stringify(h.entries).includes('secret-token'));
    assert.ok(!JSON.stringify(h.entries).includes('Unsaved contact'));
  });
}

test('Back restores the selected order and returns to its search/notification screen', () => {
  const h = historyHarness(); h.ui.go('order-search');
  h.ui.go('order', {selectedOrderId: 'one', orderReturnView: 'order-search'});
  h.ui.go('order', {selectedOrderId: 'two'});
  h.history.back(); assert.equal(h.snapshot().orderId, 'one'); assert.equal(h.snapshot().view, 'order');
  assert.deepEqual(h.loads, [['history', 'one'], ['production', 'one']]);
  h.history.back(); assert.equal(h.snapshot().view, 'order-search');
  h.ui.go('notifications'); h.ui.go('order', {selectedOrderId: 'one', orderReturnView: 'notifications'});
  h.history.back(); assert.equal(h.snapshot().view, 'notifications');
});

test('ticket details have their own history entries', () => {
  const h = historyHarness(); h.ui.go('support'); h.ui.go('support', {supportSelected: 'ticket-1'});
  h.ui.go('support', {supportSelected: 'ticket-2'}); h.history.back();
  assert.equal(h.snapshot().supportId, 'ticket-1'); h.history.back(); assert.equal(h.snapshot().supportId, '');
});

test('Back captures the outgoing form and keeps the unfinished draft and its attachments for Forward', () => {
  const h = historyHarness(); h.ui.go('new'); const draft = h.snapshot().draft;
  h.captures.length = 0; h.history.back();
  assert.equal(h.captures[0], 'new'); assert.equal(h.snapshot().view, 'orders');
  h.history.forward(); assert.equal(h.snapshot().view, 'new'); assert.deepEqual(h.snapshot().draft, draft);
  h.history.back(); h.ui.discard(); h.history.forward(); assert.equal(h.snapshot().view, 'drafts');
});

test('Back at the first installed screen stays on Home while an ordinary browser keeps its normal exit', () => {
  const app = historyHarness({installed: true}); const count = app.entries.length;
  for (let n = 0; n < 3; n++) { app.history.back(); assert.equal(app.snapshot().view, 'orders'); assert.equal(app.history.state.guard, false); }
  assert.equal(app.entries.length, count); assert.equal(app.history.state.step, 0);
  const browser = historyHarness(); browser.history.back(); assert.equal(browser.position(), 0); assert.deepEqual(browser.history.state, {outside: true});
});

test('the app Back button consumes its previous entry instead of pushing a loop', () => {
  const h = historyHarness(); h.ui.go('order-search'); h.ui.go('order', {selectedOrderId: 'one'});
  const count = h.entries.length; let prevented = false, stopped = false;
  const button = {hasAttribute: name => name === 'data-order-results', parentNode: h.root};
  h.rootHandlers.click({target: button, preventDefault: () => prevented = true, stopPropagation: () => stopped = true});
  assert.equal(prevented && stopped, true); assert.equal(h.snapshot().view, 'order-search');
  assert.equal(h.entries.length, count); h.history.back(); assert.equal(h.snapshot().view, 'orders');
});

test('logout and changed permissions cannot revive an earlier account or a forbidden order screen', () => {
  const h = historyHarness({installed: true}); h.ui.go('order', {selectedOrderId: 'one'});
  const oldEntry = JSON.parse(JSON.stringify(h.history.state)); h.ui.logout(); assert.equal(h.root.innerHTML, 'login');
  h.ui.login('bob', {'site.orders.view': false, 'site.cnc.view': true}); h.emit(oldEntry);
  assert.equal(h.snapshot().view, 'cnc'); assert.equal(h.snapshot().orderId, ''); assert.equal(h.history.state.owner, 'bob');
  assert.deepEqual(h.loads, []);
  h.emit({panelstockSite: 1, owner: 'bob', screen: {view: 'order', orderId: 'one'}, step: 1});
  assert.equal(h.snapshot().view, 'cnc'); assert.deepEqual(h.loads, []);
});

test('embedded Site Orders leave the main mobile app history alone and old browser mocks remain supported', () => {
  for (const options of [{embedded: true}, {unavailable: true}]) {
    const h = historyHarness(options); h.ui.go('cnc'); h.ui.go('support');
    assert.deepEqual(h.entries, [{outside: true}, null]);
  }
});

test('a locally queued order stays local when restored via Back', () => {
  const h = historyHarness(); h.ui.pending('local-order'); h.ui.go('order', {selectedOrderId: 'local-order'});
  h.ui.go('cnc'); h.history.back(); assert.equal(h.snapshot().orderId, 'local-order'); assert.deepEqual(h.loads, []);
});
