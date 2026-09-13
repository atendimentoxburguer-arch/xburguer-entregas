(() => {
  if (window.__xbClosingContinuityInstalled) return;
  window.__xbClosingContinuityInstalled = true;

  const PAYMENTS = ['Dinheiro', 'PIX', 'Cartão', 'Pago online'];
  let recovering = false;

  const metrics = () => window.XBMetrics || null;
  const dayKey = value => metrics()?.dayKey?.(value) || dateKey(value instanceof Date ? value : new Date(value));
  const numberValue = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const sumMoney = (items, field) => {
    if (metrics()?.sumMoney) return metrics().sumMoney(items, field);
    const cents = (items || []).reduce((sum, item) => sum + Math.round(numberValue(item?.[field]) * 100), 0);
    return cents / 100;
  };
  const isDelivered = item => item?.status === 'Entregue';
  const isCancelled = item => item?.status === 'Cancelada';
  const isPending = item => item?.status === 'Aguardando' || item?.status === 'Em rota';

  function latestTimestamp(rows) {
    let latest = 0;
    (rows || []).forEach(item => {
      [item?.updatedAt, item?.createdAt].forEach(value => {
        const time = new Date(value || 0).getTime();
        if (Number.isFinite(time) && time > latest) latest = time;
      });
    });
    return latest ? new Date(latest).toISOString() : new Date().toISOString();
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
    const feeRows = rows.filter(item => isDelivered(item) || isCancelled(item));
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
        row.cancelledFees = Math.round((row.cancelledFees + numberValue(item.fee)) * 100) / 100;
      }
      row.fees = Math.round((row.fees + numberValue(item.fee)) * 100) / 100;
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

  function buildClosing(key, rows) {
    const details = buildDetails(rows);
    return {
      date: key,
      closedAt: latestTimestamp(rows),
      reopenedAt: '',
      detailsV2: details,
      deliverySnapshotV1: rows.filter(isDelivered)
        .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0))
        .map(snapshotDelivery),
      recovered: true,
      recoveryReason: 'Fechamento reconstruído automaticamente a partir das entregas salvas.',
      updatedAt: new Date().toISOString()
    };
  }

  function recoverPastCompleteDays() {
    if (recovering || window.__xbApplyingRemoteSnapshot || !Array.isArray(db?.deliveries) || !Array.isArray(db?.closings)) return [];
    recovering = true;
    try {
      const today = dayKey(new Date());
      const groups = new Map();
      db.deliveries.forEach(item => {
        const key = dayKey(item.createdAt);
        if (!key || key >= today) return;
        const list = groups.get(key) || [];
        list.push(item);
        groups.set(key, list);
      });

      const recovered = [];
      groups.forEach((rows, key) => {
        if (!rows.length || rows.some(isPending)) return;
        if (!rows.some(item => isDelivered(item) || isCancelled(item))) return;

        const existing = db.closings.find(item => item?.date === key);
        if (!existing) {
          db.closings.push(buildClosing(key, rows));
          recovered.push(key);
          return;
        }

        let repaired = false;
        if (!existing.detailsV2) {
          existing.detailsV2 = buildDetails(rows);
          repaired = true;
        }
        if (!Array.isArray(existing.deliverySnapshotV1)) {
          existing.deliverySnapshotV1 = rows.filter(isDelivered)
            .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0))
            .map(snapshotDelivery);
          repaired = true;
        }
        if (repaired) {
          existing.recovered = existing.recovered || true;
          existing.recoveryReason = existing.recoveryReason || 'Dados ausentes do fechamento foram recompostos a partir das entregas salvas.';
          existing.updatedAt = new Date().toISOString();
          recovered.push(key);
        }
      });

      if (recovered.length) {
        db.closings.sort((a, b) => String(a.date).localeCompare(String(b.date)));
        if (typeof save === 'function') save();
        window.dispatchEvent(new CustomEvent('xb:closing-continuity-recovered', { detail: { dates: recovered } }));
      }
      return recovered;
    } finally {
      recovering = false;
    }
  }

  const scheduleRecovery = () => setTimeout(() => recoverPastCompleteDays(), 80);
  ['xb:cloud-ready', 'xb:cloud-pulled', 'xb:cloud-synced'].forEach(name => window.addEventListener(name, scheduleRecovery));
  window.addEventListener('xb:enhancements-ready', scheduleRecovery);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleRecovery(); });

  // Uma verificação leve cobre a virada do dia sem exigir reiniciar o sistema.
  setInterval(() => {
    if (!document.hidden) recoverPastCompleteDays();
  }, 15 * 60 * 1000);

  setTimeout(() => {
    if (window.XBCloud?.state?.connected || !window.XB_SUPABASE_CONFIG?.enabled) recoverPastCompleteDays();
  }, 3000);

  window.XBClosingContinuity = Object.freeze({
    recover: recoverPastCompleteDays,
    buildDetails
  });
})();
