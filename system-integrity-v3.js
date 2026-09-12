(() => {
  if (window.__xbSystemIntegrityV3Installed) return;
  window.__xbSystemIntegrityV3Installed = true;

  const PAYMENTS = ['Dinheiro', 'PIX', 'Cartão', 'Pago online'];
  const STATUSES = ['Aguardando', 'Entregue', 'Cancelada'];
  const nowIso = () => new Date().toISOString();
  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const money2 = value => Math.round(Math.max(0, finite(value, 0)) * 100) / 100;
  const validDate = value => Boolean(value) && !Number.isNaN(new Date(value).getTime());

  function courierMap() {
    return new Map((db.couriers || []).map(item => [String(item.id), item]));
  }

  function sanitizeSnapshots() {
    const prefixes = [
      'xb_entregas_recovery_v1',
      'xb_entregas_previous_state_v1',
      'xb_cloud_pre_migration_backup_v1',
      'xb_cloud_pre_migration_backup_v2_'
    ];

    try {
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!key || !prefixes.some(prefix => key === prefix || key.startsWith(prefix))) continue;
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        try {
          const payload = JSON.parse(raw);
          const target = payload?.db && typeof payload.db === 'object' ? payload.db : payload;
          if (!target?.settings) continue;
          let changed = false;
          if ('password' in target.settings && target.settings.password) {
            target.settings.password = '';
            changed = true;
          }
          if ('email' in target.settings && target.settings.email) {
            target.settings.email = '';
            changed = true;
          }
          if (changed) localStorage.setItem(key, JSON.stringify(payload));
        } catch {}
      }
    } catch {}
  }

  function roundClosingDetails(details) {
    if (!details || typeof details !== 'object') return false;
    let changed = false;
    const roundField = key => {
      if (!(key in details)) return;
      const next = money2(details[key]);
      if (Number(details[key] || 0) !== next) {
        details[key] = next;
        changed = true;
      }
    };
    ['totalOrderValue', 'totalFees', 'cancelledFees'].forEach(roundField);

    (details.payments || []).forEach(row => {
      const next = money2(row?.value);
      if (Number(row?.value || 0) !== next) {
        row.value = next;
        changed = true;
      }
    });
    (details.couriers || []).forEach(row => {
      ['fees', 'cancelledFees'].forEach(key => {
        const next = money2(row?.[key]);
        if (Number(row?.[key] || 0) !== next) {
          row[key] = next;
          changed = true;
        }
      });
    });
    return changed;
  }

  function normalizeState() {
    if (!db || typeof db !== 'object') return false;
    let changed = false;
    const couriers = courierMap();

    if (db.settings) {
      const nextDefault = money2(db.settings.defaultFee);
      if (Number(db.settings.defaultFee || 0) !== nextDefault) {
        db.settings.defaultFee = nextDefault;
        changed = true;
      }
      if (db.settings.password) {
        db.settings.password = '';
        changed = true;
      }
      if (db.settings.email) {
        db.settings.email = '';
        changed = true;
      }
    }

    (db.couriers || []).forEach(item => {
      const nextFee = money2(item.fee);
      if (Number(item.fee || 0) !== nextFee) {
        item.fee = nextFee;
        item.updatedAt = nowIso();
        changed = true;
      }
    });

    (db.deliveries || []).forEach(item => {
      let itemChanged = false;

      if (item.status === 'Em rota' || !STATUSES.includes(item.status)) {
        item.status = 'Aguardando';
        itemChanged = true;
      }
      if (!PAYMENTS.includes(item.payment)) {
        item.payment = 'Dinheiro';
        itemChanged = true;
      }

      const nextOrderValue = money2(item.orderValue);
      if (Number(item.orderValue || 0) !== nextOrderValue) {
        item.orderValue = nextOrderValue;
        itemChanged = true;
      }

      let nextFee = money2(item.fee);
      const person = item.courierId ? couriers.get(String(item.courierId)) : null;
      const defaultFee = person ? money2(person.fee) : 0;
      if (person && defaultFee > 0 && nextFee <= 0) nextFee = defaultFee;
      if (Number(item.fee || 0) !== nextFee) {
        item.fee = nextFee;
        itemChanged = true;
      }

      if (item.payment !== 'Dinheiro') {
        if (item.changeFor !== '' && item.changeFor !== null && item.changeFor !== undefined) {
          item.changeFor = '';
          itemChanged = true;
        }
      } else if (item.changeFor !== '' && item.changeFor !== null && item.changeFor !== undefined) {
        const nextChange = money2(item.changeFor);
        if (nextChange < nextOrderValue) {
          item.changeFor = '';
          itemChanged = true;
        } else if (Number(item.changeFor || 0) !== nextChange) {
          item.changeFor = nextChange;
          itemChanged = true;
        }
      }

      const hasConfirmedAt = validDate(item.paymentConfirmedAt);
      if (item.payment === 'Pago online' && !hasConfirmedAt) {
        item.paymentConfirmedAt = validDate(item.createdAt) ? item.createdAt : nowIso();
        itemChanged = true;
      } else if (item.status === 'Entregue' && !hasConfirmedAt) {
        item.paymentConfirmedAt = validDate(item.updatedAt) ? item.updatedAt : nowIso();
        itemChanged = true;
      } else if (item.status === 'Aguardando' && item.payment !== 'Pago online' && item.paymentConfirmedAt) {
        item.paymentConfirmedAt = '';
        itemChanged = true;
      }

      if (itemChanged) {
        item.updatedAt = nowIso();
        changed = true;
      }
    });

    (db.closings || []).forEach(closing => {
      let closingChanged = false;
      if (roundClosingDetails(closing.detailsV2)) closingChanged = true;
      ['fees', 'orderValue'].forEach(key => {
        if (!(key in closing)) return;
        const next = money2(closing[key]);
        if (Number(closing[key] || 0) !== next) {
          closing[key] = next;
          closingChanged = true;
        }
      });
      if (closingChanged) changed = true;
    });

    return changed;
  }

  function diagnostics() {
    const issues = [];
    const courierIds = new Set((db.couriers || []).map(item => String(item.id)));
    const deliveryIds = new Set();
    const codes = new Set();

    (db.deliveries || []).forEach(item => {
      if (deliveryIds.has(String(item.id))) issues.push(`ID duplicado: ${item.id}`);
      deliveryIds.add(String(item.id));
      if (codes.has(Number(item.code))) issues.push(`Pedido duplicado: #${item.code}`);
      codes.add(Number(item.code));
      if (item.courierId && courierIds.has(String(item.courierId))) {
        const person = (db.couriers || []).find(courier => String(courier.id) === String(item.courierId));
        if (Number(person?.fee || 0) > 0 && Number(item.fee || 0) <= 0) {
          issues.push(`Pedido #${item.code} com taxa inválida.`);
        }
      }
      if (item.payment === 'Pago online' && !validDate(item.paymentConfirmedAt)) {
        issues.push(`Pedido #${item.code} online sem confirmação.`);
      }
      if (item.status === 'Entregue' && !validDate(item.paymentConfirmedAt)) {
        issues.push(`Pedido #${item.code} entregue sem confirmação.`);
      }
    });

    return { ok: issues.length === 0, issues };
  }

  function refreshAuditIndicator() {
    const report = diagnostics();
    const element = document.getElementById('auditIntegrityStatus');
    if (!element) return report;
    element.textContent = report.ok ? 'Verificada' : `${report.issues.length} problema(s)`;
    element.style.color = report.ok ? '' : '#b42318';
    return report;
  }

  sanitizeSnapshots();

  if (typeof save === 'function' && !save.__xbIntegrityV3Wrapped) {
    const previousSave = save;
    const guardedSave = function xbIntegrityV3Save(...args) {
      normalizeState();
      const result = previousSave.apply(this, args);
      queueMicrotask(refreshAuditIndicator);
      return result;
    };
    guardedSave.__xbIntegrityV3Wrapped = true;
    save = guardedSave;
  }

  if (normalizeState() && typeof save === 'function') save();
  refreshAuditIndicator();

  window.addEventListener('xb:cloud-ready', () => {
    setTimeout(() => {
      if (normalizeState() && typeof save === 'function') save();
      refreshAuditIndicator();
    }, 0);
  });

  window.addEventListener('xb:cloud-synced', refreshAuditIndicator);
  window.addEventListener('xb:data-saved', refreshAuditIndicator);

  window.XBSystemIntegrity = Object.freeze({
    check: diagnostics,
    repair: () => {
      const changed = normalizeState();
      if (changed && typeof save === 'function') save();
      return diagnostics();
    }
  });
})();
