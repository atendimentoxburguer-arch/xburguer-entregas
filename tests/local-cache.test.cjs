const fs = require('fs');
const vm = require('vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function engine() {
  const records = new Map();
  let beforeCommit = async () => {};
  const database = {
    createObjectStore() {}, close() {},
    transaction(name, mode) {
      const actions = [];
      const tx = { objectStore: () => ({
        getAllKeys() { const request = {}; actions.push({ op: 'keys', request }); return request; },
        getAll() { const request = {}; actions.push({ op: 'values', request }); return request; },
        put(value, key) { actions.push({ op: 'put', key, value }); },
        delete(key) { actions.push({ op: 'delete', key }); }
      }) };
      setImmediate(async () => {
        try {
          await beforeCommit(mode, actions);
          const next = new Map(records);
          for (const action of actions) {
            if (action.op === 'put') next.set(action.key, action.value);
            if (action.op === 'delete') next.delete(action.key);
            if (action.op === 'keys') action.request.result = [...records.keys()];
            if (action.op === 'values') action.request.result = [...records.values()];
          }
          records.clear();
          for (const [key, value] of next) records.set(key, value);
          tx.oncomplete?.();
        } catch (error) { tx.error = error; tx.onabort?.(); }
      });
      return tx;
    }
  };
  return {
    records,
    hook(fn) { beforeCommit = fn; },
    indexedDB: { open() {
      const request = {};
      setImmediate(() => { request.result = database; request.onupgradeneeded?.(); request.onsuccess?.(); });
      return request;
    } }
  };
}

async function harness(options = {}) {
  const storage = options.storage || new Map();
  const backend = options.backend || engine();
  const errors = [];
  const context = {
    indexedDB: options.unavailable ? undefined : backend.indexedDB,
    console: { warn() {}, error() {} }, queueMicrotask, Map, Set, Promise, Array, String,
    CustomEvent: function (type, options) { this.type = type; this.detail = options.detail; },
    dispatchEvent(event) { errors.push(event); },
    localStorage: {
      get length() { return storage.size; }, key: index => [...storage.keys()][index] ?? null,
      getItem: key => storage.get(key) ?? null,
      setItem(key, value) {
        const size = [...storage].filter(([stored]) => stored !== key).reduce((total, [name, text]) => total + name.length + text.length, key.length + value.length);
        if (size > (options.limit ?? Infinity)) throw new Error('QuotaExceededError');
        storage.set(key, value);
      },
      removeItem: key => storage.delete(key)
    }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('local-cache.js', 'utf8'), context);
  await context.XBLocalCache.ready;
  return { cache: context.XBLocalCache, context, storage, backend, errors };
}

test('migração preserva dados, cópias e fila antes de liberar o localStorage cheio', async () => {
  const entries = {
    xb_entregas_v3: JSON.stringify({ deliveries: [{ id: 'd1', notes: 'x'.repeat(700000) }], closings: [{ date: '2026-10-10' }] }),
    xb_entregas_recovery_v1: JSON.stringify({ savedAt: '2026-10-11', db: { deliveries: [{ id: 'd1' }] } }),
    xb_entregas_previous_state_v1: '{"db":{"deliveries":[{"id":"anterior"}]}}',
    xb_cloud_queue_v2_u1: '{"upserts":{"deliveries":{"d1":"r1"}}}',
    xb_cloud_recovery_v1_u1: '{"version":1,"entries":[{"key":"d1"}]}',
    xb_supabase_auth_v1: 'credencial-de-teste', unrelated: 'outro-aplicativo'
  };
  const h = await harness({ storage: new Map(Object.entries(entries)), limit: 1000 });
  assert.equal(h.cache.state.available, true);
  for (const [key, value] of Object.entries(entries)) assert.equal(h.cache.getItem(key), value);
  assert.equal(h.storage.has('xb_entregas_v3'), false);
  assert.equal(h.storage.get('xb_supabase_auth_v1'), 'credencial-de-teste');
  assert.equal(h.storage.get('unrelated'), 'outro-aplicativo');
  assert.equal(h.backend.records.get('xb_cloud_queue_v2_u1'), entries.xb_cloud_queue_v2_u1);
  assert.equal(h.cache.length, Object.keys(entries).length);
});

test('histórico maior que 5 MiB é salvo integralmente e retorna após reiniciar offline', async () => {
  const h = await harness({ limit: 1024 });
  const large = JSON.stringify({ deliveries: [{ id: 'd1', notes: 'x'.repeat(6 * 1024 * 1024) }], closings: [{ date: '2026-10-10', deliverySnapshotV1: [{ id: 'd1' }] }] });
  h.cache.setItem('xb_entregas_v3', large);
  h.cache.setItem('xb_entregas_recovery_v1', JSON.stringify({ db: JSON.parse(large) }));
  await h.cache.flush();
  const restarted = await harness({ backend: h.backend, storage: h.storage, limit: 1024 });
  assert.equal(restarted.cache.getItem('xb_entregas_v3'), large);
  assert.equal(JSON.parse(restarted.cache.getItem('xb_entregas_recovery_v1')).db.deliveries[0].notes.length, 6 * 1024 * 1024);
  assert.equal(h.storage.size, 0);
});

test('transação de migração abortada mantém todas as cópias antigas', async () => {
  const backend = engine();
  backend.hook(async mode => { if (mode === 'readwrite') throw new Error('Disco indisponível'); });
  const storage = new Map([['xb_entregas_v3', 'dados-antigos'], ['xb_entregas_recovery_v1', 'cópia-antiga']]);
  const h = await harness({ backend, storage });
  assert.equal(h.cache.state.available, false);
  assert.equal(storage.get('xb_entregas_v3'), 'dados-antigos');
  assert.equal(storage.get('xb_entregas_recovery_v1'), 'cópia-antiga');
  assert.equal(backend.records.size, 0);
  assert.equal(h.cache.getItem('xb_entregas_v3'), 'dados-antigos');
});

test('falha de gravação não confirma cache e pode ser retomada sem perder a edição', async () => {
  const h = await harness();
  h.cache.setItem('xb_entregas_v3', 'versão-confirmada');
  await h.cache.flush();
  h.backend.hook(async mode => { if (mode === 'readwrite') throw new Error('QuotaExceededError'); });
  h.cache.setItem('xb_entregas_v3', 'edição-nova');
  await assert.rejects(h.cache.flush(), /QuotaExceededError/);
  assert.equal(h.backend.records.get('xb_entregas_v3'), 'versão-confirmada');
  assert.equal(h.cache.getItem('xb_entregas_v3'), 'edição-nova');
  assert(h.errors.some(item => item.type === 'xb:local-cache-error'));
  h.backend.hook(async () => {});
  await h.cache.flush();
  assert.equal(h.backend.records.get('xb_entregas_v3'), 'edição-nova');
  assert.equal(h.cache.state.error, '');
});

test('edição durante gravação vence a revisão antiga e flush aguarda ambas', async () => {
  const h = await harness();
  const entered = deferred();
  const release = deferred();
  let first = true;
  h.backend.hook(async mode => { if (mode === 'readwrite' && first) { first = false; entered.resolve(); await release.promise; } });
  h.cache.setItem('xb_entregas_v3', 'revisão-1');
  const flush = h.cache.flush();
  await entered.promise;
  h.cache.setItem('xb_entregas_v3', 'revisão-2');
  h.cache.setItem('xb_cloud_queue_v2_u1', 'fila-2');
  release.resolve();
  await flush;
  assert.equal(h.backend.records.get('xb_entregas_v3'), 'revisão-2');
  assert.equal(h.backend.records.get('xb_cloud_queue_v2_u1'), 'fila-2');
});

test('sem IndexedDB o armazenamento legado continua funcionando e informa quota real', async () => {
  const h = await harness({ unavailable: true, storage: new Map([['xb_entregas_v3', 'antigo']]), limit: 100 });
  assert.equal(h.cache.state.available, false);
  assert.equal(h.cache.getItem('xb_entregas_v3'), 'antigo');
  assert.throws(() => h.cache.setItem('xb_entregas_v3', 'x'.repeat(200)), /QuotaExceededError/);
  assert.equal(h.cache.getItem('xb_entregas_v3'), 'antigo');
});
