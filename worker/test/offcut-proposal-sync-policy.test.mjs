import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';

const {Outbox} = createRequire(import.meta.url)('../../panelstock-client.modern.js');
const app = fs.readFileSync(new URL('../../panelstock-app.modern.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const labels = fs.readFileSync(new URL('../../offcut-labels.js', import.meta.url), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const change = (field, previous, next) => ({field, id: next?.id || previous.id, before: previous, after: next});
const packet = changes => ({mutationId: randomUUID(), restoreEpoch: 0, changes});
let mf, admin, sequence = 0;

function source(name, indent = 2) {
  const prefix = ' '.repeat(indent) + 'function ' + name + '(';
  const start = app.indexOf(prefix);
  assert.ok(start >= 0, 'Production function is present: ' + name);
  const next = new RegExp('\\n {0,' + indent + '}function [\\w$]+\\(', 'g');
  next.lastIndex = start + prefix.length;
  return app.slice(start, next.exec(app)?.index ?? app.length);
}

const scheduling = [
  ['normalizeCncInput', 0], ['cncDuplicateKey', 0], ['cncDuplicateError', 0],
  ['cncSheetKey', 0], ['cncPdfImportPlan', 0], ['cncReservedSheets', 2],
  ['cncOffcutError', 2], ['validateCncSchedule', 4],
  ['printScheduledOffcutLabels', 4], ['addCncPanel', 4], ['addCncPanelsBulk', 4]
].map(([name, indent]) => source(name, indent)).join('\n');

async function request(route, body, token = admin) {
  const response = await mf.dispatchFetch('http://localhost' + route, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {'Content-Type': 'application/json', ...(token ? {Authorization: 'Bearer ' + token} : {})},
    ...(body === undefined ? {} : {body: JSON.stringify(body)})
  });
  return {status: response.status, body: await response.json()};
}

before(async () => {
  mf = new Miniflare(convertV4MiniflareOptions({workers: [{
    name: 'offcut-proposal-sync-policy', modules: true,
    script: fs.readFileSync(new URL('../dist/index.js', import.meta.url), 'utf8'),
    compatibilityDate: '2026-08-21', compatibilityFlags: ['nodejs_compat'],
    durableObjects: {INVENTORY: {className: 'InventoryStore', useSQLite: true}},
    kvNamespaces: ['LEGACY_KV'],
    bindings: {SITE_ID: 'offcut-policy-test', MIGRATION_READY: 'true', EMAIL_ENABLED: 'false', ALLOWED_ORIGINS: 'http://localhost:8080'}
  }]}));
  const kv = await mf.getKVNamespace('LEGACY_KV');
  const pinHash = createHash('sha256').update('123456:admin:panelstock').digest('hex');
  await kv.put('users', JSON.stringify({admin: {isAdmin: true, pinHash}}));
  for (const field of ['variants', 'offcuts', 'catalog', 'cncPanels', 'transactions', 'reasons']) await kv.put('app:' + field, '[]');
  await kv.put('app:photos', '{}');
  const login = await request('/login', {username: 'admin', pin: '123456'}, null);
  assert.equal(login.status, 200, JSON.stringify(login.body));
  admin = login.body.token;
  assert.ok(admin);
});
after(async () => { await mf?.dispose(); });

async function seed() {
  const serial = ++sequence;
  const stock = {id: 'stock-' + serial, catalogId: 'catalog-' + serial, sku: 'SHEET-' + serial, color: 'White', material: 'ACM', thickness: 4, width: 4000, height: 1500, qty: 5};
  const proposal = {length: 500, width: 1200, dimensionOrder: 'sheet', status: 'pending', source: 'cnc-pdf', approved: true, labelSku: 'PLANNED-' + serial, labelOffcutId: 'planned-' + serial};
  const common = {jobReference: 'Offcut Policy ' + serial, orderNumber: '838', sheetNumber: '1', status: 'pending', stockItemType: 'variant', stockItemId: stock.id, stockSku: stock.sku, sheetWidth: stock.width, sheetHeight: stock.height, totalPanelArea: 4, panelAreaScope: 'sheet', pdfPage: 1, pdfRevision: 1, uploadedBy: 'admin', uploadedAt: '2026-11-07T00:00:00.000Z', pendingOffcuts: [proposal], pendingOffcut: proposal};
  const first = {...common, id: 'panel-' + serial + '-a', panelNumber: 'A'};
  const sibling = {...common, id: 'panel-' + serial + '-b', panelNumber: 'B'};
  const other = {...common, id: 'panel-' + serial + '-other', panelNumber: 'OTHER', jobReference: 'Unrelated Policy ' + serial};
  const activity = {id: randomUUID(), type: 'cnc', source: 'cnc-pdf', panelRecordIds: [first.id, sibling.id, other.id], desc: 'Synthetic reviewed PDF setup', qty: '', timestamp: new Date().toISOString()};
  const seeded = await request('/mutations', packet([
    change('catalog', null, {...stock, id: stock.catalogId}), change('variants', null, stock),
    ...[first, sibling, other].map(value => change('cncPanels', null, value)), change('transactions', null, activity)
  ]));
  assert.equal(seeded.status, 200, JSON.stringify(seeded.body));
  const snapshot = (await request('/data')).body;
  return {snapshot, stock, first: snapshot.cncPanels.find(value => value.id === first.id), sibling: snapshot.cncPanels.find(value => value.id === sibling.id), other: snapshot.cncPanels.find(value => value.id === other.id)};
}

function scheduleWithProductionOutbox(snapshot, mode, incoming) {
  const data = new Map(), popups = [];
  const storage = {getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value)};
  // Keep the real diff/queue implementation, but submit its packet explicitly below.
  const outbox = new Outbox(storage, async () => new Response('{}', {status: 503}));
  outbox.snapshot(snapshot, 'admin');
  const context = vm.createContext({
    module: {exports: {}}, cncPanels: clone(snapshot.cncPanels), variants: clone(snapshot.variants),
    offcuts: clone(snapshot.offcuts), transactions: clone(snapshot.transactions), username: 'admin',
    uid: randomUUID, genSku: () => 'OFF-' + randomUUID(),
    localStorage: storage, showToast() {},
    persist: values => outbox.stage(clone(values), 'admin', snapshot),
    open() {
      const popup = {document: {open() {}, write() {}, close() {}}, focus() {}, print() {}};
      popups.push(popup); return popup;
    }
  });
  for (const [setter, field] of [['setCncPanels', 'cncPanels'], ['setTransactions', 'transactions']]) context[setter] = value => { context[field] = value; };
  vm.runInContext('globalThis.window=globalThis;', context);
  vm.runInContext(labels, context, {filename: 'offcut-labels.js'});
  vm.runInContext(scheduling, context, {filename: 'production-cnc-scheduling.js'});
  const accepted = mode === 'single' ? context.addCncPanel(incoming) : context.addCncPanelsBulk([incoming], {replacePending: true});
  assert.equal(accepted, true, 'the real frontend accepts the schedule');
  outbox.finalize();
  assert.equal(outbox.state.queue.length, 1);
  return {packet: clone(outbox.state.queue[0]), popups};
}

const ordered = values => [...values].sort((left, right) => String(left.id).localeCompare(String(right.id)));

for (const mode of ['single', 'partial PDF']) for (const withdraw of [false, true]) {
  test(`${mode} ${withdraw ? 'withdrawal' : 'revision'} synchronizes sibling proposals through the real Outbox and Worker mutation policy`, async () => {
    const {snapshot, stock, first, sibling, other} = await seed();
    const proposals = withdraw ? [] : [{...first.pendingOffcuts[0], length: 450}];
    const incoming = {...first, ...(mode === 'single' ? {panelNumber: 'C'} : {}), pendingOffcuts: proposals, pendingOffcut: proposals[0] || null};
    const scheduled = scheduleWithProductionOutbox(snapshot, mode === 'single' ? 'single' : 'pdf', incoming);
    assert.equal(scheduled.popups.length, withdraw ? 0 : 1);
    const edits = scheduled.packet.changes.filter(item => item.field === 'transactions' && item.after?.source === 'cnc-edit');
    const editedIds = new Set(edits.flatMap(item => item.after.panelRecordIds));
    assert.ok(editedIds.has(sibling.id), 'the unchanged-revision sibling is explicitly covered by the edit audit');
    if (mode === 'single') assert.ok(editedIds.has(first.id));
    else assert.ok(scheduled.packet.changes.some(item => item.field === 'transactions' && item.after?.source === 'cnc-pdf' && item.after.panelRecordIds.includes(first.id)));
    assert.ok(scheduled.packet.changes.every(item => !['variants', 'offcuts'].includes(item.field)), 'scheduling has no SOH mutation');

    const unaudited = {...scheduled.packet, mutationId: randomUUID(), changes: scheduled.packet.changes.filter(item => !(item.field === 'transactions' && item.after?.source === 'cnc-edit'))};
    const rejected = await request('/mutations', unaudited);
    assert.equal(rejected.status, 400, JSON.stringify(rejected.body));
    assert.match(rejected.body.error, /CNC editing requires a linked activity record/);
    const afterRejection = (await request('/data')).body;
    assert.deepEqual(ordered(afterRejection.cncPanels), ordered(snapshot.cncPanels), 'a rejected packet writes no panels');
    assert.deepEqual(ordered(afterRejection.transactions), ordered(snapshot.transactions), 'a rejected packet writes no audit fragment');

    const saved = await request('/mutations', scheduled.packet);
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const repeated = await request('/mutations', scheduled.packet);
    assert.equal(repeated.status, 200); assert.equal(repeated.body.duplicate, true);
    const data = (await request('/data')).body;
    const sameSheet = data.cncPanels.filter(value => value.jobReference === first.jobReference && value.sheetNumber === first.sheetNumber);
    assert.equal(sameSheet.length, mode === 'single' ? 3 : 2);
    for (const panel of sameSheet) {
      assert.equal(panel.pendingOffcuts.length, withdraw ? 0 : 1);
      assert.deepEqual(panel.pendingOffcut, panel.pendingOffcuts[0] || null);
      if (!withdraw) {
        assert.equal(panel.pendingOffcuts[0].length, 450);
        assert.equal(panel.pendingOffcuts[0].width, 1200);
      }
    }
    if (!withdraw) assert.equal(new Set(sameSheet.map(value => value.pendingOffcuts[0].labelSku)).size, 1);
    assert.equal(data.cncPanels.find(value => value.id === sibling.id).pdfRevision, sibling.pdfRevision, 'the unlisted sibling is edited without a fake PDF revision');
    assert.equal(data.cncPanels.find(value => value.id === first.id).pdfRevision, mode === 'single' ? first.pdfRevision : first.pdfRevision + 1);
    assert.deepEqual(data.cncPanels.find(value => value.id === other.id), other);
    assert.deepEqual(data.variants.find(value => value.id === stock.id), snapshot.variants.find(value => value.id === stock.id));
    assert.deepEqual(data.offcuts, snapshot.offcuts);
    for (const edit of edits) assert.equal(data.transactions.filter(value => value.id === edit.id).length, 1, 'an idempotent retry keeps one audit record');
  });
}
