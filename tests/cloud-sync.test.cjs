const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const { test } = require('node:test');

const clone = value => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const tick = () => new Promise(resolve => setImmediate(resolve));
const delivery = (id = 'd1', day = '2026-10-04') => ({
  user_id: 'u1', id, code: Number(id.slice(1)) || 1, client: 'Cliente', phone: '',
  address: 'Rua de teste', reference: '', courier_id: 'c1', fee: 6, order_value: 30,
  payment: 'PIX', change_for: null, notes: '', status: 'Entregue',
  created_at: `${day}T18:00:00Z`, updated_at: `${day}T18:00:00Z`, business_date: day
});

async function harness() {
  const ready = deferred();
  const events = [];
  const notifications = [];
  const storage = new Map();
  const remote = {
    app_settings: [{ user_id: 'u1', store_name: 'Loja', default_fee: 6, next_delivery_code: 6, active_business_date: '2026-10-04' }],
    couriers: [{ user_id: 'u1', id: 'c1', name: 'Entregador', fee: 6, active: true }],
    deliveries: Array.from({ length: 5 }, (_, index) => delivery(`d${index + 1}`, `2026-10-0${index + 4}`)),
    daily_closings: [], delivery_tombstones: []
  };
  const calls = [];
  let hook = async () => undefined;
  class Query {
    constructor(table) { this.table = table; this.op = 'select'; this.filters = []; this.start = 0; this.end = Infinity; }
    select() { return this; }
    eq(key, value) { this.filters.push(row => row[key] === value); return this; }
    in(key, values) { this.filters.push(row => values.includes(row[key])); return this; }
    order() { return this; }
    range(start, end) { this.start = start; this.end = end; return this; }
    maybeSingle() { this.single = true; return this; }
    update(payload) { this.op = 'update'; this.payload = payload; return this; }
    insert(payload) { this.op = 'insert'; this.payload = payload; return this; }
    upsert(payload) { this.op = 'upsert'; this.payload = payload; return this; }
    delete() { this.op = 'delete'; return this; }
    then(resolve, reject) { return this.execute().then(resolve, reject); }
    async execute() {
      calls.push({ table: this.table, op: this.op, payload: clone(this.payload || null) });
      const selected = clone((remote[this.table] || []).filter(row => this.filters.every(filter => filter(row))).slice(this.start, this.end + 1));
      const override = await hook(this, selected);
      if (override) return override;
      if (this.op === 'upsert' || this.op === 'insert') {
        for (const row of Array.isArray(this.payload) ? this.payload : [this.payload]) {
          const key = this.table === 'daily_closings' ? 'date' : 'id';
          const index = remote[this.table].findIndex(item => item[key] === row[key]);
          if (index < 0) remote[this.table].push(clone(row));
          else remote[this.table][index] = clone(row);
        }
      } else if (this.op === 'update') {
        remote[this.table].filter(row => this.filters.every(filter => filter(row))).forEach(row => Object.assign(row, this.payload));
      } else if (this.op === 'delete') {
        remote[this.table] = remote[this.table].filter(row => !this.filters.every(filter => filter(row)));
      }
      return { data: this.single ? (selected[0] || null) : selected, error: null };
    }
  }
  const client = {
    from: table => new Query(table),
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }),
      onAuthStateChange() {}
    },
    async rpc(name, args) {
      calls.push({ rpc: name, args });
      if (name === 'xb_delete_delivery') {
        remote.deliveries = remote.deliveries.filter(row => row.id !== args.p_id);
      }
      if (name === 'xb_finalize_day_explicit') {
        const rows = context.db.deliveries.filter(item => item.businessDate === args.p_date);
        const C = context.XBClosingContinuity;
        remote.daily_closings.push({ user_id: 'u1', date: args.p_date, closed_at: '2026-10-09T16:00:00Z',
          details_v2: clone(C.buildDetails(rows)), delivery_snapshot_v1: clone(C.expectedSnapshot(rows)) });
      }
      return { data: true, error: null };
    }
  };
  const context = {
    console: { info() {}, warn() {}, error() {} }, Date, Intl, Promise, Math,
    setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; },
    requestAnimationFrame() {}, queueMicrotask() {}, navigator: { onLine: true },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    SESSION_KEY: 'session', LOGIN_EMAIL_KEY: 'email',
    db: { settings: {}, couriers: [], deliveries: [], closings: [] },
    initialDB: () => ({ settings: { storeName: 'Loja', defaultFee: 6 }, couriers: [], deliveries: [], closings: [] }),
    save() {}, renderAll() {}, showApp() {}, refreshIcons() {}, icon: () => '',
    toast: (message, type) => notifications.push({ message, type }),
    dateKey: () => '2026-10-09',
    document: { hidden: false, getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; }, addEventListener() {},
      createElement() { return { appendChild() {}, addEventListener() {} }; }, head: { appendChild() {} } },
    addEventListener() {},
    dispatchEvent(event) { events.push(event); if (event.type === 'xb:cloud-ready') ready.resolve(); },
    CustomEvent: function (type, options) { this.type = type; this.detail = options?.detail; },
    XB_SUPABASE_CONFIG: { enabled: true, projectUrl: 'https://example.supabase.co', publishableKey: 'test', autoSync: true, realtime: false, autoMigrateLocalData: false },
    supabase: { createClient: () => client }
  };
  context.window = context;
  vm.createContext(context);
  const load = name => vm.runInContext(fs.readFileSync(name, 'utf8'), context, { filename: name });
  load('database-cloud-v2.js');
  await ready.promise;
  return { context, remote, calls, events, notifications, storage, load, hook: fn => { hook = fn; } };
}

test('sincronização manual aguarda o envio em andamento e esvazia novas revisões', async () => {
  const h = await harness();
  // Duas gravações podem ocorrer no mesmo milissegundo: a versão da fila deve
  // distingui-las para que a confirmação antiga não descarte a edição nova.
  h.context.Date = class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-10-09T16:00:00Z'])); }
  };
  const entered = deferred();
  const release = deferred();
  let blocked = false;
  h.hook(async query => {
    if (query.op === 'upsert' && query.table === 'deliveries' && !blocked) {
      blocked = true;
      entered.resolve();
      await release.promise;
    }
  });
  h.context.db.deliveries[0].orderValue = 35;
  h.context.save();
  const first = h.context.XBCloud.syncNow();
  await entered.promise;
  h.context.db.deliveries[0].orderValue = 40;
  h.context.db.deliveries[0].updatedAt = '2026-10-09T16:01:00Z';
  h.context.save();
  let settled = false;
  const second = h.context.XBCloud.syncNow().then(value => { settled = true; return value; });
  await tick();
  const returnedEarly = settled;
  release.resolve();
  await first;
  assert.strictEqual(await second, true);
  assert.strictEqual(returnedEarly, false, 'Não deve falhar só porque outro envio está em andamento');
  assert.strictEqual(h.context.XBCloud.pendingChanges, 0);
  assert.strictEqual(h.remote.deliveries[0].order_value, 40);
});

test('edições, inclusões e exclusões feitas durante um pull permanecem na tela e na fila', async () => {
  const h = await harness();
  const entered = deferred();
  const release = deferred();
  h.hook(async query => {
    if (query.table === 'deliveries' && query.op === 'select') { entered.resolve(); await release.promise; }
  });
  const pull = h.context.XBCloud.pullNow();
  await entered.promise;
  h.context.db.deliveries[0].orderValue = 47;
  h.context.db.deliveries = h.context.db.deliveries.filter(item => item.id !== 'd2');
  h.context.db.deliveries.push({ ...h.context.db.deliveries[0], id: 'd6', code: 6 });
  h.context.db.couriers[0].name = 'Nome editado';
  h.context.db.settings.storeName = 'Loja editada';
  h.context.save();
  release.resolve();
  await pull;
  assert.strictEqual(h.context.db.deliveries.find(item => item.id === 'd1').orderValue, 47);
  assert(!h.context.db.deliveries.some(item => item.id === 'd2'));
  assert(h.context.db.deliveries.some(item => item.id === 'd6'));
  assert.strictEqual(h.context.db.couriers[0].name, 'Nome editado');
  assert.strictEqual(h.context.db.settings.storeName, 'Loja editada');
  assert(h.context.XBCloud.pendingChanges > 0);
  h.hook(async () => undefined);
  assert.strictEqual(await h.context.XBCloud.syncNow(), true);
  assert.strictEqual(h.remote.deliveries.find(item => item.id === 'd1').order_value, 47);
  assert(!h.remote.deliveries.some(item => item.id === 'd2'));
});

test('uma entrega idêntica ao banco não é regravada em um dia fechado', async () => {
  const h = await harness();
  h.hook(async query => query.op === 'upsert' && query.table === 'deliveries'
    ? { data: null, error: { message: 'O dia 2026-10-04 já foi finalizado' } } : undefined);
  h.context.db.deliveries[0].updatedAt = '2026-10-09T16:00:00Z';
  h.context.save();
  assert.strictEqual(await h.context.XBCloud.syncNow(), true);
  assert.strictEqual(h.context.XBCloud.pendingChanges, 0);
  assert(!h.calls.some(call => call.table === 'deliveries' && call.op === 'upsert'));
});

test('falha no banco preserva alterações pendentes e o motivo do erro', async () => {
  const h = await harness();
  h.hook(async query => query.op === 'upsert' ? { data: null, error: { message: 'Falha de teste no banco' } } : undefined);
  h.context.db.deliveries[0].orderValue = 55;
  h.context.save();
  assert.strictEqual(await h.context.XBCloud.syncNow(), false);
  assert(h.context.XBCloud.pendingChanges > 0);
  assert.strictEqual(h.context.XBCloud.state.lastError, 'Falha de teste no banco');
  assert.strictEqual(h.context.db.deliveries[0].orderValue, 55);
});

test('reparo automático de taxas preserva entregas de dias já fechados', async () => {
  const h = await harness();
  h.context.db.closings = [{ date: '2026-10-04' }];
  h.context.db.deliveries[0].fee = 0;
  h.context.db.deliveries[1].fee = 0;
  h.load('courier-fee-consistency.js');
  h.context.XBCourierFeeConsistency.repair();
  assert.strictEqual(h.context.db.deliveries[0].fee, 0);
  assert.strictEqual(h.context.db.deliveries[1].fee, 6);
  h.load('system-integrity-v3.js');
  h.context.XBSystemIntegrity.repair();
  assert.strictEqual(h.context.db.deliveries[0].fee, 0, 'A segunda barreira de integridade também preserva dias fechados');
});

test('fechamento de 04 a 08/10 só é confirmado depois de leitura bem-sucedida do banco', async () => {
  const h = await harness();
  h.load('closing-continuity.js');
  const C = h.context.XBClosingContinuity;
  for (const day of ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08']) {
    const rows = h.context.db.deliveries.filter(item => item.businessDate === day);
    h.context.db.closings.push({ date: day, detailsV2: C.buildDetails(rows), deliverySnapshotV1: C.expectedSnapshot(rows) });
    h.context.XBCloud.pullNow = async () => false;
    await assert.rejects(C.finalizeDay(day), /conferir|confirmar|receber/i);
  }
});

test('reabertura não informa sucesso quando a conferência do banco falha', async () => {
  const h = await harness();
  h.load('closing-continuity.js');
  h.context.XBCloud.pullNow = async () => false;
  await assert.rejects(h.context.XBClosingContinuity.reopenDay('2026-10-04'), /conferir|confirmar|receber/i);
});

test('dias anteriores são finalizados pelo RPC e conferidos individualmente', async () => {
  const h = await harness();
  h.load('closing-continuity.js');
  for (const day of ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08']) {
    await h.context.XBClosingContinuity.finalizeDay(day);
    const closing = h.context.db.closings.find(item => item.date === day);
    assert(closing, `Fechamento de ${day} deve voltar do banco`);
    assert.strictEqual(h.context.XBClosingContinuity.needsRepair(closing), false);
    assert.strictEqual(closing.detailsV2.totalDeliveries, 1);
    assert.strictEqual(closing.deliverySnapshotV1[0].businessDate, day);
  }
  assert.deepStrictEqual(h.calls.filter(call => call.rpc === 'xb_finalize_day_explicit').map(call => call.args.p_date),
    ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08']);
});

test('botão manual mostra o erro real e nunca anuncia sucesso após falha', async () => {
  const h = await harness();
  let onClick;
  let reads = 0;
  const actions = { prepend() {} };
  h.context.document.querySelector = selector => selector === '#databaseReadinessCard .db-actions' ? actions : null;
  h.context.document.createElement = () => ({ addEventListener(name, fn) { if (name === 'click') onClick = fn; } });
  h.context.XBCloud.state.lastError = 'Entrega recusada pelo banco';
  h.context.XBCloud.syncNow = async () => false;
  h.context.XBCloud.pullNow = async () => { reads += 1; return true; };
  h.load('system-production-v2.js');
  assert(onClick, 'Botão de sincronização precisa ser instalado');
  await onClick();
  assert.strictEqual(reads, 0);
  assert.strictEqual(h.notifications.at(-1).message, 'Entrega recusada pelo banco');
  assert.strictEqual(h.notifications.at(-1).type, 'error');
  assert(!h.notifications.some(item => item.message === 'Sincronização concluída.'));
  h.context.XBCloud.state.lastError = '';
  h.context.XBCloud.syncNow = async () => true;
  h.context.XBCloud.pullNow = async () => false;
  await onClick();
  assert.strictEqual(h.notifications.at(-1).type, 'error');
  h.context.XBCloud.pullNow = async () => true;
  await onClick();
  assert.strictEqual(h.notifications.at(-1).message, 'Sincronização concluída.');
});
