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
    const delivered = rows.filter(isDelivered);
    const cancelled = rows.filter(isCancelled);
    const feeRows = rows.filter(isFinal);
    const pending = rows.filter(isPending);

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
    return rows.filter(isFinal)
      .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0) || Number(a.code || 0) - Number(b.code || 0))
      .map(snapshotDelivery);
  }

  function normalizedClosingSignature(details) {
    if (!details) return '';
    const payments = (details.payments || []).map(row => [row.name, Number(row.count || 0), cents(row.value)]).sort();
    const couriers = (details.couriers || []).map(row => [String(row.id || ''), Number(row.count || 0), Number(row.cancelled || 0), cents(row.fees), cents(row.cancelledFees)]).sort();
    return JSON.stringify({
      delivered: Number(details.totalDeliveries || 0),
      revenue: cents(details.totalOrderValue),
      fees: cents(details.totalFees),
      cancelled: Number(details.cancelledDeliveries || 0),
      cancelledFees: cents(details.cancelledFees),
      pending: Number(details.pending || 0),
      payments,
      couriers
    });
  }

  function needsRepair(closing, rows) {
    if (!closing) return true;
    const expectedDetails = buildDetails(rows);
    if (normalizedClosingSignature(closing.detailsV2) !== normalizedClosingSignature(expectedDetails)) return true;
    const snapshot = Array.isArray(closing.deliverySnapshotV1) ? closing.deliverySnapshotV1 : [];
    const expected = expectedSnapshot(rows);
    if (snapshot.length !== expected.length) return true;
    const haveIds = snapshot.map(item => `${item.id}:${item.status}`).sort().join('|');
    const expectedIds = expected.map(item => `${item.id}:${item.status}`).sort().join('|');
    return haveIds !== expectedIds;
  }

  function cloudAvailable() {
    return Boolean(navigator.onLine && window.XBCloud?.client && window.XBCloud?.configured !== false);
  }

  async function flushBeforeClosing() {
    if (!cloudAvailable()) throw new Error('É necessária conexão com a internet para finalizar o dia com segurança.');
    if (window.XBCloud?.syncNow) await window.XBCloud.syncNow();
    if (Number(window.XBCloud?.pendingChanges || 0) > 0) {
      throw new Error('Ainda existem alterações aguardando sincronização. Aguarde alguns segundos e tente novamente.');
    }
  }

  async function finalizeRemote(key, allowPending = false) {
    await flushBeforeClosing();
    const { data, error } = await window.XBCloud.client.rpc('xb_finalize_day', {
      p_date: key,
      p_allow_pending: Boolean(allowPending)
    });
    if (error) throw error;

    if (window.XBCloud?.pullNow) await window.XBCloud.pullNow();
    const closing = (db.closings || []).find(item => item?.date === key);
    if (!closing?.detailsV2 || !Array.isArray(closing.deliverySnapshotV1)) {
      throw new Error('O fechamento foi enviado, mas ainda não foi confirmado no aparelho. Sincronize novamente antes de sair.');
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

    const key = dayKey(new Date());
    if ((db.closings || []).some(item => item?.date === key)) return;
    const rows = rowsForDay(key);
    const pending = rows.filter(isPending).length;
    if (!rows.length) return toast('Não há entregas registradas para finalizar hoje.', 'error');
    if (pending && !window.confirm(`Existem ${pending} entrega${pending === 1 ? '' : 's'} pendente${pending === 1 ? '' : 's'}. Finalizar mesmo assim?`)) return;

    busy = true;
    const button = event.currentTarget;
    if (button) button.disabled = true;
    try {
      await finalizeRemote(key, pending > 0);
      toast('Fechamento finalizado e confirmado no banco de dados.');
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
    const key = dayKey(new Date());
    if (!window.confirm('Deseja reabrir o fechamento de hoje?')) return;

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

  async function recoverPastCompleteDays() {
    if (busy || window.__xbApplyingRemoteSnapshot || !Array.isArray(db?.deliveries) || !Array.isArray(db?.closings) || !cloudAvailable()) return [];
    busy = true;
    try {
      await flushBeforeClosing();
      const today = dayKey(new Date());
      const groups = new Map();
      db.deliveries.forEach(item => {
        const key = dayKey(item?.createdAt);
        if (!key || key >= today) return;
        const list = groups.get(key) || [];
        list.push(item);
        groups.set(key, list);
      });

      const repaired = [];
      for (const [key, rows] of groups.entries()) {
        if (!rows.length || rows.some(isPending) || !rows.some(isFinal)) continue;
        const existing = db.closings.find(item => item?.date === key);
        if (!needsRepair(existing, rows)) continue;
        const { error } = await window.XBCloud.client.rpc('xb_finalize_day', {
          p_date: key,
          p_allow_pending: false
        });
        if (error) throw error;
        repaired.push(key);
      }

      if (repaired.length && window.XBCloud?.pullNow) {
        await window.XBCloud.pullNow();
        window.dispatchEvent(new CustomEvent('xb:closing-continuity-recovered', { detail: { dates: repaired } }));
      }
      return repaired;
    } catch (error) {
      console.error('[X-Burguer] Falha na verificação automática dos fechamentos:', error);
      return [];
    } finally {
      busy = false;
    }
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
    if (!document.hidden) recoverPastCompleteDays();
  }, 15 * 60 * 1000);

  setTimeout(() => scheduleRecovery(0), 3200);

  window.XBClosingContinuity = Object.freeze({
    recover: recoverPastCompleteDays,
    buildDetails,
    needsRepair,
    finalizeDay: finalizeRemote,
    reopenDay: reopenRemote
  });
})();
