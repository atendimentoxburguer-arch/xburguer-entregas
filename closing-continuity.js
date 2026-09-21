(() => {
  if (window.__xbClosingContinuityInstalled) return;
  window.__xbClosingContinuityInstalled = true;

  const PAYMENTS = ['Dinheiro', 'PIX', 'Cartão', 'Pago online'];
  let busy = false;
  let recoveryTimer = null;

  const metrics = () => window.XBMetrics || null;
  const dayKey = value => metrics()?.dayKey?.(value) || dateKey(value instanceof Date ? value : new Date(value));
  const numberValue = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const cents = value => Math.round(numberValue(value) * 100);
  const sumMoney = (items, field) => {
    if (metrics()?.sumMoney) return metrics().sumMoney(items, field);
    return (items || []).reduce((sum, item) => sum + cents(item?.[field]), 0) / 100;
  };
  const isDelivered = item => item?.status === 'Entregue';
  const isCancelled = item => item?.status === 'Cancelada';
  const isPending = item => item?.status === 'Aguardando' || item?.status === 'Em rota';
  const isFinal = item => isDelivered(item) || isCancelled(item);

  function rowsForDay(key) {
    return (db.deliveries || []).filter(item => dayKey(item?.createdAt) === key);
  }

  function snapshotDelivery(item) {
    const person = typeof courier === 'function' ? courier(item.courierId) : null;
    return {
      id: item.id,
      code: Number(item.code || 0),
      client: item.client || '',
      phone: item.phone || '',
      address: item.address || '',
      reference: item.reference || '',
      courierId: item.courierId || null,
      courierName: person?.name || 'Sem entregador definido',
      fee: numberValue(item.fee),
      orderValue: numberValue(item.orderValue),
      payment: item.payment || 'Não informado',
      changeFor: item.changeFor ?? '',
      notes: item.notes || '',
      status: item.status || 'Entregue',
      createdAt: item.createdAt,
      updatedAt: item.updatedAt || item.createdAt,
      paymentConfirmedAt: item.paymentConfirmedAt || ''
    };
  }

  function buildDetails(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const delivered = list.filter(isDelivered);
    const cancelled = list.filter(isCancelled);
    const feeRows = list.filter(isFinal);
    const pending = list.filter(isPending);

    const payments = PAYMENTS.map(name => {
      const items = delivered.filter(item => item.payment === name);
      return { name, count: items.length, value: sumMoney(items, 'orderValue') };
    });

    const grouped = new Map();
    feeRows.forEach(item => {
      const id = item.courierId || '__without_courier__';
      const person = typeof courier === 'function' ? courier(item.courierId) : null;
      const row = grouped.get(id) || {
        id,
        name: person?.name || 'Sem entregador definido',
        count: 0,
        cancelled: 0,
        cancelledFees: 0,
        fees: 0
      };
      if (isDelivered(item)) row.count += 1;
      if (isCancelled(item)) {
        row.cancelled += 1;
        row.cancelledFees = (cents(row.cancelledFees) + cents(item.fee)) / 100;
      }
      row.fees = (cents(row.fees) + cents(item.fee)) / 100;
      grouped.set(id, row);
    });

    return {
      totalDeliveries: delivered.length,
      totalOrderValue: sumMoney(delivered, 'orderValue'),
      totalFees: sumMoney(feeRows, 'fee'),
      cancelledDeliveries: cancelled.length,
      cancelledFees: sumMoney(cancelled, 'fee'),
      pending: pending.length,
      payments,
      couriers: [...grouped.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'))
    };
  }

  function expectedSnapshot(rows) {
    return (rows || []).filter(isFinal)
      .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0) || Number(a.code || 0) - Number(b.code || 0))
      .map(snapshotDelivery);
  }

  // Valida o fechamento contra o próprio snapshot congelado. Nunca compara um
  // fechamento histórico com a entrega atual, pois uma edição posterior não pode
  // reescrever os totais já fechados.
  function needsRepair(closing) {
    const details = closing?.detailsV2;
    const snapshot = closing?.deliverySnapshotV1;
    if (!details || typeof details !== 'object') return true;
    if (!Array.isArray(details.payments) || !Array.isArray(details.couriers) || !Array.isArray(snapshot)) return true;

    const delivered = Math.max(0, Math.floor(numberValue(details.totalDeliveries)));
    const cancelled = Math.max(0, Math.floor(numberValue(details.cancelledDeliveries)));
    const pending = Math.max(0, Math.floor(numberValue(details.pending)));
    const revenue = cents(details.totalOrderValue);
    const fees = cents(details.totalFees);
    const cancelledFees = cents(details.cancelledFees);
    if (pending !== 0) return true;

    const paymentCount = details.payments.reduce((total, row) => total + Math.max(0, Math.floor(numberValue(row?.count))), 0);
    const paymentValue = details.payments.reduce((total, row) => total + cents(row?.value), 0);
    if (paymentCount !== delivered || paymentValue !== revenue) return true;

    const courierDelivered = details.couriers.reduce((total, row) => total + Math.max(0, Math.floor(numberValue(row?.count))), 0);
    const courierCancelled = details.couriers.reduce((total, row) => total + Math.max(0, Math.floor(numberValue(row?.cancelled))), 0);
    const courierFees = details.couriers.reduce((total, row) => total + cents(row?.fees), 0);
    const courierCancelledFees = details.couriers.reduce((total, row) => total + cents(row?.cancelledFees), 0);
    if (courierDelivered !== delivered || courierCancelled !== cancelled || courierFees !== fees || courierCancelledFees !== cancelledFees) return true;

    const snapshotDelivered = snapshot.filter(isDelivered);
    const snapshotCancelled = snapshot.filter(isCancelled);
    if (snapshot.length !== delivered + cancelled || snapshotDelivered.length !== delivered || snapshotCancelled.length !== cancelled) return true;
    if (snapshotDelivered.reduce((total, item) => total + cents(item?.orderValue), 0) !== revenue) return true;
    if (snapshot.filter(isFinal).reduce((total, item) => total + cents(item?.fee), 0) !== fees) return true;
    if (snapshotCancelled.reduce((total, item) => total + cents(item?.fee), 0) !== cancelledFees) return true;

    return false;
  }

  function cloudAvailable() {
    return Boolean(navigator.onLine && window.XBCloud?.client && window.XBCloud?.configured !== false);
  }

  async function flushBeforeClosing() {
    if (!cloudAvailable()) throw new Error('É necessária conexão com a internet para finalizar o dia com segurança.');
    if (window.XBCloud?.syncNow) {
      const synced = await window.XBCloud.syncNow();
      if (synced === false && Number(window.XBCloud?.pendingChanges || 0) > 0) {
        throw new Error('Não foi possível enviar todas as alterações ao banco. Aguarde e tente novamente.');
      }
    }
    if (Number(window.XBCloud?.pendingChanges || 0) > 0) {
      throw new Error('Ainda existem alterações aguardando sincronização. Aguarde alguns segundos e tente novamente.');
    }
  }

  async function finalizeRemote(key) {
    await flushBeforeClosing();
    const { data, error } = await window.XBCloud.client.rpc('xb_finalize_day', {
      p_date: key,
      p_allow_pending: false
    });
    if (error) throw error;

    if (window.XBCloud?.pullNow) await window.XBCloud.pullNow();
    const closing = (db.closings || []).find(item => item?.date === key);
    if (!closing || needsRepair(closing)) {
      throw new Error('O fechamento não passou na conferência final. Sincronize novamente e confira antes de sair.');
    }
    return data;
  }

  async function reopenRemote(key) {
    await flushBeforeClosing();
    const { error } = await window.XBCloud.client.rpc('xb_reopen_day', { p_date: key });
    if (error) throw error;
    if (window.XBCloud?.pullNow) await window.XBCloud.pullNow();
    if ((db.closings || []).some(item => item?.date === key)) {
      throw new Error('Não foi possível confirmar a reabertura no banco de dados.');
    }
  }

  function renderAfterChange() {
    if (typeof renderAll === 'function') renderAll();
    else if (typeof renderClosing === 'function') renderClosing();
    if (typeof refreshIcons === 'function') refreshIcons();
  }

  async function handleClose(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (busy) return;

    const key = activeDay();
    if ((db.closings || []).some(item => item?.date === key)) return;
    const rows = rowsForDay(key);
    const pending = rows.filter(isPending).length;
    if (!rows.length) return toast('Não há entregas registradas para finalizar o dia ' + key.split('-').reverse().join('/') + '.', 'error');
    if (pending) {
      return toast(`Existem ${pending} entrega${pending === 1 ? '' : 's'} pendente${pending === 1 ? '' : 's'}. Conclua ou cancele antes de fechar o dia.`, 'error');
    }

    busy = true;
    const button = event.currentTarget;
    if (button) button.disabled = true;
    try {
      await finalizeRemote(key);
      toast('Fechamento finalizado, conferido e confirmado no banco de dados.');
      renderAfterChange();
    } catch (error) {
      console.error('[X-Burguer] Falha ao finalizar dia:', error);
      toast(String(error?.message || 'Não foi possível finalizar o dia.'), 'error');
    } finally {
      busy = false;
      if (button) button.disabled = false;
    }
  }

  async function handleReopen(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (busy) return;
    const key = activeDay();
    const label = key.split('-').reverse().join('/');
    if (!window.confirm('Deseja reabrir o fechamento do dia ' + label + '?')) return;

    busy = true;
    const button = event.currentTarget;
    if (button) button.disabled = true;
    try {
      await reopenRemote(key);
      toast('Fechamento reaberto e confirmado no banco de dados.');
      renderAfterChange();
    } catch (error) {
      console.error('[X-Burguer] Falha ao reabrir dia:', error);
      toast(String(error?.message || 'Não foi possível reabrir o dia.'), 'error');
    } finally {
      busy = false;
      if (button) button.disabled = false;
    }
  }

  function openOperationalDays() {
    const today = dayKey(new Date());
    const closed = new Set((db.closings || []).map(item => String(item?.date || '')));
    const days = new Set();
    (db.deliveries || []).forEach(item => {
      const key = dayKey(item?.createdAt);
      if (key && key <= today && !closed.has(key)) days.add(key);
    });
    return [...days].sort();
  }

  function activeDay() {
    const open = openOperationalDays();
    return open[0] || dayKey(new Date());
  }

  function pastOpenDays() {
    const today = dayKey(new Date());
    return openOperationalDays().filter(key => key < today);
  }

  function scanOpenPastDays() {
    const dates = pastOpenDays();
    if (dates.length) {
      window.dispatchEvent(new CustomEvent('xb:open-past-days-detected', { detail: { dates } }));
    }
    return dates;
  }
  const closeButton = document.getElementById('closeDayBtn');
  const reopenButton = document.getElementById('reopenDayBtn');
  closeButton?.addEventListener('click', handleClose, { capture: true });
  reopenButton?.addEventListener('click', handleReopen, { capture: true });

  function scheduleRecovery(delay = 120) {
    clearTimeout(recoveryTimer);
    recoveryTimer = setTimeout(() => recoverPastCompleteDays(), delay);
  }

  ['xb:cloud-ready', 'xb:cloud-pulled', 'xb:cloud-synced'].forEach(name => window.addEventListener(name, () => scheduleRecovery()));
  window.addEventListener('online', () => scheduleRecovery(300));
  window.addEventListener('xb:enhancements-ready', () => scheduleRecovery());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleRecovery(); });

  setInterval(() => {
    if (!document.hidden) scanOpenPastDays();
  }, 15 * 60 * 1000);

  setTimeout(() => scanOpenPastDays(), 3200);

  window.XBClosingContinuity = Object.freeze({
    recover: recoverPastCompleteDays,
    buildDetails,
    expectedSnapshot,
    needsRepair,
    finalizeDay: finalizeRemote,
    reopenDay: reopenRemote,
    activeDay,
    openOperationalDays,
    pastOpenDays,
    scanOpenPastDays
  });
})();
