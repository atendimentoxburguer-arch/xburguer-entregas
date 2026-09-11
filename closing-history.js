(() => {
  if (window.__xbClosingHistoryInstalled) return;
  window.__xbClosingHistoryInstalled = true;

  const SNAPSHOT_KEY = 'deliverySnapshotV1';

  const numberValue = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const clone = value => JSON.parse(JSON.stringify(value));

  function formatDayKey(key) {
    const [year, month, day] = String(key || '').split('-').map(Number);
    if (!year || !month || !day) return key || '-';
    return new Date(year, month - 1, day).toLocaleDateString('pt-BR', {
      weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric'
    });
  }

  function formatTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function snapshotDelivery(item) {
    const person = courier(item.courierId);
    return {
      id: item.id,
      code: item.code,
      client: item.client || '',
      phone: item.phone || '',
      address: item.address || '',
      reference: item.reference || '',
      courierId: item.courierId || null,
      courierName: person?.name || 'Sem entregador definido',
      fee: numberValue(item.fee),
      orderValue: numberValue(item.orderValue),
      payment: item.payment || 'Não informado',
      changeFor: getChangeFor(item) || '',
      notes: item.notes || '',
      status: item.status || 'Entregue',
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      paymentConfirmedAt: item.paymentConfirmedAt || ''
    };
  }

  function deliveredForDate(key) {
    return db.deliveries
      .filter(item => item.status === 'Entregue' && dateKey(new Date(item.createdAt)) === key)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }

  function buildSnapshotForDate(key) {
    return deliveredForDate(key).map(snapshotDelivery);
  }

  function backfillExistingClosings() {
    let changed = false;
    db.closings.forEach(closing => {
      if (!Array.isArray(closing[SNAPSHOT_KEY])) {
        closing[SNAPSHOT_KEY] = buildSnapshotForDate(closing.date);
        changed = true;
      }
    });
    if (changed) save();
  }

  function captureTodayClosingSnapshot() {
    const closing = db.closings.find(item => item.date === dateKey());
    if (!closing) return;
    closing[SNAPSHOT_KEY] = buildSnapshotForDate(closing.date);
    save();
    renderClosingHistory();
  }

  function importantData(item) {
    return JSON.stringify({
      client: item.client || '',
      phone: item.phone || '',
      address: item.address || '',
      reference: item.reference || '',
      courierId: item.courierId || null,
      fee: numberValue(item.fee),
      orderValue: numberValue(item.orderValue),
      payment: item.payment || '',
      changeFor: getChangeFor(item) || '',
      notes: item.notes || '',
      status: item.status || ''
    });
  }

  function resolveHistoricalDeliveries(closing) {
    const snapshot = Array.isArray(closing?.[SNAPSHOT_KEY]) ? closing[SNAPSHOT_KEY] : [];
    const rows = snapshot.length ? snapshot : buildSnapshotForDate(closing.date);
    let changedAfterClosing = 0;

    const resolved = rows.map(saved => {
      const current = db.deliveries.find(item => item.id === saved.id);
      if (!current) return { ...saved, _recordSource: 'snapshot', _deletedAfterClosing: true };

      const savedComparable = importantData(saved);
      const currentComparable = importantData(current);
      if (savedComparable !== currentComparable) changedAfterClosing += 1;

      return {
        ...saved,
        ...clone(current),
        courierName: courier(current.courierId)?.name || saved.courierName || 'Sem entregador definido',
        _recordSource: savedComparable === currentComparable ? 'snapshot' : 'current',
        _deletedAfterClosing: false
      };
    });

    return { rows: resolved, changedAfterClosing };
  }

  function closingSummary(closing, rows) {
    const details = closing?.detailsV2;
    if (details) {
      return {
        count: numberValue(details.totalDeliveries),
        orders: numberValue(details.totalOrderValue),
        fees: numberValue(details.totalFees)
      };
    }
    return {
      count: rows.length,
      orders: rows.reduce((total, item) => total + numberValue(item.orderValue), 0),
      fees: rows.reduce((total, item) => total + numberValue(item.fee), 0)
    };
  }

  function ensureClosingHistorySection() {
    let card = document.getElementById('closingHistoryCard');
    if (card) return card;

    const page = document.getElementById('page-closing');
    const actions = page?.querySelector('.closing-actions');
    if (!page) return null;

    card = document.createElement('section');
    card.className = 'card closing-history-card';
    card.id = 'closingHistoryCard';
    card.innerHTML = `
      <div class="card-head closing-history-head">
        <div class="card-title-row">
          <div class="card-title-icon">${icon('history')}</div>
          <div><h3>Histórico de dias fechados</h3><p>Consulte as entregas de qualquer dia já finalizado.</p></div>
        </div>
        <label class="closing-history-picker"><span>Dia</span><select id="closingHistoryDate" aria-label="Escolher fechamento"></select></label>
      </div>
      <div class="card-body" id="closingHistoryBody"></div>`;

    if (actions) actions.insertAdjacentElement('afterend', card);
    else page.appendChild(card);

    document.getElementById('closingHistoryDate')?.addEventListener('change', renderClosingHistory);
    card.addEventListener('click', event => {
      const edit = event.target.closest('[data-history-edit]');
      if (!edit) return;
      const item = db.deliveries.find(delivery => delivery.id === edit.dataset.historyEdit);
      if (!item) return toast('Esta entrega existe apenas no registro do fechamento e não pode mais ser editada.', 'error');
      openDeliveryEditor(item);
    });

    return card;
  }

  function renderEmptyHistory(body) {
    body.innerHTML = empty('Nenhum dia fechado ainda', 'Quando você finalizar um dia, as entregas dele ficarão disponíveis aqui para consulta.', 'calendar-clock');
  }

  function renderClosingHistory() {
    const card = ensureClosingHistorySection();
    if (!card) return;

    const select = document.getElementById('closingHistoryDate');
    const body = document.getElementById('closingHistoryBody');
    const closings = [...db.closings].sort((a, b) => String(b.date).localeCompare(String(a.date)));

    if (!closings.length) {
      if (select) select.innerHTML = '<option value="">Nenhum fechamento</option>';
      if (body) renderEmptyHistory(body);
      refreshIcons();
      return;
    }

    const previousValue = select?.value;
    if (select) {
      select.innerHTML = closings.map(item => `<option value="${esc(item.date)}">${esc(formatDayKey(item.date))}</option>`).join('');
      select.value = closings.some(item => item.date === previousValue) ? previousValue : closings[0].date;
    }

    const selectedDate = select?.value || closings[0].date;
    const closing = closings.find(item => item.date === selectedDate) || closings[0];
    const { rows, changedAfterClosing } = resolveHistoricalDeliveries(closing);
    const summary = closingSummary(closing, rows);
    const deletedCount = rows.filter(item => item._deletedAfterClosing).length;

    const notices = [];
    if (changedAfterClosing) {
      notices.push(`<div class="closing-history-notice warn">${icon('pencil-line')}<span><b>${changedAfterClosing}</b> entrega${changedAfterClosing === 1 ? ' foi alterada' : 's foram alteradas'} depois do fechamento. A lista mostra os dados atuais; os totais acima permanecem os valores registrados no fechamento.</span></div>`);
    }
    if (deletedCount) {
      notices.push(`<div class="closing-history-notice">${icon('archive')}<span><b>${deletedCount}</b> registro${deletedCount === 1 ? ' foi excluído' : 's foram excluídos'} depois do fechamento, mas continua${deletedCount === 1 ? '' : 'm'} disponível${deletedCount === 1 ? '' : 's'} neste histórico.</span></div>`);
    }

    body.innerHTML = `
      <div class="closing-history-summary">
        <article><span>Data</span><strong>${esc(formatDayKey(closing.date))}</strong><small>Fechado ${closing.closedAt ? `às ${formatTime(closing.closedAt)}` : ''}</small></article>
        <article><span>Entregas</span><strong>${summary.count}</strong><small>Registradas no fechamento</small></article>
        <article><span>Valor dos pedidos</span><strong>${money(summary.orders)}</strong><small>Total do dia</small></article>
        <article><span>Taxas</span><strong>${money(summary.fees)}</strong><small>Total das entregas</small></article>
      </div>
      ${notices.join('')}
      <div class="closing-history-table-wrap">
        ${rows.length ? `<table class="closing-history-table" aria-label="Entregas do fechamento de ${esc(formatDayKey(closing.date))}">
          <thead><tr><th>Pedido</th><th>Cliente e endereço</th><th>Entregador</th><th>Pagamento</th><th>Valores</th><th>Situação</th><th></th></tr></thead>
          <tbody>${rows.map(item => {
            const exists = db.deliveries.some(delivery => delivery.id === item.id);
            const change = getChangeFor(item);
            return `<tr>
              <td><strong>#${String(item.code || '').padStart(3, '0')}</strong><small>${formatTime(item.createdAt)}</small></td>
              <td><strong>${esc(item.client?.trim() || 'Cliente não informado')}</strong><small>${esc(addressLabel(item))}</small>${item.phone ? `<small>${esc(item.phone)}</small>` : ''}</td>
              <td><strong>${esc(item.courierName || courier(item.courierId)?.name || 'Sem entregador')}</strong></td>
              <td>${paymentHTML(item)}</td>
              <td><strong>${money(item.orderValue)}</strong><small>Taxa ${money(item.fee)}</small>${change ? `<small>Troco para ${money(change)}</small>` : ''}</td>
              <td>${statusHTML(item.status || 'Entregue')}${item._deletedAfterClosing ? '<small class="history-record-only">Registro do fechamento</small>' : ''}</td>
              <td>${exists ? `<button class="btn btn-light btn-sm closing-history-edit" type="button" data-history-edit="${esc(item.id)}">${icon('pencil')}Editar</button>` : ''}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>` : empty('Nenhuma entrega registrada', 'Este fechamento não possui entregas concluídas salvas.', 'package-open')}
      </div>`;

    refreshIcons();
  }

  function installStyles() {
    if (document.getElementById('xbClosingHistoryStyles')) return;
    const style = document.createElement('style');
    style.id = 'xbClosingHistoryStyles';
    style.textContent = `
      .closing-history-card{margin-top:24px!important;overflow:hidden}
      .closing-history-head{align-items:center!important;gap:18px}
      .closing-history-picker{display:flex;align-items:center;gap:9px;color:#695f59;font-size:.78rem;font-weight:800;white-space:nowrap}
      .closing-history-picker select{min-width:205px;min-height:42px;border:1px solid #d8cbc1;border-radius:11px;background:linear-gradient(180deg,#fffefd,#faf3ed);padding:0 36px 0 12px;color:#28211e;font:inherit;font-weight:750}
      .closing-history-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:16px}
      .closing-history-summary article{padding:15px;border:1px solid #e6d8ce;border-radius:15px;background:linear-gradient(145deg,#fffdfb,#f6ebe3);box-shadow:0 7px 18px rgba(64,31,21,.035);display:flex;flex-direction:column;gap:4px}
      .closing-history-summary span{font-size:.75rem;font-weight:800;color:#786c65;text-transform:uppercase;letter-spacing:.025em}
      .closing-history-summary strong{font-size:1.08rem;color:#241c19}
      .closing-history-summary small{font-size:.76rem;color:#81756e}
      .closing-history-notice{display:flex;align-items:flex-start;gap:9px;padding:11px 13px;margin-bottom:12px;border:1px solid #e4d9cf;border-radius:12px;background:#fbf6f2;color:#625852;font-size:.82rem;line-height:1.5}
      .closing-history-notice.warn{border-color:#efd9aa;background:#fff8e8;color:#74551d}
      .closing-history-notice svg{width:16px;height:16px;flex:0 0 auto;margin-top:2px}
      .closing-history-table-wrap{overflow:auto;border:1px solid #e7dcd4;border-radius:15px;background:rgba(255,255,255,.72)}
      .closing-history-table{width:100%;border-collapse:collapse;min-width:990px}
      .closing-history-table th{padding:11px 12px;text-align:left;background:#f8f1eb;color:#6c6059;font-size:.72rem;text-transform:uppercase;letter-spacing:.03em;border-bottom:1px solid #e6d9d0}
      .closing-history-table td{padding:12px;border-bottom:1px solid #eee5df;vertical-align:top;color:#2b2421;font-size:.83rem}
      .closing-history-table tbody tr:last-child td{border-bottom:0}
      .closing-history-table tbody tr:hover{background:#fff9f5}
      .closing-history-table td>strong,.closing-history-table td>small{display:block}
      .closing-history-table td>small{margin-top:4px;color:#7c716a;line-height:1.35}
      .closing-history-edit{white-space:nowrap}
      .history-record-only{display:block;margin-top:6px!important;color:#8b6b39!important;font-weight:750}
      @media(max-width:900px){.closing-history-summary{grid-template-columns:repeat(2,minmax(0,1fr))}.closing-history-head{align-items:flex-start!important;flex-direction:column}.closing-history-picker{width:100%;justify-content:space-between}.closing-history-picker select{min-width:0;flex:1;max-width:280px}}
      @media(max-width:560px){.closing-history-summary{grid-template-columns:1fr 1fr;gap:9px}.closing-history-summary article{padding:12px}.closing-history-summary strong{font-size:.96rem}.closing-history-picker{align-items:flex-start;flex-direction:column}.closing-history-picker select{width:100%;max-width:none}}
    `;
    document.head.appendChild(style);
  }

  backfillExistingClosings();
  installStyles();

  const renderClosingBeforeHistory = renderClosing;
  renderClosing = function xbClosingWithHistory() {
    renderClosingBeforeHistory();
    renderClosingHistory();
  };

  document.getElementById('closeDayBtn')?.addEventListener('click', () => {
    setTimeout(captureTodayClosingSnapshot, 150);
  });

  document.getElementById('deliveryEditForm')?.addEventListener('submit', () => {
    setTimeout(renderClosingHistory, 0);
  });

  ensureClosingHistorySection();
  renderClosingHistory();
  refreshIcons();
})();