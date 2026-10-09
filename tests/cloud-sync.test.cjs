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

async function harness(options = {}) {
  const ready = deferred();
  const events = [];
  const notifications = [];
  const storage = new Map(Object.entries(options.storage || {}));
  const remote = {
    app_settings: [{ user_id: 'u1', store_name: 'Loja', default_fee: 6, next_delivery_code: 6, active_business_date: '2026-10-04' }],
    couriers: [{ user_id: 'u1', id: 'c1', name: 'Entregador', fee: 6, active: true }],
    deliveries: Array.from({ length: 5 }, (_, index) => delivery(`d${index + 1}`, `2026-10-0${index + 4}`)),
    daily_closings: [], delivery_tombstones: []
  };
  const calls = [];
  if (options.remote) options.remote(remote);
  let hook = options.hook || (async () => undefined);
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
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => { options.storageWrite?.(key); storage.set(key, value); }, removeItem: key => storage.delete(key) },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    SESSION_KEY: 'session', LOGIN_EMAIL_KEY: 'email',
    db: options.local || { settings: {}, couriers: [], deliveries: [], closings: [] },
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
  assert.strictEqual(reads, 1, 'Uma falha de envio ainda deve permitir receber os dados do banco');
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

function localDelivery(row) {
  return { id: row.id, code: row.code, client: row.client, phone: row.phone, address: row.address, reference: row.reference,
    courierId: row.courier_id, fee: row.fee, orderValue: row.order_value, payment: row.payment, changeFor: '', notes: row.notes,
    status: row.status, createdAt: row.created_at, updatedAt: row.updated_at, businessDate: row.business_date, paymentConfirmedAt: '' };
}

function closedDays(remote) {
  remote.app_settings[0].active_business_date = '2026-10-09';
  remote.daily_closings = ['2026-10-04', '2026-10-08'].map(date => ({ user_id: 'u1', date,
    closed_at: '2026-10-09T21:32:00Z', details_v2: { totalDeliveries: 1 },
    delivery_snapshot_v1: remote.deliveries.filter(row => row.business_date === date).map(localDelivery) }));
}

test('inicialização recupera duas alterações antigas e recebe os dias 04 e 08 já fechados', async () => {
  const stale = localDelivery(delivery('d5', '2026-10-08'));
  stale.status = 'Aguardando';
  stale.updatedAt = '2026-10-09T23:00:00Z';
  const local = { settings: { storeName: 'Loja', defaultFee: 6, activeBusinessDate: '2026-10-04' }, couriers: [],
    deliveries: [stale], closings: [{ date: '2026-10-04', detailsV2: { totalDeliveries: 999 } }] };
  const queued = { upserts: { deliveries: { d5: 'r1' }, closings: { '2026-10-04': 'r2' } } };
  const h = await harness({ local, remote: closedDays, storage: { xb_cloud_queue_v2_u1: JSON.stringify(queued) },
    hook: async query => ['deliveries', 'daily_closings'].includes(query.table) && query.op !== 'select'
      ? { error: { message: 'O dia já foi finalizado' } } : undefined });
  assert.strictEqual(h.context.XBCloud.pendingChanges, 0);
  assert.strictEqual(h.context.XBCloud.state.lastError, '');
  assert.strictEqual(h.context.db.settings.activeBusinessDate, '2026-10-09');
  assert.deepStrictEqual(Array.from(h.context.db.closings, item => item.date), ['2026-10-04', '2026-10-08']);
  assert.strictEqual(h.context.db.deliveries.find(item => item.id === 'd5').status, 'Entregue');
  const recovery = h.context.XBCloud.recoveryData();
  assert.strictEqual(recovery.entries.length, 2);
  assert.strictEqual(recovery.entries.find(item => item.key === 'd5').local.status, 'Aguardando');
  assert.strictEqual(recovery.entries.find(item => item.key === 'd5').remote.status, 'Entregue');
  assert.strictEqual(recovery.entries.find(item => item.type === 'closings').local.detailsV2.totalDeliveries, 999);
  assert.strictEqual(JSON.parse(h.storage.get('xb_cloud_recovery_v1_u1')).entries.length, 2);
  assert(!h.calls.some(call => ['deliveries', 'daily_closings'].includes(call.table) && call.op !== 'select'));
  assert(!h.calls.some(call => /reopen|finalize/.test(call.rpc || '')));
});

test('exclusões antigas não apagam uma entrega nem reabrem um dia fechado', async () => {
  const h = await harness({ remote: closedDays, storage: { xb_cloud_queue_v2_u1: JSON.stringify({
    deletes: { deliveries: { d1: 'r1' }, closings: { '2026-10-04': 'r2' } } }) } });
  assert.strictEqual(h.context.XBCloud.pendingChanges, 0);
  assert(h.context.db.closings.some(item => item.date === '2026-10-04'));
  assert(h.context.db.deliveries.some(item => item.id === 'd1'));
  assert(h.remote.daily_closings.some(item => item.date === '2026-10-04'));
  assert(h.remote.deliveries.some(item => item.id === 'd1'));
  assert(!h.calls.some(call => call.rpc === 'xb_delete_delivery' || call.rpc === 'xb_reopen_day'));
  assert.strictEqual(h.context.XBCloud.recoveryData().entries.length, 2);
});

test('sem espaço para a cópia de recuperação, o conflito permanece local e na fila', async () => {
  let fail = false;
  const h = await harness({ storageWrite: key => { if (fail && key.startsWith('xb_cloud_recovery_v1_')) throw new Error('QuotaExceededError'); } });
  closedDays(h.remote);
  h.context.db.deliveries[0].orderValue = 99;
  h.context.save();
  fail = true;
  assert.strictEqual(await h.context.XBCloud.syncNow(), false);
  assert(h.context.XBCloud.pendingChanges > 0);
  assert.strictEqual(h.context.db.deliveries[0].orderValue, 99);
  assert.strictEqual(h.remote.deliveries[0].order_value, 30);
  assert.match(h.context.XBCloud.state.lastError, /preservar/);
  fail = false;
  assert.strictEqual(await h.context.XBCloud.syncNow(), true);
  assert.strictEqual(await h.context.XBCloud.pullNow(), true);
  assert.strictEqual(h.context.XBCloud.recoveryData().entries[0].local.orderValue, 99);
  assert.strictEqual(h.context.XBCloud.pendingChanges, 0);
});

test('envio rejeitado em dia aberto não bloqueia a leitura dos fechamentos nem perde a edição', async () => {
  const local = { settings: { storeName: 'Loja', defaultFee: 6 }, couriers: [],
    deliveries: [{ ...localDelivery(delivery('d2', '2026-10-05')), orderValue: 99 }], closings: [] };
  const h = await harness({ local, remote: closedDays, storage: { xb_cloud_queue_v2_u1: JSON.stringify({ upserts: { deliveries: { d2: 'r1' } } }) },
    hook: async query => query.op === 'upsert' ? { error: { message: 'Falha de escrita no banco' } } : undefined });
  assert.strictEqual(h.context.db.closings.length, 2);
  assert.strictEqual(h.context.db.deliveries.find(item => item.id === 'd2').orderValue, 99);
  assert.strictEqual(h.context.XBCloud.pendingChanges, 1);
  assert.strictEqual(h.context.XBCloud.state.lastError, 'Falha de escrita no banco');
  assert.strictEqual(await h.context.XBCloud.pullNow(), false);
  assert.strictEqual(h.context.db.closings.length, 2);
  assert.strictEqual(h.context.db.deliveries.find(item => item.id === 'd2').orderValue, 99);
  assert.strictEqual(h.context.XBCloud.recoveryData().entries.length, 0);
});

test('novo pedido vinculado a dia fechado é preservado integralmente para conferência', async () => {
  const h = await harness({ remote: closedDays });
  const local = { ...h.context.db.deliveries[0], id: 'd6', code: 6, client: 'Novo cliente', orderValue: 57 };
  h.context.db.deliveries.push(local);
  h.context.save();
  assert.strictEqual(await h.context.XBCloud.syncNow(), true);
  assert(!h.remote.deliveries.some(item => item.id === 'd6'));
  const saved = h.context.XBCloud.recoveryData().entries.find(item => item.key === 'd6');
  assert.strictEqual(saved.local.orderValue, 57);
  assert.strictEqual(saved.local.client, 'Novo cliente');
  assert.strictEqual(saved.remote, null);
  assert(h.notifications.some(item => /preservadas/.test(item.message)));
});
