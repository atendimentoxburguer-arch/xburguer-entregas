const DB_KEY = 'xb_entregas_v3';
const SESSION_KEY = 'xb_entregas_session';
const LOGIN_EMAIL_KEY = 'xb_entregas_login_email';

const titles = {
  dashboard: 'Dashboard',
  newDelivery: 'Nova entrega',
  deliveries: 'Entregas',
  couriers: 'Entregadores',
  closing: 'Fechamento',
  reports: 'Relatórios',
  settings: 'Configurações'
};

const $ = id => document.getElementById(id);
const money = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const uid = (prefix = 'id') => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const icon = name => `<i data-lucide="${name}"></i>`;

function refreshIcons() {
  if (window.lucide?.createIcons) window.lucide.createIcons({ attrs: { 'stroke-width': 2 } });
}
window.addEventListener('load', refreshIcons);

function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function fmtDateTime(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  });
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function initialDB() {
  return {
    settings: {
      storeName: 'X-Burguer Entregas',
      defaultFee: 6,
      email: 'admin@xburguer.com',
      password: '123456'
    },
    couriers: [
      { id: 'carlos', name: 'Carlos Oliveira', phone: '(62) 99999-1111', fee: 6, active: true },
      { id: 'ana', name: 'Ana Paula', phone: '(62) 99999-2222', fee: 6, active: true },
      { id: 'bruno', name: 'Bruno Santos', phone: '(62) 99999-3333', fee: 6, active: true }
    ],
    deliveries: [],
    closings: []
  };
}

function loadDB() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) return initialDB();
    const data = JSON.parse(raw);
    const base = initialDB();
    return {
      settings: { ...base.settings, ...(data.settings || {}) },
      couriers: Array.isArray(data.couriers) ? data.couriers : [],
      deliveries: Array.isArray(data.deliveries) ? data.deliveries : [],
      closings: Array.isArray(data.closings) ? data.closings : []
    };
  } catch {
    return initialDB();
  }
}

let db = loadDB();
function save() { localStorage.setItem(DB_KEY, JSON.stringify(db)); }
save();

function parseLegacyChange(notes) {
  const match = String(notes || '').match(/Troco para R\$\s*([0-9.,]+)/i);
  if (!match) return '';
  return match[1].replaceAll('.', '').replace(',', '.');
}

function getChangeFor(item) {
  return item?.changeFor ?? parseLegacyChange(item?.notes);
}

function cleanLegacyChangeNote(notes) {
  return String(notes || '')
    .replace(/\s*•?\s*Troco para R\$\s*[0-9.,]+/ig, '')
    .trim();
}

function courier(id) { return db.couriers.find(item => item.id === id); }
function todayDeliveries() {
  const today = dateKey();
  return db.deliveries.filter(item => dateKey(new Date(item.createdAt)) === today);
}
function delivered(list) { return list.filter(item => item.status === 'Entregue'); }
function nextCode() {
  return db.deliveries.length ? Math.max(...db.deliveries.map(item => Number(item.code || 0))) + 1 : 1;
}
function clientLabel(item) { return item?.client?.trim() || 'Não informado'; }
function addressLabel(item) {
  return [item?.address, item?.reference].filter(Boolean).join(' • ') || '-';
}

function toast(message, type = 'ok') {
  const element = document.createElement('div');
  element.className = `toast ${type}`;
  element.innerHTML = `${icon(type === 'error' ? 'circle-alert' : 'circle-check')}<span>${esc(message)}</span>`;
  $('toasts').appendChild(element);
  refreshIcons();
  setTimeout(() => element.remove(), 3400);
}

function openModal(id) {
  $(id).classList.add('open');
  document.body.style.overflow = 'hidden';
  refreshIcons();
}
function closeModal(id) {
  $(id).classList.remove('open');
  document.body.style.overflow = '';
}

document.querySelectorAll('[data-close]').forEach(button => {
  button.addEventListener('click', () => closeModal(button.dataset.close));
});
document.querySelectorAll('.modal').forEach(modal => {
  modal.addEventListener('click', event => { if (event.target === modal) closeModal(modal.id); });
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') document.querySelectorAll('.modal.open').forEach(modal => closeModal(modal.id));
});

// LOGIN
const rememberedEmail = localStorage.getItem(LOGIN_EMAIL_KEY);
if (rememberedEmail) {
  $('loginEmail').value = rememberedEmail;
  $('rememberLogin').checked = true;
}

$('togglePassword').addEventListener('click', () => {
  const password = $('loginPassword');
  const show = password.type === 'password';
  password.type = show ? 'text' : 'password';
  $('togglePassword').setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
  $('togglePassword').innerHTML = icon(show ? 'eye-off' : 'eye');
  refreshIcons();
});

$('loginForm').addEventListener('submit', event => {
  event.preventDefault();
  const email = $('loginEmail').value.trim();
  const password = $('loginPassword').value;
  if (email === db.settings.email && password === db.settings.password) {
    sessionStorage.setItem(SESSION_KEY, '1');
    if ($('rememberLogin').checked) localStorage.setItem(LOGIN_EMAIL_KEY, email);
    else localStorage.removeItem(LOGIN_EMAIL_KEY);
    showApp();
  } else {
    toast('E-mail ou senha incorretos.', 'error');
  }
});

$('logoutBtn').addEventListener('click', () => {
  sessionStorage.removeItem(SESSION_KEY);
  location.reload();
});

function showApp() {
  $('loginView').classList.add('hidden');
  $('appView').classList.remove('hidden');
  renderAll();
}
if (sessionStorage.getItem(SESSION_KEY) === '1') showApp();

// NAVIGATION
function closeSidebar() {
  $('sidebar').classList.remove('open');
  $('drawerBackdrop').classList.remove('open');
}
function go(page) {
  document.querySelectorAll('.page').forEach(item => item.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(item => item.classList.remove('active'));
  $(`page-${page}`).classList.add('active');
  document.querySelector(`.nav-btn[data-page="${page}"]`)?.classList.add('active');
  $('topTitle').textContent = titles[page] || 'X-Burguer';
  closeSidebar();
  renderAll();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.querySelectorAll('.nav-btn').forEach(button => button.addEventListener('click', () => go(button.dataset.page)));
document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => go(button.dataset.go)));
$('mobileMenu').addEventListener('click', () => {
  $('sidebar').classList.toggle('open');
  $('drawerBackdrop').classList.toggle('open');
});
$('drawerBackdrop').addEventListener('click', closeSidebar);

// COMMON RENDER HELPERS
function statusClass(status) {
  return { 'Aguardando': 'waiting', 'Em rota': 'route', 'Entregue': 'done', 'Cancelada': 'cancel' }[status] || 'waiting';
}
function statusHTML(status) {
  return `<span class="status ${statusClass(status)}">${esc(status)}</span>`;
}
function paymentIcon(payment) {
  return { 'Dinheiro': 'banknote', 'PIX': 'qr-code', 'Cartão': 'credit-card', 'Pago online': 'badge-check' }[payment] || 'wallet';
}
function paymentLabel(payment) {
  return payment || 'Não informado';
}
function paymentHTML(item) {
  const change = getChangeFor(item);
  return `<span class="payment-inline">${icon(paymentIcon(item.payment))}<span>${esc(paymentLabel(item.payment))}</span></span>${change ? `<span class="table-muted">Troco para ${money(change)}</span>` : ''}`;
}
function stat(iconName, klass, value, label, detail = '') {
  return `<div class="stat"><div class="stat-top"><div class="stat-icon ${klass}">${icon(iconName)}</div><span class="stat-detail">${esc(detail)}</span></div><div class="stat-value">${value}</div><div class="stat-label">${esc(label)}</div></div>`;
}
function empty(title, text, iconName = 'inbox') {
  return `<div class="empty"><div class="empty-icon">${icon(iconName)}</div><b>${esc(title)}</b><span>${esc(text)}</span></div>`;
}
function initials(name) {
  return String(name || '').split(' ').filter(Boolean).slice(0, 2).map(item => item[0]).join('').toUpperCase();
}
function filterRange(items, range) {
  if (range === 'all') return items;
  if (range === 'today') {
    const today = dateKey();
    return items.filter(item => dateKey(new Date(item.createdAt)) === today);
  }
  const limit = new Date();
  limit.setDate(limit.getDate() - Number(range));
  return items.filter(item => new Date(item.createdAt) >= limit);
}

// SELECTS + PAYMENT FIELDS
function renderSelects() {
  const active = db.couriers.filter(item => item.active);
  $('deliveryCourier').innerHTML = '<option value="">Selecione um entregador</option>' + active.map(item => `<option value="${item.id}">${esc(item.name)}</option>`).join('');
  $('editDeliveryCourier').innerHTML = '<option value="">Sem entregador</option>' + db.couriers.map(item => `<option value="${item.id}">${esc(item.name)}</option>`).join('');
}

$('deliveryCourier').addEventListener('change', event => {
  const item = courier(event.target.value);
  if (item) $('deliveryFee').value = Number(item.fee || 0).toFixed(2);
});

function syncPaymentFields() {
  const payment = document.querySelector('input[name="payment"]:checked')?.value;
  $('changeField').classList.toggle('hidden', payment !== 'Dinheiro');
  if (payment !== 'Dinheiro') $('deliveryChange').value = '';
}
document.querySelectorAll('input[name="payment"]').forEach(input => input.addEventListener('change', syncPaymentFields));
$('editDeliveryPayment').addEventListener('change', () => {
  const isCash = $('editDeliveryPayment').value === 'Dinheiro';
  $('editChangeField').classList.toggle('hidden', !isCash);
  if (!isCash) $('editDeliveryChange').value = '';
});
syncPaymentFields();

// NEW DELIVERY
$('deliveryForm').addEventListener('submit', event => {
  event.preventDefault();
  const item = {
    id: uid('delivery'),
    code: nextCode(),
    client: $('deliveryClient').value.trim(),
    phone: $('deliveryPhone').value.trim(),
    address: $('deliveryAddress').value.trim(),
    reference: '',
    courierId: $('deliveryCourier').value || null,
    fee: Number($('deliveryFee').value || 0),
    orderValue: Number($('deliveryValue').value || 0),
    payment: document.querySelector('input[name="payment"]:checked')?.value || 'Dinheiro',
    changeFor: $('deliveryChange').value ? Number($('deliveryChange').value) : '',
    notes: $('deliveryNotes').value.trim(),
    status: 'Aguardando',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  db.deliveries.push(item);
  save();
  event.target.reset();
  $('deliveryReference').value = '';
  $('deliveryFee').value = Number(db.settings.defaultFee).toFixed(2);
  $('deliveryValue').value = '0';
  syncPaymentFields();
  toast(`Entrega #${String(item.code).padStart(3, '0')} cadastrada.`);
  go('deliveries');
});

// DASHBOARD
function renderDashboard() {
  const today = todayDeliveries();
  const done = delivered(today);
  const waiting = today.filter(item => item.status === 'Aguardando');
  const route = today.filter(item => item.status === 'Em rota');
  const revenue = done.reduce((sum, item) => sum + Number(item.orderValue || 0), 0);

  $('dashboardStats').innerHTML =
    stat('package', 'red', today.length, 'Entregas hoje', 'Total') +
    stat('bike', 'blue', route.length, 'Em rota agora', 'Ativas') +
    stat('circle-check-big', 'green', done.length, 'Entregues', 'Hoje') +
    stat('banknote', 'orange', money(revenue), 'Pedidos entregues', 'Hoje');

  const recent = [...db.deliveries].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 6);
  $('recentDeliveries').innerHTML = recent.length ? `
    <div class="table-wrap"><table aria-label="Entregas recentes"><caption>Entregas recentes</caption><thead><tr><th>Pedido</th><th>Destino</th><th>Entregador</th><th>Status</th></tr></thead><tbody>
    ${recent.map(item => `<tr><td><span class="table-name">#${String(item.code).padStart(3, '0')}</span><span class="table-muted">${fmtDateTime(item.createdAt)}</span></td><td><span class="table-name">${esc(clientLabel(item))}</span><span class="table-muted">${esc(addressLabel(item))}</span></td><td>${esc(courier(item.courierId)?.name || 'Não definido')}</td><td>${statusHTML(item.status)}</td></tr>`).join('')}
    </tbody></table></div>` : empty('Nenhuma entrega', 'Cadastre sua primeira entrega.', 'package-open');

  $('operationSummary').innerHTML = `<div class="summary-list">
    <div class="summary-row"><span>Aguardando entregador</span><b>${waiting.length}</b></div>
    <div class="summary-row"><span>Em rota</span><b>${route.length}</b></div>
    <div class="summary-row"><span>Entregadores ativos</span><b>${db.couriers.filter(item => item.active).length}</b></div>
    <div class="summary-row total"><span>Taxas realizadas</span><b>${money(done.reduce((sum, item) => sum + Number(item.fee || 0), 0))}</b></div>
  </div>`;
}

// DELIVERIES TABLE
$('deliverySearch').addEventListener('input', renderDeliveries);
$('statusFilter').addEventListener('change', renderDeliveries);
$('dateFilter').addEventListener('change', renderDeliveries);

function currentFilteredDeliveries() {
  const query = $('deliverySearch').value.trim().toLowerCase();
  const status = $('statusFilter').value;
  const range = $('dateFilter').value;
  let items = filterRange([...db.deliveries], range);
  if (status) items = items.filter(item => item.status === status);
  if (query) items = items.filter(item => [item.client, item.address, item.reference, item.phone, item.payment, courier(item.courierId)?.name].join(' ').toLowerCase().includes(query));
  return items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function renderDeliveries() {
  const items = currentFilteredDeliveries();
  $('deliveryStats').innerHTML =
    stat('package', 'red', db.deliveries.length, 'Total de entregas') +
    stat('clock-3', 'orange', db.deliveries.filter(item => item.status === 'Aguardando').length, 'Aguardando') +
    stat('bike', 'blue', db.deliveries.filter(item => item.status === 'Em rota').length, 'Em rota') +
    stat('circle-check-big', 'green', db.deliveries.filter(item => item.status === 'Entregue').length, 'Entregues');

  $('deliveriesTable').innerHTML = items.length ? `<table aria-label="Lista de entregas"><caption>Lista de entregas</caption><thead><tr><th>#</th><th>Destino</th><th>Cliente</th><th>Entregador</th><th>Pagamento</th><th>Valores</th><th>Status</th><th>Ações</th></tr></thead><tbody>${items.map(item => `
    <tr>
      <td><span class="table-name">#${String(item.code).padStart(3, '0')}</span><span class="table-muted">${fmtDateTime(item.createdAt)}</span></td>
      <td><span class="table-name address-table">${esc(addressLabel(item))}</span></td>
      <td><span class="table-name">${esc(clientLabel(item))}</span>${item.phone ? `<span class="table-muted">${esc(item.phone)}</span>` : ''}</td>
      <td>${esc(courier(item.courierId)?.name || 'Não definido')}</td>
      <td>${paymentHTML(item)}</td>
      <td><span class="table-name">${money(item.orderValue)}</span><span class="table-muted">Taxa ${money(item.fee)}</span></td>
      <td>${statusHTML(item.status)}</td>
      <td><div class="row-actions">
        ${!['Entregue', 'Cancelada'].includes(item.status) ? `<button class="icon-btn" data-delivery-action="advance" data-id="${item.id}" title="Avançar status" aria-label="Avançar status">${icon('arrow-right')}</button>` : ''}
        <button class="icon-btn" data-delivery-action="edit" data-id="${item.id}" title="Editar entrega" aria-label="Editar entrega">${icon('pencil')}</button>
        ${!['Entregue', 'Cancelada'].includes(item.status) ? `<button class="icon-btn" data-delivery-action="cancel" data-id="${item.id}" title="Cancelar entrega" aria-label="Cancelar entrega">${icon('ban')}</button>` : ''}
        <button class="icon-btn" data-delivery-action="delete" data-id="${item.id}" title="Excluir entrega" aria-label="Excluir entrega">${icon('trash-2')}</button>
      </div></td>
    </tr>`).join('')}</tbody></table>` : empty('Nenhuma entrega encontrada', 'Altere os filtros ou cadastre uma nova entrega.', 'package-search');
  refreshIcons();
}

$('deliveriesTable').addEventListener('click', event => {
  const button = event.target.closest('[data-delivery-action]');
  if (!button) return;
  const item = db.deliveries.find(delivery => delivery.id === button.dataset.id);
  if (!item) return;
  const action = button.dataset.deliveryAction;

  if (action === 'advance') {
    if (item.status === 'Aguardando') item.status = 'Em rota';
    else if (item.status === 'Em rota') item.status = 'Entregue';
    item.updatedAt = new Date().toISOString();
    save();
    toast(`Status alterado para ${item.status}.`);
    renderAll();
  }
  if (action === 'cancel') {
    if (!confirm('Deseja cancelar esta entrega?')) return;
    item.status = 'Cancelada';
    item.updatedAt = new Date().toISOString();
    save();
    toast('Entrega cancelada.');
    renderAll();
  }
  if (action === 'delete') {
    if (!confirm('Excluir definitivamente esta entrega?')) return;
    db.deliveries = db.deliveries.filter(delivery => delivery.id !== item.id);
    save();
    toast('Entrega excluída.');
    renderAll();
  }
  if (action === 'edit') openDeliveryEditor(item);
});

function openDeliveryEditor(item) {
  $('editDeliveryId').value = item.id;
  $('editDeliveryAddress').value = addressLabel(item) === '-' ? '' : addressLabel(item);
  $('editDeliveryClient').value = item.client || '';
  $('editDeliveryPhone').value = item.phone || '';
  $('editDeliveryCourier').value = item.courierId || '';
  $('editDeliveryValue').value = item.orderValue || 0;
  $('editDeliveryFee').value = item.fee || 0;
  $('editDeliveryPayment').value = item.payment || 'Dinheiro';
  $('editDeliveryChange').value = getChangeFor(item) || '';
  $('editDeliveryNotes').value = cleanLegacyChangeNote(item.notes || '');
  $('editChangeField').classList.toggle('hidden', $('editDeliveryPayment').value !== 'Dinheiro');
  openModal('deliveryModal');
}

$('deliveryEditForm').addEventListener('submit', event => {
  event.preventDefault();
  const item = db.deliveries.find(delivery => delivery.id === $('editDeliveryId').value);
  if (!item) return;
  item.address = $('editDeliveryAddress').value.trim();
  item.reference = '';
  item.client = $('editDeliveryClient').value.trim();
  item.phone = $('editDeliveryPhone').value.trim();
  item.courierId = $('editDeliveryCourier').value || null;
  item.orderValue = Number($('editDeliveryValue').value || 0);
  item.fee = Number($('editDeliveryFee').value || 0);
  item.payment = $('editDeliveryPayment').value;
  item.changeFor = item.payment === 'Dinheiro' && $('editDeliveryChange').value ? Number($('editDeliveryChange').value) : '';
  item.notes = $('editDeliveryNotes').value.trim();
  item.updatedAt = new Date().toISOString();
  save();
  closeModal('deliveryModal');
  toast('Entrega atualizada.');
  renderAll();
});

// COURIERS
$('newCourierBtn').addEventListener('click', () => openCourier());
function openCourier(id = '') {
  $('courierForm').reset();
  $('courierId').value = id;
  $('courierFee').value = Number(db.settings.defaultFee).toFixed(2);
  $('courierActive').value = 'true';
  $('courierModalTitle').textContent = id ? 'Editar entregador' : 'Novo entregador';
  if (id) {
    const item = courier(id);
    if (!item) return;
    $('courierName').value = item.name;
    $('courierPhone').value = item.phone || '';
    $('courierFee').value = item.fee;
    $('courierActive').value = String(item.active);
  }
  openModal('courierModal');
}

$('courierForm').addEventListener('submit', event => {
  event.preventDefault();
  const id = $('courierId').value;
  const data = {
    name: $('courierName').value.trim(),
    phone: $('courierPhone').value.trim(),
    fee: Number($('courierFee').value || 0),
    active: $('courierActive').value === 'true'
  };
  if (id) {
    Object.assign(courier(id), data);
    toast('Entregador atualizado.');
  } else {
    db.couriers.push({ id: uid('courier'), ...data });
    toast('Entregador cadastrado.');
  }
  save();
  closeModal('courierModal');
  renderAll();
});

$('courierGrid').addEventListener('click', event => {
  const button = event.target.closest('[data-courier-action]');
  if (!button) return;
  const id = button.dataset.id;
  if (button.dataset.courierAction === 'edit') openCourier(id);
  if (button.dataset.courierAction === 'delete') {
    if (db.deliveries.some(item => item.courierId === id)) return toast('Esse entregador possui entregas. Marque como inativo em vez de excluir.', 'error');
    if (!confirm('Excluir este entregador?')) return;
    db.couriers = db.couriers.filter(item => item.id !== id);
    save();
    toast('Entregador excluído.');
    renderAll();
  }
});

function renderCouriers() {
  const active = db.couriers.filter(item => item.active);
  const done = db.deliveries.filter(item => item.status === 'Entregue');
  const average = active.length ? active.reduce((sum, item) => sum + Number(item.fee || 0), 0) / active.length : 0;
  $('courierStats').innerHTML =
    stat('users-round', 'red', db.couriers.length, 'Equipe cadastrada') +
    stat('user-check', 'green', active.length, 'Entregadores ativos') +
    stat('coins', 'orange', money(average), 'Taxa média') +
    stat('package-check', 'blue', done.length, 'Entregas concluídas');

  $('courierGrid').innerHTML = db.couriers.length ? db.couriers.map(item => {
    const completed = done.filter(delivery => delivery.courierId === item.id);
    const fees = completed.reduce((sum, delivery) => sum + Number(delivery.fee || 0), 0);
    return `<article class="courier-card"><div class="courier-top"><div class="courier-person"><div class="courier-avatar">${initials(item.name)}</div><div><strong>${esc(item.name)}</strong><span>${esc(item.phone || 'Sem telefone')}</span></div></div><div class="dot ${item.active ? '' : 'off'}" title="${item.active ? 'Ativo' : 'Inativo'}"></div></div><div class="courier-data"><div><span>Taxa padrão</span><strong>${money(item.fee)}</strong></div><div><span>Entregas</span><strong>${completed.length}</strong></div></div><div class="courier-data"><div><span>Taxas recebidas</span><strong>${money(fees)}</strong></div><div><span>Status</span><strong>${item.active ? 'Ativo' : 'Inativo'}</strong></div></div><div class="courier-actions"><button class="btn btn-light btn-sm" data-courier-action="edit" data-id="${item.id}">${icon('pencil')}Editar</button><button class="btn btn-danger btn-sm" data-courier-action="delete" data-id="${item.id}" aria-label="Excluir entregador">${icon('trash-2')}</button></div></article>`;
  }).join('') : empty('Nenhum entregador', 'Cadastre sua equipe de entregas.', 'users-round');
  refreshIcons();
}

// CLOSING
function paymentTotals(items) {
  const totals = { 'Dinheiro': 0, 'PIX': 0, 'Cartão': 0, 'Pago online': 0 };
  items.forEach(item => { if (totals[item.payment] !== undefined) totals[item.payment] += Number(item.orderValue || 0); });
  return totals;
}

function renderClosing() {
  const today = todayDeliveries();
  const done = delivered(today);
  const pending = today.filter(item => ['Aguardando', 'Em rota'].includes(item.status));
  const orders = done.reduce((sum, item) => sum + Number(item.orderValue || 0), 0);
  const fees = done.reduce((sum, item) => sum + Number(item.fee || 0), 0);

  $('closingStats').innerHTML =
    stat('banknote', 'green', money(orders), 'Pedidos entregues') +
    stat('coins', 'red', money(fees), 'Total em taxas') +
    stat('package-check', 'blue', done.length, 'Entregas realizadas') +
    stat('clock-3', 'orange', pending.length, 'Pendentes');

  const totals = paymentTotals(done);
  $('closingPayments').innerHTML = Object.entries(totals).map(([name, value]) => {
    const percent = orders ? Math.round(value / orders * 100) : 0;
    return `<div class="pay-row"><div class="pay-top"><span class="payment-inline">${icon(paymentIcon(name))}<span>${esc(name)}</span></span><b>${money(value)} · ${percent}%</b></div><div class="progress"><span style="width:${percent}%"></span></div></div>`;
  }).join('') + `<div class="summary-row total"><span>Total</span><b>${money(orders)}</b></div>`;

  const rows = db.couriers.map(item => {
    const deliveries = done.filter(delivery => delivery.courierId === item.id);
    return { item, count: deliveries.length, value: deliveries.reduce((sum, delivery) => sum + Number(delivery.fee || 0), 0) };
  }).filter(row => row.count);
  $('closingCouriers').innerHTML = rows.length ? `<div class="summary-list">${rows.map(row => `<div class="summary-row"><span>${esc(row.item.name)} · ${row.count} entrega${row.count === 1 ? '' : 's'}</span><b>${money(row.value)}</b></div>`).join('')}</div>` : empty('Sem entregas concluídas', 'Os valores aparecerão aqui.', 'bike');

  const closing = db.closings.find(item => item.date === dateKey());
  if (closing) {
    $('closingBanner').innerHTML = `<div class="banner ok">${icon('badge-check')}<span>Dia finalizado em <b>${fmtDateTime(closing.closedAt)}</b>.</span></div>`;
    $('closeDayBtn').classList.add('hidden');
    $('reopenDayBtn').classList.remove('hidden');
  } else {
    $('closingBanner').innerHTML = pending.length ? `<div class="banner warn">${icon('triangle-alert')}<span>Existem <b>${pending.length}</b> entregas pendentes. Confira antes de finalizar o dia.</span></div>` : '';
    $('closeDayBtn').classList.remove('hidden');
    $('reopenDayBtn').classList.add('hidden');
  }
}

$('closeDayBtn').addEventListener('click', () => {
  const day = dateKey();
  if (db.closings.some(item => item.date === day)) return;
  const today = todayDeliveries();
  const done = delivered(today);
  const pending = today.filter(item => ['Aguardando', 'Em rota'].includes(item.status));
  if (pending.length && !confirm(`Existem ${pending.length} entregas pendentes. Finalizar mesmo assim?`)) return;
  db.closings.push({
    id: uid('closing'), date: day, delivered: done.length, pending: pending.length,
    orderValue: done.reduce((sum, item) => sum + Number(item.orderValue || 0), 0),
    fees: done.reduce((sum, item) => sum + Number(item.fee || 0), 0),
    closedAt: new Date().toISOString()
  });
  save();
  toast('Fechamento do dia finalizado.');
  renderClosing();
  refreshIcons();
});

$('reopenDayBtn').addEventListener('click', () => {
  if (!confirm('Deseja reabrir o fechamento de hoje?')) return;
  db.closings = db.closings.filter(item => item.date !== dateKey());
  save();
  toast('Fechamento reaberto.');
  renderClosing();
  refreshIcons();
});

// REPORTS
$('reportRange').addEventListener('change', renderReports);
function reportItems() {
  let items = db.deliveries.filter(item => item.status === 'Entregue');
  const range = $('reportRange').value;
  if (range === 'all') return items;
  const limit = new Date();
  limit.setDate(limit.getDate() - Number(range));
  return items.filter(item => new Date(item.createdAt) >= limit);
}

function renderReports() {
  const items = reportItems();
  const revenue = items.reduce((sum, item) => sum + Number(item.orderValue || 0), 0);
  const fees = items.reduce((sum, item) => sum + Number(item.fee || 0), 0);
  const average = items.length ? revenue / items.length : 0;

  $('reportStats').innerHTML =
    stat('banknote', 'green', money(revenue), 'Faturamento') +
    stat('coins', 'red', money(fees), 'Taxas de entrega') +
    stat('package-check', 'blue', items.length, 'Entregas') +
    stat('receipt-text', 'purple', money(average), 'Ticket médio');

  const days = [];
  for (let index = 6; index >= 0; index--) {
    const date = new Date();
    date.setDate(date.getDate() - index);
    const key = dateKey(date);
    days.push({
      label: date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
      count: items.filter(item => dateKey(new Date(item.createdAt)) === key).length
    });
  }
  const max = Math.max(1, ...days.map(day => day.count));
  $('reportChart').innerHTML = days.map(day => `<div class="chart-item"><div class="chart-value">${day.count}</div><div class="chart-bar" style="height:${Math.max(4, day.count / max * 100)}%"></div><div class="chart-label">${day.label}</div></div>`).join('');

  const counts = { 'Dinheiro': 0, 'PIX': 0, 'Cartão': 0, 'Pago online': 0 };
  items.forEach(item => { if (counts[item.payment] !== undefined) counts[item.payment]++; });
  const total = items.length || 1;
  $('paymentReport').innerHTML = Object.entries(counts).map(([name, count]) => {
    const percent = Math.round(count / total * 100);
    return `<div class="pay-row"><div class="pay-top"><span class="payment-inline">${icon(paymentIcon(name))}<span>${esc(name)}</span></span><b>${count} · ${percent}%</b></div><div class="progress"><span style="width:${percent}%"></span></div></div>`;
  }).join('');

  const ranking = db.couriers.map(item => ({ name: item.name, count: items.filter(delivery => delivery.courierId === item.id).length })).sort((a, b) => b.count - a.count);
  const rankMax = Math.max(1, ...ranking.map(item => item.count));
  $('courierRanking').innerHTML = ranking.some(item => item.count) ? ranking.map((item, index) => `<div class="pay-row"><div class="pay-top"><span><b class="rank-number">${index + 1}</b> ${esc(item.name)}</span><b>${item.count}</b></div><div class="progress"><span style="width:${item.count / rankMax * 100}%"></span></div></div>`).join('') : empty('Sem dados suficientes', 'As entregas concluídas aparecerão aqui.', 'trophy');
}

// SETTINGS
function renderSettings() {
  $('storeName').value = db.settings.storeName;
  $('defaultFee').value = db.settings.defaultFee;
  $('settingEmail').value = db.settings.email;
  $('settingPassword').value = db.settings.password;
}

$('settingsForm').addEventListener('submit', event => {
  event.preventDefault();
  db.settings.storeName = $('storeName').value.trim() || 'X-Burguer Entregas';
  db.settings.defaultFee = Number($('defaultFee').value || 0);
  save();
  toast('Configurações atualizadas.');
  renderAll();
});

$('credentialsForm').addEventListener('submit', event => {
  event.preventDefault();
  const email = $('settingEmail').value.trim();
  const password = $('settingPassword').value;
  if (!email || !password) return toast('Informe e-mail e senha.', 'error');
  db.settings.email = email;
  db.settings.password = password;
  save();
  toast('Dados de acesso atualizados.');
});

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

$('backupBtn').addEventListener('click', () => {
  download(new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' }), `xburguer-backup-${dateKey()}.json`);
  toast('Backup gerado.');
});
$('restoreBtn').addEventListener('click', () => $('backupFile').click());
$('backupFile').addEventListener('change', event => {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!Array.isArray(imported.deliveries) || !Array.isArray(imported.couriers)) throw new Error('invalid');
      if (!confirm('Restaurar este backup? Os dados atuais serão substituídos.')) return;
      db = imported;
      save();
      toast('Backup restaurado.');
      setTimeout(() => location.reload(), 650);
    } catch {
      toast('Arquivo de backup inválido.', 'error');
    }
  };
  reader.readAsText(file);
});

$('clearDataBtn').addEventListener('click', () => {
  if (!confirm('Tem certeza? Todas as entregas e fechamentos serão apagados.')) return;
  db.deliveries = [];
  db.closings = [];
  save();
  toast('Entregas e fechamentos apagados.');
  renderAll();
});

$('exportCsvBtn').addEventListener('click', () => {
  const headers = ['Código', 'Data', 'Cliente', 'Telefone', 'Endereço', 'Entregador', 'Pedido', 'Taxa', 'Pagamento', 'Troco para', 'Observações', 'Status'];
  const rows = db.deliveries.map(item => [
    item.code,
    new Date(item.createdAt).toLocaleString('pt-BR'),
    item.client || '',
    item.phone || '',
    addressLabel(item),
    courier(item.courierId)?.name || '',
    Number(item.orderValue || 0).toFixed(2),
    Number(item.fee || 0).toFixed(2),
    item.payment || '',
    getChangeFor(item) || '',
    cleanLegacyChangeNote(item.notes || ''),
    item.status
  ]);
  const csv = [headers, ...rows].map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(';')).join('\n');
  download(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }), `xburguer-entregas-${dateKey()}.csv`);
  toast('CSV exportado.');
});

function renderAll() {
  $('todayLabel').textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  renderSelects();
  renderDashboard();
  renderDeliveries();
  renderCouriers();
  renderClosing();
  renderReports();
  renderSettings();
  if (!$('deliveryFee').value) $('deliveryFee').value = Number(db.settings.defaultFee).toFixed(2);
  syncPaymentFields();
  refreshIcons();
}

refreshIcons();
