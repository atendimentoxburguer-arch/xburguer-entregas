(() => {
  if (window.__xbOperationsProInstalled) return;
  window.__xbOperationsProInstalled = true;

  const normalizeText = value => String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');

  const safeNumber = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const sum = (items, field) => items.reduce((total, item) => total + safeNumber(item[field]), 0);
  const deliveredItems = items => (items || []).filter(item => item.status === 'Entregue');
  const pendingItems = items => (items || []).filter(item => item.status === 'Aguardando' || item.status === 'Em rota');

  function dateAtStart(value = new Date()) {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function dayItems(date, status = null) {
    const key = dateKey(date);
    return db.deliveries.filter(item => {
      const sameDay = dateKey(new Date(item.createdAt)) === key;
      return sameDay && (!status || item.status === status);
    });
  }

  function percentDelta(current, previous) {
    if (!previous) return current ? 100 : 0;
    return ((current - previous) / previous) * 100;
  }

  function deltaLabel(value) {
    const rounded = Math.round(value * 10) / 10;
    if (rounded === 0) return 'igual ao período anterior';
    return `${rounded > 0 ? '+' : ''}${rounded.toLocaleString('pt-BR')}%`;
  }

  function topPayment(items) {
    const map = new Map();
    deliveredItems(items).forEach(item => {
      const key = item.payment || 'Não informado';
      const row = map.get(key) || { name: key, count: 0, value: 0 };
      row.count += 1;
      row.value += safeNumber(item.orderValue);
      map.set(key, row);
    });
    return [...map.values()].sort((a, b) => b.value - a.value)[0] || null;
  }

  function topCourier(items) {
    const map = new Map();
    deliveredItems(items).forEach(item => {
      const key = item.courierId || '__none__';
      const person = courier(item.courierId);
      const row = map.get(key) || { name: person?.name || 'Sem entregador', count: 0, fees: 0 };
      row.count += 1;
      row.fees += safeNumber(item.fee);
      map.set(key, row);
    });
    return [...map.values()].sort((a, b) => b.count - a.count || b.fees - a.fees)[0] || null;
  }

  // ---------------------------------------------------------------------------
  // DASHBOARD MAIS GERENCIAL
  // ---------------------------------------------------------------------------
  function ensureManagerPanel() {
    let panel = document.getElementById('managerInsights');
    if (panel) return panel;
    const anchor = document.getElementById('opsPulse') || document.getElementById('dashboardStats');
    if (!anchor) return null;
    panel = document.createElement('section');
    panel.id = 'managerInsights';
    panel.className = 'manager-insights';
    anchor.insertAdjacentElement('afterend', panel);
    return panel;
  }

  function renderManagerPanel() {
    const panel = ensureManagerPanel();
    if (!panel) return;

    const today = todayDeliveries();
    const doneToday = deliveredItems(today);
    const pending = pendingItems(today);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const doneYesterday = deliveredItems(dayItems(yesterday));

    const revenueToday = sum(doneToday, 'orderValue');
    const revenueYesterday = sum(doneYesterday, 'orderValue');
    const revenueDelta = percentDelta(revenueToday, revenueYesterday);

    const sevenDaysStart = dateAtStart();
    sevenDaysStart.setDate(sevenDaysStart.getDate() - 6);
    const last7 = deliveredItems(db.deliveries.filter(item => new Date(item.createdAt) >= sevenDaysStart));
    const dailyAverage = sum(last7, 'orderValue') / 7;
    const payment = topPayment(doneToday);
    const courierTop = topCourier(doneToday);
    const pendingValue = sum(pending, 'orderValue');

    panel.innerHTML = `
      <div class="manager-insights-head">
        <div><span>VISÃO GERENCIAL</span><h3>Indicadores para decidir rápido</h3></div>
        <div class="manager-pending ${pending.length ? 'warn' : 'ok'}">${icon(pending.length ? 'wallet-cards' : 'circle-check-big')}<b>${pending.length}</b><span>${pending.length === 1 ? 'pagamento a conferir' : 'pagamentos a conferir'}${pending.length ? ` · ${money(pendingValue)}` : ''}</span></div>
      </div>
      <div class="manager-insights-grid">
        <article><div class="manager-icon">${icon('git-compare-arrows')}</div><span>Hoje x ontem</span><strong>${deltaLabel(revenueDelta)}</strong><small>${money(revenueToday)} hoje · ${money(revenueYesterday)} ontem</small></article>
        <article><div class="manager-icon">${icon('calendar-range')}</div><span>Média diária · 7 dias</span><strong>${money(dailyAverage)}</strong><small>${last7.length} entrega${last7.length === 1 ? '' : 's'} concluída${last7.length === 1 ? '' : 's'}</small></article>
        <article><div class="manager-icon">${icon('credit-card')}</div><span>Pagamento destaque</span><strong>${esc(payment?.name || 'Sem dados')}</strong><small>${payment ? `${payment.count} pedido${payment.count === 1 ? '' : 's'} · ${money(payment.value)}` : 'Nenhum pedido entregue hoje'}</small></article>
        <article><div class="manager-icon">${icon('trophy')}</div><span>Entregador destaque</span><strong>${esc(courierTop?.name || 'Sem dados')}</strong><small>${courierTop ? `${courierTop.count} entrega${courierTop.count === 1 ? '' : 's'} · ${money(courierTop.fees)} em taxas` : 'Nenhuma entrega concluída hoje'}</small></article>
      </div>`;
    refreshIcons();
  }

  const dashboardBeforePro = renderDashboard;
  renderDashboard = function xbManagerialDashboard() {
    dashboardBeforePro();
    renderManagerPanel();
  };

  // ---------------------------------------------------------------------------
  // TELA DE ENTREGAS MAIS RÁPIDA
  // ---------------------------------------------------------------------------
  let deliverySortMode = 'pending-first';

  if (typeof currentFilteredDeliveries === 'function') {
    const filteredBeforePro = currentFilteredDeliveries;
    currentFilteredDeliveries = function xbFastFilteredDeliveries() {
      const items = filteredBeforePro();
      const statusWeight = item => item.status === 'Aguardando' || item.status === 'Em rota' ? 0 : item.status === 'Entregue' ? 1 : 2;
      return [...items].sort((a, b) => {
        if (deliverySortMode === 'oldest') return new Date(a.createdAt) - new Date(b.createdAt);
        if (deliverySortMode === 'value-desc') return safeNumber(b.orderValue) - safeNumber(a.orderValue);
        if (deliverySortMode === 'value-asc') return safeNumber(a.orderValue) - safeNumber(b.orderValue);
        if (deliverySortMode === 'pending-first') {
          const diff = statusWeight(a) - statusWeight(b);
          return diff || new Date(b.createdAt) - new Date(a.createdAt);
        }
        return new Date(b.createdAt) - new Date(a.createdAt);
      });
    };
  }

  function ensureDeliverySpeedbar() {
    let bar = document.getElementById('deliverySpeedbar');
    if (bar) return bar;
    const toolbar = document.querySelector('#page-deliveries .table-toolbar');
    if (!toolbar) return null;
    bar = document.createElement('div');
    bar.id = 'deliverySpeedbar';
    bar.className = 'delivery-speedbar';
    bar.innerHTML = `
      <div class="delivery-quick-filters">
        <button type="button" data-fast-filter="today">${icon('calendar-days')}Hoje</button>
        <button type="button" data-fast-filter="pending">${icon('wallet-cards')}A conferir</button>
        <button type="button" data-fast-filter="delivered">${icon('circle-check-big')}Entregues</button>
        <button type="button" data-fast-filter="all">${icon('list')}Todos</button>
      </div>
      <label class="delivery-sort"><span>Ordenar</span><select id="deliverySort"><option value="pending-first">Pendentes primeiro</option><option value="newest">Mais recentes</option><option value="oldest">Mais antigas</option><option value="value-desc">Maior valor</option><option value="value-asc">Menor valor</option></select></label>`;
    toolbar.insertAdjacentElement('beforebegin', bar);

    bar.addEventListener('click', event => {
      const button = event.target.closest('[data-fast-filter]');
      if (!button) return;
      const status = document.getElementById('statusFilter');
      const date = document.getElementById('dateFilter');
      const mode = button.dataset.fastFilter;
      if (mode === 'today') { if (date) date.value = 'today'; if (status) status.value = ''; }
      if (mode === 'pending') { if (date) date.value = 'today'; if (status) status.value = 'Aguardando'; }
      if (mode === 'delivered') { if (date) date.value = 'today'; if (status) status.value = 'Entregue'; }
      if (mode === 'all') { if (date) date.value = 'all'; if (status) status.value = ''; }
      renderDeliveries();
    });

    document.getElementById('deliverySort')?.addEventListener('change', event => {
      deliverySortMode = event.target.value;
      renderDeliveries();
    });
    refreshIcons();
    return bar;
  }

  function updateFastFilterState() {
    const bar = ensureDeliverySpeedbar();
    if (!bar) return;
    const status = document.getElementById('statusFilter')?.value || '';
    const date = document.getElementById('dateFilter')?.value || '';
    bar.querySelectorAll('[data-fast-filter]').forEach(button => button.classList.remove('active'));
    let mode = '';
    if (date === 'today' && !status) mode = 'today';
    else if (date === 'today' && status === 'Aguardando') mode = 'pending';
    else if (date === 'today' && status === 'Entregue') mode = 'delivered';
    else if (date === 'all' && !status) mode = 'all';
    bar.querySelector(`[data-fast-filter="${mode}"]`)?.classList.add('active');
  }

  function emphasizePendingRows() {
    document.querySelectorAll('#deliveriesTable tbody tr').forEach(row => {
      const isPending = row.querySelector('.status.waiting');
      row.classList.toggle('payment-pending-row', Boolean(isPending));
    });
  }

  const deliveriesBeforePro = renderDeliveries;
  renderDeliveries = function xbFastDeliveries() {
    deliveriesBeforePro();
    ensureDeliverySpeedbar();
    updateFastFilterState();
    emphasizePendingRows();
  };

  ['statusFilter', 'dateFilter', 'deliverySearch'].forEach(id => {
    document.getElementById(id)?.addEventListener(id === 'deliverySearch' ? 'input' : 'change', () => {
      queueMicrotask(() => {
        updateFastFilterState();
        emphasizePendingRows();
      });
    });
  });

  // ---------------------------------------------------------------------------
  // RELATÓRIOS MELHORES
  // ---------------------------------------------------------------------------
  function comparisonItems(range) {
    if (range === 'all') return [];
    const days = Number(range || 7);
    const currentStart = new Date();
    currentStart.setDate(currentStart.getDate() - days);
    const previousStart = new Date(currentStart);
    previousStart.setDate(previousStart.getDate() - days);
    return db.deliveries.filter(item => item.status === 'Entregue' && new Date(item.createdAt) >= previousStart && new Date(item.createdAt) < currentStart);
  }

  function bestRevenueDay(items) {
    const map = new Map();
    deliveredItems(items).forEach(item => {
      const key = dateKey(new Date(item.createdAt));
      map.set(key, (map.get(key) || 0) + safeNumber(item.orderValue));
    });
    const best = [...map.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!best) return null;
    const [year, month, day] = best[0].split('-').map(Number);
    return { label: new Date(year, month - 1, day).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }), value: best[1] };
  }

  function ensureReportInsights() {
    let panel = document.getElementById('reportInsights');
    if (panel) return panel;
    const stats = document.getElementById('reportStats');
    if (!stats) return null;
    panel = document.createElement('div');
    panel.id = 'reportInsights';
    panel.className = 'report-insights';
    stats.insertAdjacentElement('afterend', panel);
    return panel;
  }

  function renderReportEnhancements() {
    const items = reportItems();
    const range = document.getElementById('reportRange')?.value || '7';
    const previous = comparisonItems(range);
    const revenue = sum(items, 'orderValue');
    const previousRevenue = sum(previous, 'orderValue');
    const ticket = items.length ? revenue / items.length : 0;
    const previousTicket = previous.length ? previousRevenue / previous.length : 0;
    const payment = topPayment(items);
    const bestDay = bestRevenueDay(items);

    const panel = ensureReportInsights();
    if (panel) {
      const revenueComparison = range === 'all' ? 'Todo o histórico' : deltaLabel(percentDelta(revenue, previousRevenue));
      const ticketComparison = range === 'all' ? 'Período completo' : deltaLabel(percentDelta(ticket, previousTicket));
      panel.innerHTML = `
        <article>${icon('trending-up')}<div><span>Faturamento x período anterior</span><strong>${revenueComparison}</strong><small>${money(revenue)} no período selecionado</small></div></article>
        <article>${icon('receipt-text')}<div><span>Ticket médio x período anterior</span><strong>${ticketComparison}</strong><small>Ticket atual ${money(ticket)}</small></div></article>
        <article>${icon('credit-card')}<div><span>Forma de pagamento líder</span><strong>${esc(payment?.name || 'Sem dados')}</strong><small>${payment ? `${money(payment.value)} · ${payment.count} pedido${payment.count === 1 ? '' : 's'}` : 'Nenhuma entrega concluída'}</small></div></article>
        <article>${icon('calendar-check')}<div><span>Melhor dia em faturamento</span><strong>${bestDay?.label || 'Sem dados'}</strong><small>${bestDay ? money(bestDay.value) : 'Nenhuma entrega concluída'}</small></div></article>`;
    }

    const paymentBox = document.getElementById('paymentReport');
    if (paymentBox) {
      const methods = ['Dinheiro', 'PIX', 'Cartão', 'Pago online'];
      const totalRevenue = revenue || 1;
      paymentBox.innerHTML = methods.map(name => {
        const rows = items.filter(item => item.payment === name);
        const value = sum(rows, 'orderValue');
        const percent = Math.round(value / totalRevenue * 100);
        return `<div class="pay-row"><div class="pay-top"><span class="payment-inline">${icon(paymentIcon(name))}<span>${esc(name)}</span></span><b>${money(value)}</b></div><div class="report-row-meta"><span>${rows.length} pedido${rows.length === 1 ? '' : 's'}</span><span>${percent}% do faturamento</span></div><div class="progress"><span style="width:${percent}%"></span></div></div>`;
      }).join('');
    }

    const rankingBox = document.getElementById('courierRanking');
    if (rankingBox) {
      const ranking = db.couriers.map(person => {
        const rows = items.filter(item => item.courierId === person.id);
        return { name: person.name, count: rows.length, fees: sum(rows, 'fee'), revenue: sum(rows, 'orderValue') };
      }).filter(row => row.count).sort((a, b) => b.count - a.count || b.revenue - a.revenue);
      rankingBox.innerHTML = ranking.length ? ranking.map((row, index) => `<div class="ranking-pro-row"><span class="rank-number">${index + 1}</span><div><strong>${esc(row.name)}</strong><small>${row.count} entrega${row.count === 1 ? '' : 's'} · ${money(row.fees)} em taxas</small></div><b>${money(row.revenue)}</b></div>`).join('') : empty('Sem dados suficientes', 'As entregas concluídas aparecerão aqui.', 'trophy');
    }
    refreshIcons();
  }

  const reportsBeforePro = renderReports;
  renderReports = function xbBetterReports() {
    reportsBeforePro();
    renderReportEnhancements();
  };

  document.getElementById('reportRange')?.addEventListener('change', () => queueMicrotask(renderReportEnhancements));

  // ---------------------------------------------------------------------------
  // PROTEÇÃO CONTRA ERROS
  // ---------------------------------------------------------------------------
  function findPossibleDuplicate() {
    const address = normalizeText(document.getElementById('deliveryAddress')?.value);
    const orderValue = safeNumber(document.getElementById('deliveryValue')?.value);
    if (!address || orderValue <= 0) return null;
    const limit = Date.now() - 15 * 60 * 1000;
    return [...db.deliveries].reverse().find(item => {
      if (item.status === 'Cancelada') return false;
      const created = new Date(item.createdAt).getTime();
      return created >= limit && normalizeText(item.address) === address && Math.abs(safeNumber(item.orderValue) - orderValue) < 0.01;
    }) || null;
  }

  const deliveryForm = document.getElementById('deliveryForm');
  deliveryForm?.addEventListener('submit', async event => {
    if (deliveryForm.dataset.allowDuplicate === '1') {
      delete deliveryForm.dataset.allowDuplicate;
      return;
    }
    const duplicate = findPossibleDuplicate();
    if (!duplicate) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const ok = typeof window.xbConfirm === 'function'
      ? await window.xbConfirm({
          title: 'Possível pedido duplicado',
          text: 'Já existe uma entrega recente com o mesmo endereço e o mesmo valor.',
          detail: `Pedido #${String(duplicate.code).padStart(3, '0')} · ${money(duplicate.orderValue)} · ${esc(duplicate.address || '')}`,
          warning: 'Confirme apenas se realmente forem dois pedidos diferentes.',
          confirmText: 'Cadastrar mesmo assim',
          cancelText: 'Voltar e conferir',
          icon: 'copy-check',
          kicker: 'PROTEÇÃO CONTRA DUPLICIDADE',
          tone: 'warning'
        })
      : window.confirm('Existe um pedido recente com o mesmo endereço e valor. Cadastrar mesmo assim?');
    if (!ok) return;
    deliveryForm.dataset.allowDuplicate = '1';
    deliveryForm.requestSubmit();
  }, true);

  document.addEventListener('click', event => {
    const button = event.target.closest('#closeDayBtn');
    if (!button) return;
    const pending = pendingItems(todayDeliveries());
    if (!pending.length) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    toast(`Ainda existem ${pending.length} pagamento${pending.length === 1 ? '' : 's'} para conferir. Finalize-os antes de fechar o dia.`, 'error');
    go('deliveries');
    const status = document.getElementById('statusFilter');
    const date = document.getElementById('dateFilter');
    if (status) status.value = 'Aguardando';
    if (date) date.value = 'today';
    renderDeliveries();
  }, true);

  // ---------------------------------------------------------------------------
  // ESTILOS
  // ---------------------------------------------------------------------------
  if (!document.getElementById('xbOperationsProStyle')) {
    const style = document.createElement('style');
    style.id = 'xbOperationsProStyle';
    style.textContent = `
      .manager-insights{margin:18px 0 20px;padding:18px;border:1px solid #e4d5ca;border-radius:20px;background:linear-gradient(135deg,#fffaf6,#f4e7de);box-shadow:0 12px 30px rgba(73,35,22,.06)}
      .manager-insights-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:14px}.manager-insights-head>div:first-child span{font-size:.72rem;font-weight:850;letter-spacing:.09em;color:#a80712}.manager-insights-head h3{margin:3px 0 0;font-size:1.05rem}.manager-pending{display:flex;align-items:center;gap:7px;padding:8px 11px;border-radius:999px;font-size:.8rem;font-weight:750}.manager-pending.warn{background:#fff2e5;color:#9a5a05;border:1px solid #efd5aa}.manager-pending.ok{background:#edf9f2;color:#15764b;border:1px solid #cce8d7}.manager-pending svg{width:16px;height:16px}
      .manager-insights-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.manager-insights-grid article{min-width:0;padding:14px;border:1px solid #e9dbd1;border-radius:15px;background:rgba(255,255,255,.72)}.manager-icon{width:30px;height:30px;display:grid;place-items:center;margin-bottom:10px;border-radius:10px;background:#fff0f1;color:#a80712}.manager-icon svg{width:16px;height:16px}.manager-insights-grid span,.manager-insights-grid small{display:block;color:#766963;font-size:.76rem}.manager-insights-grid strong{display:block;margin:4px 0;font-size:1rem;color:#211917;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .delivery-speedbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 10px;padding:10px 12px;border:1px solid #e6d8ce;border-radius:15px;background:linear-gradient(135deg,#fffaf6,#f3e7de)}.delivery-quick-filters{display:flex;gap:7px;flex-wrap:wrap}.delivery-quick-filters button{display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:0 11px;border:1px solid #dfd0c5;border-radius:10px;background:#fffaf7;color:#61554e;font:inherit;font-size:.78rem;font-weight:800;cursor:pointer}.delivery-quick-filters button.active{border-color:#bd1822;background:linear-gradient(135deg,#a80712,#cf1823);color:#fff;box-shadow:0 7px 16px rgba(168,7,18,.15)}.delivery-quick-filters svg{width:15px;height:15px}.delivery-sort{display:flex;align-items:center;gap:8px;color:#766963;font-size:.76rem;font-weight:750}.delivery-sort select{min-height:36px;border:1px solid #d9c9bd;border-radius:10px;background:#fff;padding:0 30px 0 10px;font:inherit;font-size:.78rem;font-weight:750;color:#3f3530}.payment-pending-row{background:linear-gradient(90deg,rgba(255,248,231,.88),rgba(255,253,249,.8))!important}.payment-pending-row td:first-child{box-shadow:inset 3px 0 #e0a52b}
      .report-insights{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:0 0 18px}.report-insights article{display:flex;gap:11px;align-items:flex-start;padding:14px;border:1px solid #e6d8ce;border-radius:15px;background:linear-gradient(135deg,#fffaf6,#f5e9e1)}.report-insights article>svg{width:19px;height:19px;flex:0 0 auto;color:#a80712;margin-top:2px}.report-insights span,.report-insights small{display:block;color:#766963;font-size:.75rem}.report-insights strong{display:block;margin:3px 0;color:#211917;font-size:.98rem}.report-row-meta{display:flex;justify-content:space-between;gap:10px;margin:5px 0 7px;color:#776a63;font-size:.76rem;font-weight:700}.ranking-pro-row{display:grid;grid-template-columns:30px minmax(0,1fr) auto;gap:10px;align-items:center;padding:12px 0;border-bottom:1px dashed #e7dcd4}.ranking-pro-row:last-child{border-bottom:0}.ranking-pro-row .rank-number{width:28px;height:28px;display:grid;place-items:center;border-radius:9px;background:#fff0f1;color:#a80712;font-weight:850}.ranking-pro-row strong,.ranking-pro-row small{display:block}.ranking-pro-row small{margin-top:3px;color:#7b6d66;font-size:.75rem}.ranking-pro-row>b{font-size:.85rem;color:#332824}
      @media(max-width:1050px){.manager-insights-grid,.report-insights{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:700px){.manager-insights-head,.delivery-speedbar{align-items:stretch;flex-direction:column}.manager-insights-grid,.report-insights{grid-template-columns:1fr}.delivery-sort{justify-content:space-between}.delivery-sort select{flex:1}.manager-pending{width:max-content;max-width:100%}}
    `;
    document.head.appendChild(style);
  }

  ensureDeliverySpeedbar();
  renderDashboard();
  renderDeliveries();
  renderReports();
  refreshIcons();
})();
