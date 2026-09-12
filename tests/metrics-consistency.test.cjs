const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const context = {
  console,
  Intl,
  Date,
  Math,
  JSON,
  Object,
  Array,
  Number,
  String,
  Map,
  Set,
  requestAnimationFrame: fn => fn(),
  queueMicrotask: fn => fn(),
  setTimeout: fn => fn(),
  navigator: { onLine: true },
  db: { settings: {}, couriers: [], deliveries: [], closings: [] },
  save() {},
  money: value => `R$ ${Number(value || 0).toFixed(2)}`,
  icon: () => '',
  esc: value => String(value ?? ''),
  empty: () => '',
  paymentIcon: () => '',
  refreshIcons() {},
  dateKey() {},
  filterRange(items) { return items; },
  todayDeliveries() { return []; },
  reportItems() { return []; },
  renderDashboard() {},
  renderDeliveries() {},
  renderCouriers() {},
  renderClosing() {},
  renderReports() {},
  document: {
    getElementById() { return null; },
    querySelectorAll() { return []; }
  },
  addEventListener() {}
};
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync('metrics-consistency-v4.js', 'utf8'), context, { filename: 'metrics-consistency-v4.js' });

const M = context.XBMetrics;
assert(M, 'XBMetrics não foi inicializado');

// Virada do dia na operação: 02:30 UTC ainda é 11/09 em São Paulo; 03:30 UTC já é 12/09.
assert.strictEqual(M.dayKey('2026-09-12T02:30:00Z'), '2026-09-11');
assert.strictEqual(M.dayKey('2026-09-12T03:30:00Z'), '2026-09-12');
assert.strictEqual(M.addDaysKey('2026-09-01', -1), '2026-08-31');

// Soma monetária em centavos: não pode acumular resíduos de ponto flutuante.
const moneyRows = [{ value: 10.10 }, { value: 20.20 }, { value: 0.10 }];
assert.strictEqual(M.sumMoney(moneyRows, 'value'), 30.40);

// Regra operacional: cancelada mantém taxa, mas não entra no faturamento.
const rows = [
  { status: 'Entregue', payment: 'Cartão', orderValue: 32, fee: 6, createdAt: '2026-09-12T15:00:00Z' },
  { status: 'Cancelada', payment: 'Dinheiro', orderValue: 50, fee: 6, createdAt: '2026-09-12T16:00:00Z' },
  { status: 'Aguardando', payment: 'Pago online', orderValue: 25, fee: 6, createdAt: '2026-09-12T17:00:00Z' },
  { status: 'Aguardando', payment: 'Dinheiro', orderValue: 20, fee: 6, createdAt: '2026-09-12T18:00:00Z' }
];
const stats = M.stats(rows);
assert.deepStrictEqual(
  {
    total: stats.total,
    delivered: stats.delivered,
    cancelled: stats.cancelled,
    pending: stats.pending,
    paymentPending: stats.paymentPending,
    onlinePending: stats.onlinePending,
    revenue: stats.revenue,
    fees: stats.fees,
    ticket: stats.ticket
  },
  { total: 4, delivered: 1, cancelled: 1, pending: 2, paymentPending: 1, onlinePending: 1, revenue: 32, fees: 12, ticket: 32 }
);

const dayRows = [
  { createdAt: '2026-09-12T02:30:00Z' },
  { createdAt: '2026-09-12T03:30:00Z' }
];
assert.strictEqual(M.forDay(dayRows, '2026-09-11').length, 1);
assert.strictEqual(M.forDay(dayRows, '2026-09-12').length, 1);

console.log('OK: testes de datas, quantidades, faturamento e taxas passaram.');
