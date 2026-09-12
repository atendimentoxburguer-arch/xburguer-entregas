(() => {
  if (window.__xbBusinessRulesV2Installed) return;
  window.__xbBusinessRulesV2Installed = true;

  const ONLINE_PAYMENT = 'Pago online';
  const numberValue = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const isFeePayable = item => ['Entregue', 'Cancelada'].includes(item?.status);
  const isPending = item => ['Aguardando', 'Em rota'].includes(item?.status);

  function sameDay(item, key) {
    return Boolean(key) && dateKey(new Date(item.createdAt)) === key;
  }

  function reportFeeItems() {
    let items = (db.deliveries || []).filter(isFeePayable);
    const specificDate = window.XBReportDateFilter?.selectedDate || '';
    if (specificDate) return items.filter(item => sameDay(item, specificDate));

    const range = document.getElementById('reportRange')?.value || '7';
    if (range === 'all') return items;
    const limit = new Date();
    limit.setDate(limit.getDate() - Number(range || 7));
    return items.filter(item => new Date(item.createdAt) >= limit);
  }

  function patchCourierCards() {
    const cards = [...document.querySelectorAll('#courierGrid .courier-card')];
    cards.forEach((card, index) => {
      const person = db.couriers?.[index];
      if (!person) return;
      const rows = (db.deliveries || []).filter(item => item.courierId === person.id && isFeePayable(item));
      const completed = rows.filter(item => item.status === 'Entregue');
      const cancelled = rows.filter(item => item.status === 'Cancelada');
      const totalFees = rows.reduce((sum, item) => sum + numberValue(item.fee), 0);
      const cancelledFees = cancelled.reduce((sum, item) => sum + numberValue(item.fee), 0);

      const dataRows = card.querySelectorAll('.courier-data');
      const feeBlock = dataRows[1]?.children?.[0];
      if (feeBlock) {
        const label = feeBlock.querySelector('span');
        const value = feeBlock.querySelector('strong');
        if (label) label.textContent = 'Taxas a receber';
        if (value) value.textContent = money(totalFees);
      }

      let note = card.querySelector('.xb-cancelled-courier-note');
      if (cancelled.length) {
        if (!note) {
          note = document.createElement('div');
          note.className = 'xb-cancelled-courier-note';
          card.querySelector('.courier-actions')?.insertAdjacentElement('beforebegin', note);
        }
        note.innerHTML = `${icon('circle-dollar-sign')}<span>${cancelled.length} cancelada${cancelled.length === 1 ? '' : 's'} com taxa mantida · <b>${money(cancelledFees)}</b></span>`;
      } else {
        note?.remove();
      }

      // A quantidade de entregas continua significando entregas concluídas.
      const deliveryBlock = dataRows[0]?.children?.[1];
      const deliveryValue = deliveryBlock?.querySelector('strong');
      if (deliveryValue) deliveryValue.textContent = String(completed.length);
    });
  }

  function patchReportFees() {
    const feeItems = reportFeeItems();
    const totalFees = feeItems.reduce((sum, item) => sum + numberValue(item.fee), 0);
    const cancelled = feeItems.filter(item => item.status === 'Cancelada');
    const cancelledFees = cancelled.reduce((sum, item) => sum + numberValue(item.fee), 0);

    const stats = [...document.querySelectorAll('#reportStats .stat')];
    const feeCard = stats.find(card => card.querySelector('.stat-label')?.textContent.trim() === 'Taxas de entrega') || stats[1];
    if (feeCard) {
      const value = feeCard.querySelector('.stat-value');
      const detail = feeCard.querySelector('.stat-detail');
      if (value) value.textContent = money(totalFees);
      if (detail) detail.textContent = cancelled.length ? `Inclui ${cancelled.length} cancelada${cancelled.length === 1 ? '' : 's'}` : 'Entregadores';
    }

    const rankingBox = document.getElementById('courierRanking');
    if (rankingBox) {
      const deliveredItems = typeof reportItems === 'function' ? reportItems() : [];
      const ranking = (db.couriers || []).map(person => {
        const deliveredRows = deliveredItems.filter(item => item.courierId === person.id && item.status === 'Entregue');
        const payableRows = feeItems.filter(item => item.courierId === person.id);
        const cancelledRows = payableRows.filter(item => item.status === 'Cancelada');
        return {
          name: person.name,
          count: deliveredRows.length,
          cancelled: cancelledRows.length,
          fees: payableRows.reduce((sum, item) => sum + numberValue(item.fee), 0),
          revenue: deliveredRows.reduce((sum, item) => sum + numberValue(item.orderValue), 0)
        };
      }).filter(row => row.count || row.cancelled || row.fees)
        .sort((a, b) => b.count - a.count || b.fees - a.fees || b.revenue - a.revenue);

      rankingBox.innerHTML = ranking.length ? ranking.map((row, index) => `
        <div class="ranking-pro-row">
          <span class="rank-number">${index + 1}</span>
          <div><strong>${esc(row.name)}</strong><small>${row.count} entrega${row.count === 1 ? '' : 's'}${row.cancelled ? ` · ${row.cancelled} cancelada${row.cancelled === 1 ? '' : 's'} com taxa` : ''} · ${money(row.fees)} em taxas</small></div>
          <b>${money(row.revenue)}</b>
        </div>`).join('') : empty('Sem dados suficientes', 'As entregas e taxas aparecerão aqui.', 'trophy');
    }

    let note = document.getElementById('xbReportCancelledFeeNote');
    if (cancelled.length) {
      if (!note) {
        note = document.createElement('div');
        note.id = 'xbReportCancelledFeeNote';
        note.className = 'xb-report-cancelled-fee-note';
        document.getElementById('reportStats')?.insertAdjacentElement('afterend', note);
      }
      note.innerHTML = `${icon('info')}<span>As taxas dos entregadores incluem pedidos cancelados. Neste período: <b>${cancelled.length}</b> cancelado${cancelled.length === 1 ? '' : 's'} · <b>${money(cancelledFees)}</b> em taxas mantidas.</span>`;
    } else {
      note?.remove();
    }
  }

  function patchManagerPanel() {
    const today = todayDeliveries();
    const paymentPending = today.filter(item => isPending(item) && item.payment !== ONLINE_PAYMENT);
    const onlinePending = today.filter(item => isPending(item) && item.payment === ONLINE_PAYMENT);

    const manager = document.querySelector('#managerInsights .manager-pending');
    if (manager) {
      const count = manager.querySelector('b');
      const label = manager.querySelector('span:last-child');
      const pendingValue = paymentPending.reduce((sum, item) => sum + numberValue(item.orderValue), 0);
      manager.classList.toggle('warn', paymentPending.length > 0);
      manager.classList.toggle('ok', paymentPending.length === 0);
      if (count) count.textContent = String(paymentPending.length);
      if (label) label.textContent = paymentPending.length
        ? `${paymentPending.length === 1 ? 'pagamento a conferir' : 'pagamentos a conferir'} · ${money(pendingValue)}`
        : 'nenhum pagamento a conferir';
    }

    let onlineBadge = document.getElementById('xbManagerOnlineWaiting');
    if (onlinePending.length) {
      if (!onlineBadge) {
        onlineBadge = document.createElement('div');
        onlineBadge.id = 'xbManagerOnlineWaiting';
        onlineBadge.className = 'manager-pending ok xb-manager-online';
        document.querySelector('#managerInsights .manager-insights-head')?.appendChild(onlineBadge);
      }
      onlineBadge.innerHTML = `${icon('badge-check')}<b>${onlinePending.length}</b><span>pago${onlinePending.length === 1 ? '' : 's'} online aguardando entrega</span>`;
    } else {
      onlineBadge?.remove();
    }

    const topCourierArticle = [...document.querySelectorAll('#managerInsights .manager-insights-grid article')]
      .find(article => article.querySelector('span')?.textContent.trim() === 'Entregador destaque');
    if (topCourierArticle) {
      const name = topCourierArticle.querySelector('strong')?.textContent.trim();
      const person = (db.couriers || []).find(item => item.name === name);
      if (person) {
        const rows = today.filter(item => item.courierId === person.id && isFeePayable(item));
        const deliveredCount = rows.filter(item => item.status === 'Entregue').length;
        const cancelledCount = rows.filter(item => item.status === 'Cancelada').length;
        const fees = rows.reduce((sum, item) => sum + numberValue(item.fee), 0);
        const small = topCourierArticle.querySelector('small');
        if (small) small.textContent = `${deliveredCount} entrega${deliveredCount === 1 ? '' : 's'}${cancelledCount ? ` · ${cancelledCount} cancelada${cancelledCount === 1 ? '' : 's'}` : ''} · ${money(fees)} em taxas`;
      }
    }
  }

  function patchDeliveryQuickFilter() {
    const button = document.querySelector('[data-fast-filter="pending"]');
    if (button) button.innerHTML = `${icon('clock-3')}Pendentes`;
  }

  function patchClosingHistory() {
    const select = document.getElementById('closingHistoryDate');
    const body = document.getElementById('closingHistoryBody');
    if (!select || !body) return;
    const closing = (db.closings || []).find(item => item.date === select.value);
    const details = closing?.detailsV2;
    const cancelledCount = numberValue(details?.cancelledDeliveries);
    const cancelledFees = numberValue(details?.cancelledFees);

    body.querySelector('.xb-history-cancelled-note')?.remove();
    if (!cancelledCount) return;

    const note = document.createElement('div');
    note.className = 'closing-history-notice xb-history-cancelled-note';
    note.innerHTML = `${icon('circle-dollar-sign')}<span>Este fechamento inclui <b>${cancelledCount}</b> pedido${cancelledCount === 1 ? '' : 's'} cancelado${cancelledCount === 1 ? '' : 's'} cuja taxa continuou devida ao entregador: <b>${money(cancelledFees)}</b>.</span>`;
    const table = body.querySelector('.closing-history-table-wrap');
    if (table) table.insertAdjacentElement('beforebegin', note);
    else body.appendChild(note);
  }

  function patchAllVisible() {
    patchCourierCards();
    patchReportFees();
    patchManagerPanel();
    patchDeliveryQuickFilter();
    patchClosingHistory();
    refreshIcons();
  }

  function wrapGlobal(name, patch) {
    const current = window[name];
    if (typeof current !== 'function' || current.__xbBusinessRulesWrapped) return;
    const wrapped = function xbBusinessRulesWrapped(...args) {
      const result = current.apply(this, args);
      patch();
      return result;
    };
    wrapped.__xbBusinessRulesWrapped = true;
    window[name] = wrapped;
  }

  function installWrappers() {
    wrapGlobal('renderCouriers', patchCourierCards);
    wrapGlobal('renderReports', patchReportFees);
    wrapGlobal('renderDashboard', patchManagerPanel);
    wrapGlobal('renderDeliveries', patchDeliveryQuickFilter);
    wrapGlobal('renderClosing', patchClosingHistory);
  }

  // Ao editar uma entrega, "Pago online" continua confirmado automaticamente.
  // Se um pedido pendente voltar para outro meio de pagamento, ele volta a exigir conferência.
  document.getElementById('deliveryEditForm')?.addEventListener('submit', () => {
    setTimeout(() => {
      const id = document.getElementById('editDeliveryId')?.value;
      const item = (db.deliveries || []).find(delivery => delivery.id === id);
      if (!item) return;
      const now = new Date().toISOString();
      if (item.payment === ONLINE_PAYMENT) {
        if (!item.paymentConfirmedAt) item.paymentConfirmedAt = now;
      } else if (isPending(item)) {
        item.paymentConfirmedAt = '';
      }
      item.updatedAt = now;
      save();
      if (typeof renderDeliveries === 'function') renderDeliveries();
    }, 0);
  });

  document.addEventListener('change', event => {
    if (event.target?.id === 'closingHistoryDate') setTimeout(patchClosingHistory, 0);
  });

  if (!document.getElementById('xbBusinessRulesV2Style')) {
    const style = document.createElement('style');
    style.id = 'xbBusinessRulesV2Style';
    style.textContent = `
      .xb-cancelled-courier-note,.xb-report-cancelled-fee-note{display:flex;align-items:flex-start;gap:8px;padding:9px 11px;border:1px solid #ead6ab;border-radius:11px;background:#fff8e9;color:#765413;font-size:.77rem;line-height:1.4}
      .xb-cancelled-courier-note{margin:10px 0}
      .xb-report-cancelled-fee-note{margin:-5px 0 18px}
      .xb-cancelled-courier-note svg,.xb-report-cancelled-fee-note svg{width:15px;height:15px;flex:0 0 auto;margin-top:1px}
      .xb-manager-online{margin-left:8px}
      html.xb-low-power .xb-cancelled-courier-note,html.xb-low-power .xb-report-cancelled-fee-note{box-shadow:none!important}
    `;
    document.head.appendChild(style);
  }

  installWrappers();

  // Os módulos gerenciais são carregados depois. Reinstala os wrappers ao final
  // para que as regras de negócio tenham a última palavra na apresentação.
  window.addEventListener('xb:enhancements-ready', () => {
    installWrappers();
    patchAllVisible();
  }, { once: true });

  requestAnimationFrame(patchAllVisible);

  window.XBBusinessRules = Object.freeze({
    isFeePayable,
    reportFeeItems,
    refresh: patchAllVisible
  });
})();