(() => {
  if (window.__xbPastDayGuardInstalled) return;
  window.__xbPastDayGuardInstalled = true;

  const isPending = item => item?.status === 'Aguardando' || item?.status === 'Em rota';
  const dayKey = value => window.XBMetrics?.dayKey?.(value) || dateKey(value instanceof Date ? value : new Date(value));

  function formatDay(key) {
    const [year, month, day] = String(key || '').split('-').map(Number);
    if (!year || !month || !day) return key || '-';
    return new Date(year, month - 1, day).toLocaleDateString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric'
    });
  }

  function pastPendingRows() {
    const today = dayKey();
    return (db.deliveries || [])
      .filter(item => isPending(item) && dayKey(item?.createdAt) && dayKey(item.createdAt) < today)
      .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  }

  function groupRows(rows) {
    const groups = new Map();
    rows.forEach(item => {
      const key = dayKey(item.createdAt);
      const list = groups.get(key) || [];
      list.push(item);
      groups.set(key, list);
    });
    return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }

  function ensureStyles() {
    if (document.getElementById('xbPastDayGuardStyles')) return;
    const style = document.createElement('style');
    style.id = 'xbPastDayGuardStyles';
    style.textContent = `
      .xb-past-pending-alert{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin:0 0 18px;padding:14px 16px;border:1px solid #e8c879;border-radius:14px;background:linear-gradient(135deg,#fff8e7,#fff1c7);color:#6f4d08;box-shadow:0 8px 22px rgba(92,61,7,.06)}
      .xb-past-pending-copy{display:flex;gap:11px;align-items:flex-start;min-width:0}
      .xb-past-pending-copy svg{width:19px;height:19px;flex:0 0 auto;margin-top:2px}
      .xb-past-pending-copy strong{display:block;color:#5a3d05;font-size:.9rem;margin-bottom:3px}
      .xb-past-pending-copy span{display:block;font-size:.8rem;line-height:1.48}
      .xb-past-pending-alert .btn{flex:0 0 auto;white-space:nowrap}
      @media(max-width:700px){.xb-past-pending-alert{flex-direction:column}.xb-past-pending-alert .btn{width:100%}}
      html.xb-low-power .xb-past-pending-alert{box-shadow:none!important}
    `;
    document.head.appendChild(style);
  }

  function alertHtml(rows, compact = false) {
    const groups = groupRows(rows);
    const dates = groups.map(([key, items]) => `${formatDay(key)}: ${items.length} pendente${items.length === 1 ? '' : 's'}`).join(' · ');
    const codes = rows.slice(0, 8).map(item => `#${String(item.code || '').padStart(3, '0')}`).join(', ');
    const extra = rows.length > 8 ? ` e mais ${rows.length - 8}` : '';
    return `
      <div class="xb-past-pending-copy">
        ${typeof icon === 'function' ? icon('triangle-alert') : ''}
        <div>
          <strong>${rows.length === 1 ? 'Existe uma entrega pendente de um dia anterior' : 'Existem entregas pendentes de dias anteriores'}</strong>
          <span>${dates}. Pedido${rows.length === 1 ? '' : 's'}: ${codes}${extra}. Esses dias não podem ser fechados até que cada pedido seja concluído ou cancelado.</span>
        </div>
      </div>
      ${compact ? '' : '<button type="button" class="btn btn-light btn-sm" data-open-past-pending>Ver pendências</button>'}
    `;
  }

  function ensureAlert(id, anchor, rows, compact = false) {
    let node = document.getElementById(id);
    if (!rows.length) {
      node?.remove();
      return;
    }
    if (!node) {
      node = document.createElement('div');
      node.id = id;
      node.className = 'xb-past-pending-alert';
      if (anchor?.parentElement) anchor.parentElement.insertBefore(node, anchor);
    }
    node.innerHTML = alertHtml(rows, compact);
  }

  function refresh() {
    ensureStyles();
    const rows = pastPendingRows();
    ensureAlert('xbPastPendingClosingAlert', document.getElementById('closingBanner'), rows, false);
    ensureAlert('xbPastPendingDashboardAlert', document.getElementById('dashboardStats'), rows, true);
    if (rows.length) {
      window.dispatchEvent(new CustomEvent('xb:past-pending-detected', {
        detail: { count: rows.length, dates: groupRows(rows).map(([date, items]) => ({ date, count: items.length })) }
      }));
    }
    if (typeof refreshIcons === 'function') refreshIcons();
    return rows;
  }

  document.addEventListener('click', event => {
    const button = event.target.closest?.('[data-open-past-pending]');
    if (!button) return;
    const date = document.getElementById('dateFilter');
    const status = document.getElementById('statusFilter');
    if (date) date.value = 'all';
    if (status) status.value = 'Aguardando';
    if (typeof go === 'function') go('deliveries');
    if (typeof renderDeliveries === 'function') renderDeliveries();
  });

  ['xb:cloud-ready', 'xb:cloud-pulled', 'xb:cloud-synced', 'xb:data-saved', 'xb:closing-continuity-recovered', 'xb:enhancements-ready'].forEach(name => {
    window.addEventListener(name, () => queueMicrotask(refresh));
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

  requestAnimationFrame(refresh);

  window.XBPastDayGuard = Object.freeze({
    refresh,
    get pending() { return pastPendingRows(); }
  });
})();