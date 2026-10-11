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
  const timers = new Map();
  const listeners = new Map();
  let sequence = 0;
  const context = {
    indexedDB: options.unavailable ? undefined : backend.indexedDB,
    navigator: options.navigator || {},
    setTimeout(fn, ms) { const id = ++sequence; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    addEventListener(name, fn) { listeners.set(name, fn); },
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
  return { cache: context.XBLocalCache, context, storage, backend, errors, timers, listeners };
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

test('cache informa gravações em trânsito e só confirma depois do commit', async () => {
  const h = await harness();
  const entered = deferred();
  const release = deferred();
  h.backend.hook(async mode => { if (mode === 'readwrite') { entered.resolve(); await release.promise; } });
  h.cache.setItem('xb_entregas_v3', 'nova-versão');
  assert.equal(h.cache.state.pending, 1);
  const flush = h.cache.flush();
  await entered.promise;
  assert.equal(h.cache.state.pending, 1);
  assert.equal(h.cache.state.lastSavedAt, '');
  release.resolve();
  await flush;
  assert.equal(h.cache.state.pending, 0);
  assert(h.cache.state.lastSavedAt);
});

test('repetir um snapshot confirmado não regrava o histórico', async () => {
  const h = await harness();
  let writes = 0;
  h.backend.hook(async mode => { if (mode === 'readwrite') writes += 1; });
  h.cache.setItem('xb_entregas_v3', 'idêntico');
  await h.cache.flush();
  for (let i = 0; i < 5; i++) h.cache.setItem('xb_entregas_v3', 'idêntico');
  await h.cache.flush();
  assert.equal(writes, 1);
  assert.equal(h.cache.state.pending, 0);
});

test('gravação abortada é retomada automaticamente mantendo a alteração', async () => {
  const h = await harness();
  let fail = true;
  h.backend.hook(async mode => { if (mode === 'readwrite' && fail) throw new Error('Falha temporária'); });
  h.cache.setItem('xb_entregas_v3', 'preservado');
  await assert.rejects(h.cache.flush(), /temporária/);
  assert.equal(h.cache.state.pending, 1);
  const retry = [...h.timers.values()].find(timer => timer.ms === 5000);
  assert(retry, 'Deve programar uma retomada sem recarregar a página');
  fail = false;
  retry.fn();
  await h.cache.flush();
  assert.equal(h.backend.records.get('xb_entregas_v3'), 'preservado');
  assert.equal(h.cache.state.pending, 0);
  assert.equal(h.cache.state.error, '');
});

test('aba concorrente não lê nem sobrescreve o cache da aba ativa', async () => {
  let held = false;
  const locks = { request(name, options, callback) {
    assert.equal(options.ifAvailable, true);
    if (held) return Promise.resolve(callback(null));
    held = true;
    return Promise.resolve(callback({ name }));
  } };
  const backend = engine();
  const first = await harness({ backend, navigator: { locks } });
  first.cache.setItem('xb_entregas_v3', 'aba-ativa');
  await first.cache.flush();
  const second = await harness({ backend, navigator: { locks } });
  assert.equal(second.cache.state.blocked, true);
  assert.match(second.cache.state.error, /outra aba/);
  assert.throws(() => second.cache.setItem('xb_entregas_v3', 'aba-antiga'), /outra aba/);
  assert.equal(backend.records.get('xb_entregas_v3'), 'aba-ativa');
});

test('cópia antiga deixada no localStorage não substitui IndexedDB mais recente', async () => {
  const backend = engine();
  backend.records.set('xb_entregas_v3', 'histórico-confirmado');
  const storage = new Map([['xb_entregas_v3', 'histórico-antigo'], ['xb_cloud_queue_v2_u1', 'fila-antiga']]);
  const h = await harness({ backend, storage });
  assert.equal(h.cache.getItem('xb_entregas_v3'), 'histórico-confirmado');
  assert.equal(h.cache.getItem('xb_cloud_queue_v2_u1'), null);
  const preserved = JSON.parse(h.cache.getItem('xb_cache_legacy_conflicts_v1'));
  assert.equal(preserved.entries.find(item => item.key === 'xb_entregas_v3').value, 'histórico-antigo');
  assert.equal(preserved.entries.find(item => item.key === 'xb_cloud_queue_v2_u1').value, 'fila-antiga');
  assert.equal(storage.size, 0);
});

test('falha ao ler IndexedDB bloqueia a inicialização sem criar base vazia', async () => {
  const backend = engine();
  backend.records.set('xb_entregas_v3', 'dados-confirmados');
  backend.hook(async mode => { if (mode === 'readonly') throw new Error('Leitura interrompida'); });
  const h = await harness({ backend });
  assert.equal(h.cache.state.blocked, true);
  assert.throws(() => h.cache.setItem('xb_entregas_v3', 'vazio'), /Leitura interrompida/);
  assert.equal(backend.records.get('xb_entregas_v3'), 'dados-confirmados');
});

test('estimativa de espaço e proteção permanente refletem a resposta do navegador', async () => {
  let persistent = false;
  const h = await harness({ navigator: { storage: {
    estimate: async () => ({ usage: 95, quota: 100 }), persisted: async () => persistent,
    persist: async () => { persistent = true; return true; }
  } } });
  await h.cache.measure();
  assert.equal(h.cache.state.usage, 95);
  assert.equal(h.cache.state.quota, 100);
  assert.equal(h.cache.state.persistent, false);
  assert.equal(await h.cache.protect(), true);
  assert.equal(h.cache.state.persistent, true);
});

test('proteção ao fechar a aba vigora apenas enquanto há gravação sem confirmação', async () => {
  const h = await harness();
  let prevented = 0;
  const event = { preventDefault() { prevented += 1; } };
  h.listeners.get('beforeunload')(event);
  assert.equal(prevented, 0);
  h.cache.setItem('xb_entregas_v3', 'alteração');
  h.listeners.get('beforeunload')(event);
  assert.equal(prevented, 1);
  await h.cache.flush();
  h.listeners.get('beforeunload')(event);
  assert.equal(prevented, 1);
});

test('cópia de recuperação contém a fila, mas exclui autenticação e outros aplicativos', async () => {
  const h = await harness({ storage: new Map([['xb_supabase_auth_v1', 'segredo'], ['outro_app', 'externo']]) });
  h.cache.setItem('xb_entregas_v3', 'histórico');
  h.cache.setItem('xb_cloud_queue_v2_u1', 'fila-pendente');
  assert.deepEqual(JSON.parse(JSON.stringify(h.cache.snapshot())), { xb_entregas_v3: 'histórico', xb_cloud_queue_v2_u1: 'fila-pendente' });
  await h.cache.flush();
});
