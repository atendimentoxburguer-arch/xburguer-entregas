const fs = require('fs');
const vm = require('vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const tick = () => new Promise(resolve => setImmediate(resolve));

function transport() {
  const timers = new Map();
  let id = 0;
  const context = { AbortController, Response, Promise,
    setTimeout(fn) { timers.set(++id, fn); return id; }, clearTimeout(key) { timers.delete(key); } };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('cloud-transport.js', 'utf8'), context);
  return { createFetch: context.XBCloudTransport.createFetch, timers };
}

test('transporte mantém resposta e parâmetros sem repetir gravações automaticamente', async () => {
  const h = transport();
  let calls = 0;
  const fetch = h.createFetch(async (input, init) => {
    calls++;
    assert.equal(input, 'https://example.test');
    assert.equal(init.method, 'POST');
    assert.equal(init.body, '{"id":"d1"}');
    return new Response('{"ok":true}', { status: 201, headers: { 'content-type': 'application/json' } });
  });
  const response = await fetch('https://example.test', { method: 'POST', body: '{"id":"d1"}' });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(calls, 1);
  assert.equal(h.timers.size, 0);
});

test('tempo limite cancela uma conexão que não retorna cabeçalhos', async () => {
  const h = transport();
  let signal;
  const fetch = h.createFetch(async (input, init) => { signal = init.signal; return new Promise(() => {}); });
  const request = fetch('https://example.test');
  const rejected = assert.rejects(request, /demorou.*preservadas/);
  [...h.timers.values()][0]();
  await rejected;
  assert.equal(signal.aborted, true);
  assert.equal(h.timers.size, 0);
});

test('tempo limite abrange corpo travado mesmo após receber cabeçalhos', async () => {
  const h = transport();
  const fetch = h.createFetch(async () => ({ arrayBuffer: () => new Promise(() => {}) }));
  const request = fetch('https://example.test');
  const rejected = assert.rejects(request, /demorou/);
  await tick();
  [...h.timers.values()][0]();
  await rejected;
});

test('cancelamento solicitado pelo chamador chega à requisição', async () => {
  const h = transport();
  const original = new AbortController();
  const fetch = h.createFetch(async (input, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason));
  }));
  const request = fetch('https://example.test', { signal: original.signal });
  const rejected = assert.rejects(request, /cancelado/);
  original.abort(new Error('Pedido cancelado'));
  await rejected;
  assert.equal(h.timers.size, 0);
});

test('resposta sem conteúdo continua válida', async () => {
  const h = transport();
  const fetch = h.createFetch(async () => new Response(null, { status: 204 }));
  assert.equal((await fetch('https://example.test')).status, 204);
});

function core(raw) {
  let writes = 0;
  const context = { Date, Number, String, Math, Error,
    document: { getElementById() { return null; } },
    localStorage: { getItem: () => raw, setItem() { writes++; } }, addEventListener() {} };
  context.window = context;
  vm.createContext(context);
  const source = fs.readFileSync('app-core.js', 'utf8').split('function parseLegacyChange')[0];
  return { context, run: () => vm.runInContext(source, context), writes: () => writes };
}

test('JSON local corrompido não é sobrescrito por uma base vazia', () => {
  const h = core('{"deliveries":[');
  assert.throws(h.run, /cópia local/);
  assert.equal(h.writes(), 0);
  assert.match(h.context.__xbCoreLoadFailure, /mantidas/);
});

test('estrutura local incompleta é mantida para recuperação', () => {
  const h = core('{"deliveries":{},"couriers":[],"closings":[]}');
  assert.throws(h.run, /cópia local/);
  assert.equal(h.writes(), 0);
});

test('histórico local íntegro continua carregando e preserva fechamento', () => {
  const h = core(JSON.stringify({ settings: {}, couriers: [], deliveries: [{ id: 'd1' }], closings: [{ date: '2026-10-10' }] }));
  h.run();
  assert.equal(vm.runInContext('db.closings[0].date', h.context), '2026-10-10');
  assert.equal(h.writes(), 1);
});

function loader(started, flush) {
  const listeners = new Map();
  const events = [];
  let reloads = 0;
  const context = {
    __xbSystemHasStarted: started, XBLocalCache: { flush },
    navigator: { serviceWorker: { addEventListener(name, fn) { listeners.set(name, fn); },
      register: async () => ({ update: async () => {} }) } },
    document: { querySelector() { return null; }, createElement() { return { remove() {} }; }, body: { appendChild() {} } },
    sessionStorage: { getItem() { return null; }, setItem() {} }, location: { reload() { reloads++; } },
    console: { warn() {}, error() {} }, setTimeout, Promise,
    dispatchEvent(event) { events.push(event.type); }, CustomEvent: function (type) { this.type = type; }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('app.js', 'utf8'), context);
  return { context, listeners, events, reloads: () => reloads };
}

test('atualização do aplicativo espera gravação e mantém uma sessão de trabalho aberta', async () => {
  let release;
  const flush = new Promise(resolve => { release = resolve; });
  const h = loader(true, () => flush);
  const change = h.listeners.get('controllerchange')();
  await tick();
  assert.equal(h.reloads(), 0);
  release();
  await change;
  assert.equal(h.reloads(), 0);
  assert.equal(h.context.__xbUpdateWaiting, true);
  assert(h.events.includes('xb:update-ready'));
});

test('falha ao gravar impede recarregamento automático', async () => {
  const h = loader(false, async () => { throw new Error('Falha de disco'); });
  await h.listeners.get('controllerchange')();
  assert.equal(h.reloads(), 0);
});
