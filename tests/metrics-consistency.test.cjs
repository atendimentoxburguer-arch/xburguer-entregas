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
  Promise,
  requestAnimationFrame: fn => fn(),
  queueMicrotask: fn => fn(),
  setTimeout: fn => fn(),
  clearTimeout() {},
  setInterval() { return 1; },
  clearInterval() {},
  navigator: { onLine: true },
  db: { settings: {}, couriers: [], deliveries: [], closings: [] },
  save() {},
  money: value => `R$ ${Number(value || 0).toFixed(2)}`,
  icon: () => '',
  esc: value => String(value ?? ''),
  empty: () => '',
  paymentIcon: () => '',
  refreshIcons() {},
  toast() {},
  dateKey() {},
  filterRange(items) { return items; },
  todayDeliveries() { return []; },
  reportItems() { return []; },
  courier(id) { return context.db.couriers.find(item => item.id === id); },
  renderDashboard() {},
  renderDeliveries() {},
  renderCouriers() {},
  renderClosing() {},
  renderReports() {},
  renderAll() {},
  confirm() { return true; },
  CustomEvent: function CustomEvent(name, options) { this.type = name; this.detail = options?.detail; },
  document: {
    hidden: false,
    getElementById() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {}
  },
  addEventListener() {},
  dispatchEvent() {}
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

// Períodos são dias de calendário, não janelas móveis de horas.
const RealDate = context.Date;
class FixedDate extends RealDate {
  constructor(...args) {
    super(...(args.length ? args : ['2026-09-12T15:00:00Z']));
  }
  static now() { return new RealDate('2026-09-12T15:00:00Z').getTime(); }
}
context.Date = FixedDate;
const rangeRows = [
  { id: 'outside', createdAt: '2026-09-05T15:00:00Z' },
  { id: 'first', createdAt: '2026-09-06T03:00:00Z' },
  { id: 'middle', createdAt: '2026-09-07T15:00:00Z' },
  { id: 'last', createdAt: '2026-09-12T15:00:00Z' }
];
assert.deepStrictEqual(
  M.filterRange(rangeRows, '7').map(item => item.id),
  ['first', 'middle', 'last'],
  'Últimos 7 dias devem incluir exatamente sete dias de calendário'
);
context.Date = RealDate;

// Soma monetária em centavos: não pode acumular resíduos de ponto flutuante.
const moneyRows = [{ value: 10.10 }, { value: 20.20 }, { value: 0.10 }];
assert.strictEqual(M.sumMoney(moneyRows, 'value'), 30.40);

// Regra operacional: cancelada mantém taxa, mas não entra no faturamento.
const rows = [
  { id: 'd1', code: 1, status: 'Entregue', payment: 'Cartão', orderValue: 32, fee: 6, courierId: 'c1', address: 'Rua A', createdAt: '2026-09-12T15:00:00Z' },
  { id: 'd2', code: 2, status: 'Cancelada', payment: 'Dinheiro', orderValue: 50, fee: 6, courierId: 'c1', address: 'Rua B', createdAt: '2026-09-12T16:00:00Z' },
  { id: 'd3', code: 3, status: 'Aguardando', payment: 'Pago online', orderValue: 25, fee: 6, courierId: 'c1', address: 'Rua C', createdAt: '2026-09-12T17:00:00Z' },
  { id: 'd4', code: 4, status: 'Aguardando', payment: 'Dinheiro', orderValue: 20, fee: 6, courierId: 'c1', address: 'Rua D', createdAt: '2026-09-12T18:00:00Z' }
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

// O fechamento guarda entregues + canceladas no snapshot, mas só entregues faturam.
context.db.couriers = [{ id: 'c1', name: 'Entregador', fee: 6, active: true }];
context.db.deliveries = rows.slice(0, 2);
context.db.closings = [];
vm.runInContext(fs.readFileSync('closing-continuity.js', 'utf8'), context, { filename: 'closing-continuity.js' });

const C = context.XBClosingContinuity;
assert(C, 'XBClosingContinuity não foi inicializado');
const details = C.buildDetails(context.db.deliveries);
assert.strictEqual(details.totalDeliveries, 1);
assert.strictEqual(details.cancelledDeliveries, 1);
assert.strictEqual(details.totalOrderValue, 32);
assert.strictEqual(details.totalFees, 12);
assert.strictEqual(details.cancelledFees, 6);

const fullSnapshot = C.expectedSnapshot(context.db.deliveries);
assert.strictEqual(fullSnapshot.length, 2);
assert.strictEqual(fullSnapshot.filter(item => item.status === 'Cancelada').length, 1);

const incompleteClosing = {
  date: '2026-09-12',
  detailsV2: details,
  deliverySnapshotV1: [fullSnapshot[0]]
};
assert.strictEqual(C.needsRepair(incompleteClosing), true, 'Snapshot sem cancelada deve ser reparado');

const completeClosing = {
  date: '2026-09-12',
  detailsV2: JSON.parse(JSON.stringify(details)),
  deliverySnapshotV1: JSON.parse(JSON.stringify(fullSnapshot))
};
assert.strictEqual(C.needsRepair(completeClosing), false, 'Snapshot completo deve ser aceito');

// Alterar a entrega atual depois do fechamento não pode reescrever o histórico já fechado.
context.db.deliveries[0].orderValue = 99;
context.db.deliveries[0].fee = 8;
assert.strictEqual(C.needsRepair(completeClosing, context.db.deliveries), false, 'Fechamento histórico deve permanecer imutável após edição posterior');

// Divergência dentro do próprio fechamento precisa ser detectada.
const corruptClosing = JSON.parse(JSON.stringify(completeClosing));
corruptClosing.deliverySnapshotV1[0].fee = 99;
assert.strictEqual(C.needsRepair(corruptClosing), true, 'Taxa divergente dentro do snapshot deve ser detectada');

const corruptRevenue = JSON.parse(JSON.stringify(completeClosing));
corruptRevenue.detailsV2.totalOrderValue = 31;
assert.strictEqual(C.needsRepair(corruptRevenue), true, 'Faturamento divergente deve ser detectado');

console.log('OK: testes de datas, quantidades, faturamento, taxas, cancelamentos e fechamento imutável passaram.');
