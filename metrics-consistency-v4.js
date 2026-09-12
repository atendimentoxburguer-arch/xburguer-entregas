(() => {
  if (window.__xbMetricsConsistencyV4Installed) return;
  window.__xbMetricsConsistencyV4Installed = true;

  const BUSINESS_TZ = 'America/Sao_Paulo';
  const PAYMENTS = ['Dinheiro', 'PIX', 'Cartão', 'Pago online'];
  const isDelivered = item => item?.status === 'Entregue';
  const isCancelled = item => item?.status === 'Cancelada';
  const isPending = item => item?.status === 'Aguardando' || item?.status === 'Em rota';
  const isFeePayable = item => isDelivered(item) || isCancelled(item);
  const numberValue = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const cents = value => Math.round(numberValue(value) * 100);
  const fromCents = value => Math.round(Number(value || 0)) / 100;
  const sumMoney = (items, selector) => fromCents((items || []).reduce((total, item) => {
    const value = typeof selector === 'function' ? selector(item) : item?.[selector];
    return total + cents(value);
  }, 0));
  const averageMoney = (items, selector) => (items || []).length ? fromCents(Math.round(cents(sumMoney(items, selector)) / items.length)) : 0;

  const dateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit'
  });

  function dayKey(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const parts = Object.fromEntries(dateFormatter.formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function addDaysKey(key, delta) {
    const [year, month, day] = String(key || '').split('-').map(Number);
    if (!year || !month || !day) return '';
    const value = new Date(Date.UTC(year, month - 1, day));
    value.setUTCDate(value.getUTCDate() + Number(delta || 0));
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
  }

  function filterRangeSafe(items, range = 'all') {
    const list = Array.isArray(items) ? items : [];
    if (range === 'all' || range === '' || range == null) return [...list];
    const today = dayKey();
    if (range === 'today') return list.filter(item => dayKey(item?.createdAt) === today);
    const days = Math.max(1, Math.floor(numberValue(range) || 1));
    const start = addDaysKey(today, -(days - 1));
    return list.filter(item => {
      const key = dayKey(item?.createdAt);
      return key && key >= start && key <= today;
    });
  }

  function forDay(items, key) {
    return (items || []).filter(item => dayKey(item?.createdAt) === key);
  }

  function periodKeys(range) {
    const today = dayKey();
    if (range === 'all') return null;
    const days = Math.max(1, Math.floor(numberValue(range) || 7));
    const start = addDaysKey(today, -(days - 1));
    return { start, end: today, days };
  }

  function previousPeriod(range) {
    const current = periodKeys(range);
    if (!current) return null;
    const end = addDaysKey(current.start, -1);
    const start = addDaysKey(end, -(current.days - 1));
    return { start, end, days: current.days };
  }

  function itemsBetween(items, bounds) {
    if (!bounds) return [];
    return (items || []).filter(item => {
      const key = dayKey(item?.createdAt);
      return key && key >= bounds.start && key <= bounds.end;
    });
  }

  function selectedReportDelivered() {
    const specific = window.XBReportDateFilter?.selectedDate || '';
    if (specific) return forDay(db.deliveries || [], specific).filter(isDelivered);
    return filterRangeSafe((db.deliveries || []).filter(isDelivered), document.getElementById('reportRange')?.value || '7');
  }

  function selectedReportFees() {
    const specific = window.XBReportDateFilter?.selectedDate || '';
    const feeItems = (db.deliveries || []).filter(isFeePayable);
    if (specific) return forDay(feeItems, specific);
    return filterRangeSafe(feeItems, document.getElementById('reportRange')?.value || '7');
  }

  function stats(items) {
    const list = Array.isArray(items) ? items : [];
    const deliveredRows = list.filter(isDelivered);
    const cancelledRows = list.filter(isCancelled);
    const pendingRows = list.filter(isPending);
    const feeRows = list.filter(isFeePayable);
    const paymentPending = pendingRows.filter(item => item.payment !== 'Pago online');
    const onlinePending = pendingRows.filter(item => item.payment === 'Pago online');
    return {
      total: list.length,
      delivered: deliveredRows.length,
      cancelled: cancelledRows.length,
      pending: pendingRows.length,
      paymentPending: paymentPending.length,
      onlinePending: onlinePending.length,
      revenue: sumMoney(deliveredRows, 'orderValue'),
      fees: sumMoney(feeRows, 'fee'),
      cancelledFees: sumMoney(cancelledRows, 'fee'),
      ticket: deliveredRows.length ? fromCents(Math.round(cents(sumMoney(deliveredRows, 'orderValue')) / deliveredRows.length)) : 0,
      deliveredRows,
      cancelledRows,
      pendingRows,
      feeRows,
      paymentPendingRows: paymentPending,
      onlinePendingRows: onlinePending
    };
  }

  function paymentBreakdown(items) {
    const deliveredRows = (items || []).filter(isDelivered);
    return PAYMENTS.map(name => {
      const rows = deliveredRows.filter(item => item.payment === name);
      return { name, count: rows.length, value: sumMoney(rows, 'orderValue') };
    });
  }

  function normalizeClosingDetails(details) {
    if (!details || typeof details !== 'object') return false;
    let changed = false;
    const payments = Array.isArray(details.payments) ? details.payments : [];
    const couriers = Array.isArray(details.couriers) ? details.couriers : [];

    payments.forEach(row => {
      const next = fromCents(cents(row?.value));
      if (numberValue(row?.value) !== next) { row.value = next; changed = true; }
      const count = Math.max(0, Math.floor(numberValue(row?.count)));
      if (numberValue(row?.count) !== count) { row.count = count; changed = true; }
    });
    couriers.forEach(row => {
      ['fees', 'cancelledFees'].forEach(field => {
        const next = fromCents(cents(row?.[field]));
        if (numberValue(row?.[field]) !== next) { row[field] = next; changed = true; }
      });
      ['count', 'cancelled'].forEach(field => {
        const next = Math.max(0, Math.floor(numberValue(row?.[field])));
        if (numberValue(row?.[field]) !== next) { row[field] = next; changed = true; }
      });
    });

    if (payments.length) {
      const totalDeliveries = payments.reduce((total, row) => total + Math.max(0, Math.floor(numberValue(row.count))), 0);
      const totalOrderValue = fromCents(payments.reduce((total, row) => total + cents(row.value), 0));
      if (numberValue(details.totalDeliveries) !== totalDeliveries) { details.totalDeliveries = totalDeliveries; changed = true; }
      if (numberValue(details.totalOrderValue) !== totalOrderValue) { details.totalOrderValue = totalOrderValue; changed = true; }
    } else {
      const rounded = fromCents(cents(details.totalOrderValue));
      if (numberValue(details.totalOrderValue) !== rounded) { details.totalOrderValue = rounded; changed = true; }
    }

    if (couriers.length) {
      const totalFees = fromCents(couriers.reduce((total, row) => total + cents(row.fees), 0));
      const cancelledDeliveries = couriers.reduce((total, row) => total + Math.max(0, Math.floor(numberValue(row.cancelled))), 0);
      const cancelledFees = fromCents(couriers.reduce((total, row) => total + cents(row.cancelledFees), 0));
      if (numberValue(details.totalFees) !== totalFees) { details.totalFees = totalFees; changed = true; }
      if (numberValue(details.cancelledDeliveries) !== cancelledDeliveries) { details.cancelledDeliveries = cancelledDeliveries; changed = true; }
      if (numberValue(details.cancelledFees) !== cancelledFees) { details.cancelledFees = cancelledFees; changed = true; }
    } else {
      ['totalFees', 'cancelledFees'].forEach(field => {
        const next = fromCents(cents(details[field]));
        if (numberValue(details[field]) !== next) { details[field] = next; changed = true; }
      });
    }
    details.pending = Math.max(0, Math.floor(numberValue(details.pending)));
    return changed;
  }

  function repairClosings() {
    let changed = false;
    (db.closings || []).forEach(closing => {
      if (normalizeClosingDetails(closing?.detailsV2)) {
        if ('orderValue' in closing) closing.orderValue = fromCents(cents(closing.detailsV2.totalOrderValue));
        if ('fees' in closing) closing.fees = fromCents(cents(closing.detailsV2.totalFees));
        if ('delivered' in closing) closing.delivered = Math.max(0, Math.floor(numberValue(closing.detailsV2.totalDeliveries)));
        changed = true;
      }
    });
    if (changed && typeof save === 'function') save();
    return changed;
  }

  function setStat(containerId, label, value, detail) {
    const cards = [...(document.getElementById(containerId)?.querySelectorAll('.stat') || [])];
    const card = cards.find(item => item.querySelector('.stat-label')?.textContent.trim() === label);
    if (!card) return;
    const valueNode = card.querySelector('.stat-value');
    const detailNode = card.querySelector('.stat-detail');
    if (valueNode) valueNode.textContent = String(value);
    if (detailNode && detail !== undefined) detailNode.textContent = detail;
  }

  function patchDashboard() {
    const data = stats(forDay(db.deliveries || [], dayKey()));
    setStat('dashboardStats', 'Entregas hoje', data.total, 'Total');
    setStat('dashboardStats', 'Pagamentos a conferir', data.paymentPending, 'Pendentes');
    setStat('dashboardStats', 'Pagos online', data.onlinePending, 'Aguardando entrega');
    setStat('dashboardStats', 'Entregues', data.delivered, 'Hoje');
    setStat('dashboardStats', 'Pedidos entregues', money(data.revenue), 'Hoje');
    setStat('dashboardStats', 'Ticket médio', money(data.ticket), 'Hoje');

    const summaryRows = [...(document.getElementById('operationSummary')?.querySelectorAll('.summary-row') || [])];
    summaryRows.forEach(row => {
      const label = row.querySelector('span')?.textContent.trim();
      const value = row.querySelector('b');
      if (!value) return;
      if (label === 'Pagamentos a conferir') value.textContent = String(data.paymentPending);
      if (label === 'Pagos online aguardando entrega') value.textContent = String(data.onlinePending);
      if (label === 'Entregues hoje') value.textContent = String(data.delivered);
      if (label === 'Taxas dos entregadores' || label === 'Taxas realizadas') value.textContent = money(data.fees);
    });
  }

  function patchDeliveries() {
    const range = document.getElementById('dateFilter')?.value || 'today';
    const data = stats(filterRangeSafe(db.deliveries || [], range));
    const cards = [...(document.getElementById('deliveryStats')?.querySelectorAll('.stat') || [])];
    const values = [
      [data.total, 'Total de entregas', ''],
      [data.paymentPending, 'Pagamento a conferir', 'Pendentes'],
      [data.onlinePending, 'Pagos online', 'Aguardando entrega'],
      [data.delivered, 'Entregues', '']
    ];
    cards.slice(0, 4).forEach((card, index) => {
      const [value, label, detail] = values[index];
      const valueNode = card.querySelector('.stat-value');
      const labelNode = card.querySelector('.stat-label');
      const detailNode = card.querySelector('.stat-detail');
      if (valueNode) valueNode.textContent = String(value);
      if (labelNode) labelNode.textContent = label;
      if (detailNode) detailNode.textContent = detail;
    });
  }

  function patchCouriers() {
    const cards = [...document.querySelectorAll('#courierGrid .courier-card')];
    cards.forEach((card, index) => {
      const person = db.couriers?.[index];
      if (!person) return;
      const payable = (db.deliveries || []).filter(item => item.courierId === person.id && isFeePayable(item));
      const fee = sumMoney(payable, 'fee');
      const rows = card.querySelectorAll('.courier-data');
      const countBlock = rows[0]?.children?.[1];
      const feeBlock = rows[1]?.children?.[0];
      if (countBlock) {
        const label = countBlock.querySelector('span');
        const value = countBlock.querySelector('strong');
        if (label) label.textContent = 'Entregas com taxa';
        if (value) value.textContent = String(payable.length);
      }
      if (feeBlock) {
        const label = feeBlock.querySelector('span');
        const value = feeBlock.querySelector('strong');
        if (label) label.textContent = 'Taxas a receber';
        if (value) value.textContent = money(fee);
      }
    });
  }

  function deltaLabel(current, previous) {
    if (!previous) return current ? 'sem base no período anterior' : 'igual ao período anterior';
    const delta = Math.round((((current - previous) / previous) * 100) * 10) / 10;
    if (!delta) return 'igual ao período anterior';
    return `${delta > 0 ? '+' : ''}${delta.toLocaleString('pt-BR')}%`;
  }

  function topPayment(items) {
    return paymentBreakdown(items).sort((a, b) => b.value - a.value || b.count - a.count)[0] || null;
  }

  function bestRevenueDay(items) {
    const map = new Map();
    (items || []).filter(isDelivered).forEach(item => {
      const key = dayKey(item.createdAt);
      map.set(key, (map.get(key) || 0) + cents(item.orderValue));
    });
    const best = [...map.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!best) return null;
    const [year, month, day] = best[0].split('-').map(Number);
    return { label: `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}`, value: fromCents(best[1]), key: best[0] };
  }

  function reportPeriodData() {
    const specific = window.XBReportDateFilter?.selectedDate || '';
    const currentDelivered = selectedReportDelivered();
    const currentFees = selectedReportFees();
    let previousDelivered = [];
    if (specific) {
      previousDelivered = forDay(db.deliveries || [], addDaysKey(specific, -1)).filter(isDelivered);
    } else {
      const range = document.getElementById('reportRange')?.value || '7';
      const bounds = previousPeriod(range);
      previousDelivered = bounds ? itemsBetween((db.deliveries || []).filter(isDelivered), bounds) : [];
    }
    return { specific, currentDelivered, currentFees, previousDelivered };
  }

  function patchReports() {
    const { specific, currentDelivered, currentFees, previousDelivered } = reportPeriodData();
    const revenue = sumMoney(currentDelivered, 'orderValue');
    const fees = sumMoney(currentFees, 'fee');
    const ticket = currentDelivered.length ? fromCents(Math.round(cents(revenue) / currentDelivered.length)) : 0;
    const previousRevenue = sumMoney(previousDelivered, 'orderValue');
    const previousTicket = previousDelivered.length ? fromCents(Math.round(cents(previousRevenue) / previousDelivered.length)) : 0;

    setStat('reportStats', 'Faturamento', money(revenue));
    setStat('reportStats', 'Taxas de entrega', money(fees), currentFees.some(isCancelled) ? 'Inclui canceladas' : 'Entregadores');
    setStat('reportStats', 'Entregas', currentDelivered.length);
    setStat('reportStats', 'Ticket médio', money(ticket));

    const paymentBox = document.getElementById('paymentReport');
    if (paymentBox) {
      const breakdown = paymentBreakdown(currentDelivered);
      const totalCents = cents(revenue);
      paymentBox.innerHTML = breakdown.map(row => {
        const percent = totalCents ? Math.round(cents(row.value) / totalCents * 100) : 0;
        return `<div class="pay-row"><div class="pay-top"><span class="payment-inline">${icon(paymentIcon(row.name))}<span>${esc(row.name)}</span></span><b>${money(row.value)}</b></div><div class="report-row-meta"><span>${row.count} pedido${row.count === 1 ? '' : 's'}</span><span>${percent}% do faturamento</span></div><div class="progress"><span style="width:${Math.max(0, Math.min(100, percent))}%"></span></div></div>`;
      }).join('');
    }

    const panel = document.getElementById('reportInsights');
    if (panel) {
      const range = document.getElementById('reportRange')?.value || '7';
      const payment = topPayment(currentDelivered);
      const bestDay = bestRevenueDay(currentDelivered);
      const allTime = !specific && range === 'all';
      panel.innerHTML = `
        <article>${icon('trending-up')}<div><span>Faturamento x ${specific ? 'dia anterior' : 'período anterior'}</span><strong>${allTime ? 'Todo o histórico' : deltaLabel(revenue, previousRevenue)}</strong><small>${money(revenue)} no período selecionado</small></div></article>
        <article>${icon('receipt-text')}<div><span>Ticket médio x ${specific ? 'dia anterior' : 'período anterior'}</span><strong>${allTime ? 'Período completo' : deltaLabel(ticket, previousTicket)}</strong><small>Ticket atual ${money(ticket)}</small></div></article>
        <article>${icon('credit-card')}<div><span>Forma de pagamento líder</span><strong>${esc(payment?.name || 'Sem dados')}</strong><small>${payment && payment.count ? `${money(payment.value)} · ${payment.count} pedido${payment.count === 1 ? '' : 's'}` : 'Nenhuma entrega concluída'}</small></div></article>
        <article>${icon('calendar-check')}<div><span>Melhor dia em faturamento</span><strong>${bestDay?.label || 'Sem dados'}</strong><small>${bestDay ? money(bestDay.value) : 'Nenhuma entrega concluída'}</small></div></article>`;
    }

    const rankingBox = document.getElementById('courierRanking');
    if (rankingBox) {
      const ranking = (db.couriers || []).map(person => {
        const deliveredRows = currentDelivered.filter(item => item.courierId === person.id);
        const payableRows = currentFees.filter(item => item.courierId === person.id);
        return {
          name: person.name,
          delivered: deliveredRows.length,
          payable: payableRows.length,
          cancelled: payableRows.filter(isCancelled).length,
          fees: sumMoney(payableRows, 'fee'),
          revenue: sumMoney(deliveredRows, 'orderValue')
        };
      }).filter(row => row.delivered || row.payable || row.fees)
        .sort((a, b) => b.payable - a.payable || b.fees - a.fees || b.revenue - a.revenue);
      rankingBox.innerHTML = ranking.length ? ranking.map((row, index) => `
        <div class="ranking-pro-row"><span class="rank-number">${index + 1}</span><div><strong>${esc(row.name)}</strong><small>${row.payable} entrega${row.payable === 1 ? '' : 's'} com taxa${row.cancelled ? ` · ${row.cancelled} cancelada${row.cancelled === 1 ? '' : 's'}` : ''} · ${money(row.fees)} em taxas</small></div><b>${money(row.revenue)}</b></div>`).join('') : empty('Sem dados suficientes', 'As entregas e taxas aparecerão aqui.', 'trophy');
    }
  }

  function patchClosing() {
    const closing = (db.closings || []).find(item => item.date === dayKey());
    const details = closing?.detailsV2;
    if (!details) {
      const data = stats(forDay(db.deliveries || [], dayKey()));
      setStat('closingStats', 'Entregas concluídas', data.delivered, 'Hoje');
      setStat('closingStats', 'Valor total', money(data.revenue), 'Pedidos');
      setStat('closingStats', 'Total em taxas', money(data.fees), data.cancelled ? 'Inclui canceladas' : 'Entregadores');
      setStat('closingStats', 'Pendentes', data.pending, 'Hoje');
      setStat('closingStats', 'Ticket médio', money(data.ticket), 'Pedidos entregues');
      return;
    }
    normalizeClosingDetails(details);
    const deliveredCount = Math.max(0, Math.floor(numberValue(details.totalDeliveries)));
    const revenue = fromCents(cents(details.totalOrderValue));
    const fees = fromCents(cents(details.totalFees));
    const ticket = deliveredCount ? fromCents(Math.round(cents(revenue) / deliveredCount)) : 0;
    setStat('closingStats', 'Entregas concluídas', deliveredCount, 'Hoje');
    setStat('closingStats', 'Valor total', money(revenue), 'Pedidos');
    setStat('closingStats', 'Total em taxas', money(fees), numberValue(details.cancelledDeliveries) ? 'Inclui canceladas' : 'Entregadores');
    setStat('closingStats', 'Pendentes', Math.max(0, Math.floor(numberValue(details.pending))), 'Hoje');
    setStat('closingStats', 'Ticket médio', money(ticket), 'Pedidos entregues');
  }

  function diagnostics() {
    const issues = [];
    const all = db.deliveries || [];
    all.forEach(item => {
      if (!dayKey(item.createdAt)) issues.push(`Pedido #${item.code || '?'} sem data válida`);
      if (cents(item.orderValue) < 0) issues.push(`Pedido #${item.code || '?'} com valor negativo`);
      if (cents(item.fee) < 0) issues.push(`Pedido #${item.code || '?'} com taxa negativa`);
      if (item.payment !== 'Dinheiro' && item.changeFor !== '' && item.changeFor !== null && item.changeFor !== undefined) issues.push(`Pedido #${item.code || '?'} com troco indevido`);
      if (item.payment === 'Dinheiro' && item.changeFor !== '' && item.changeFor !== null && item.changeFor !== undefined && cents(item.changeFor) < cents(item.orderValue)) issues.push(`Pedido #${item.code || '?'} com troco menor que o pedido`);
    });
    (db.closings || []).forEach(closing => {
      const details = closing?.detailsV2;
      if (!details) return;
      const paymentCount = (details.payments || []).reduce((total, row) => total + Math.max(0, Math.floor(numberValue(row.count))), 0);
      const paymentValue = fromCents((details.payments || []).reduce((total, row) => total + cents(row.value), 0));
      const courierFees = fromCents((details.couriers || []).reduce((total, row) => total + cents(row.fees), 0));
      if (paymentCount !== Math.max(0, Math.floor(numberValue(details.totalDeliveries)))) issues.push(`Fechamento ${closing.date}: quantidade divergente`);
      if (cents(paymentValue) !== cents(details.totalOrderValue)) issues.push(`Fechamento ${closing.date}: valor divergente`);
      if (cents(courierFees) !== cents(details.totalFees)) issues.push(`Fechamento ${closing.date}: taxas divergentes`);
    });
    return { ok: issues.length === 0, issues };
  }

  // Substitui cálculos de data por dias de calendário da operação, não por janelas de horas.
  if (typeof dateKey === 'function') dateKey = dayKey;
  if (typeof filterRange === 'function') filterRange = filterRangeSafe;
  if (typeof todayDeliveries === 'function') todayDeliveries = () => forDay(db.deliveries || [], dayKey());
  if (typeof reportItems === 'function') reportItems = selectedReportDelivered;

  function installWrapper(name, patch) {
    const current = window[name];
    if (typeof current !== 'function' || current.__xbMetricsV4Wrapped) return;
    const wrapped = function xbMetricsV4Wrapped(...args) {
      const result = current.apply(this, args);
      patch();
      return result;
    };
    wrapped.__xbMetricsV4Wrapped = true;
    window[name] = wrapped;
  }

  function installWrappers() {
    installWrapper('renderDashboard', patchDashboard);
    installWrapper('renderDeliveries', patchDeliveries);
    installWrapper('renderCouriers', patchCouriers);
    installWrapper('renderClosing', patchClosing);
    installWrapper('renderReports', patchReports);
  }

  function patchAll() {
    repairClosings();
    patchDashboard();
    patchDeliveries();
    patchCouriers();
    patchClosing();
    patchReports();
    const audit = diagnostics();
    const auditNode = document.getElementById('auditIntegrityStatus');
    if (auditNode) {
      auditNode.textContent = audit.ok ? 'Verificada' : `${audit.issues.length} divergência(s)`;
      auditNode.style.color = audit.ok ? '' : '#b42318';
    }
    if (typeof refreshIcons === 'function') refreshIcons();
  }

  repairClosings();
  installWrappers();
  requestAnimationFrame(patchAll);

  ['xb:cloud-ready', 'xb:cloud-pulled', 'xb:cloud-synced', 'xb:data-saved'].forEach(name => {
    window.addEventListener(name, () => queueMicrotask(patchAll));
  });

  // Módulos gerenciais carregam depois; reinstala os wrappers por último.
  window.addEventListener('xb:enhancements-ready', () => {
    if (typeof reportItems === 'function') reportItems = selectedReportDelivered;
    installWrappers();
    patchAll();
  }, { once: true });

  window.XBMetrics = Object.freeze({
    timezone: BUSINESS_TZ,
    dayKey,
    addDaysKey,
    filterRange: filterRangeSafe,
    forDay,
    sumMoney,
    averageMoney,
    stats,
    paymentBreakdown,
    selectedReportDelivered,
    selectedReportFees,
    diagnostics,
    refresh: patchAll
  });
})();
