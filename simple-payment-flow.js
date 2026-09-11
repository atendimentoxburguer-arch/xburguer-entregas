(() => {
  if (window.__xbSimplePaymentFlowInstalled) return;
  window.__xbSimplePaymentFlowInstalled = true;

  const PENDING_STATUS = 'Aguardando';
  const DELIVERED_STATUS = 'Entregue';

  function pendingToday() {
    return todayDeliveries().filter(item => item.status === PENDING_STATUS);
  }

  function migrateLegacyRouteStatus() {
    let changed = false;
    db.deliveries.forEach(item => {
      if (item.status === 'Em rota') {
        item.status = PENDING_STATUS;
        item.updatedAt = new Date().toISOString();
        changed = true;
      }
    });
    if (changed) save();
  }

  function configureStatusFilter() {
    const select = document.getElementById('statusFilter');
    if (!select) return;

    [...select.options].forEach(option => {
      if (option.value === 'Em rota') option.remove();
      if (option.value === PENDING_STATUS) option.textContent = 'Pagamento a conferir';
    });

    if (select.value === 'Em rota') select.value = '';
  }

  function updateStaticCopy() {
    const heroText = document.querySelector('#page-dashboard .hero-copy p');
    if (heroText) heroText.textContent = 'Cadastre os pedidos, confira os pagamentos e acompanhe os resultados do dia sem etapas desnecessárias.';

    const deliveryCardSubtitle = document.querySelector('#deliveryForm .card-head p');
    if (deliveryCardSubtitle) deliveryCardSubtitle.textContent = 'Cadastre o pedido. Depois, basta conferir o pagamento para concluir a entrega.';
  }

  const previousStatusHTML = statusHTML;
  statusHTML = function xbSimpleStatusHTML(status) {
    if (status === PENDING_STATUS || status === 'Em rota') {
      return '<span class="status waiting">Pagamento a conferir</span>';
    }
    return previousStatusHTML(status);
  };

  function updateDashboardAfterRender() {
    const pending = pendingToday();
    const done = delivered(todayDeliveries());
    const pendingCash = pending.filter(item => item.payment === 'Dinheiro');
    const pendingWithChange = pendingCash.filter(item => getChangeFor(item));

    const cards = [...document.querySelectorAll('#dashboardStats .stat')];
    const routeCard = cards.find(card => card.querySelector('.stat-label')?.textContent.trim() === 'Em rota agora');
    if (routeCard) {
      const value = routeCard.querySelector('.stat-value');
      const label = routeCard.querySelector('.stat-label');
      const detail = routeCard.querySelector('.stat-detail');
      const iconBox = routeCard.querySelector('.stat-icon');
      if (value) value.textContent = String(pending.length);
      if (label) label.textContent = 'Pagamentos a conferir';
      if (detail) detail.textContent = 'Pendentes';
      if (iconBox) {
        iconBox.className = 'stat-icon orange';
        iconBox.innerHTML = icon('wallet-cards');
      }
    }

    const summary = document.getElementById('operationSummary');
    if (summary) {
      const fees = done.reduce((sum, item) => sum + Number(item.fee || 0), 0);
      summary.innerHTML = `<div class="summary-list">
        <div class="summary-row"><span>Pagamentos a conferir</span><b>${pending.length}</b></div>
        <div class="summary-row"><span>Entregues hoje</span><b>${done.length}</b></div>
        <div class="summary-row"><span>Dinheiro aguardando conferência</span><b>${pendingCash.length}</b></div>
        <div class="summary-row total"><span>Taxas realizadas</span><b>${money(fees)}</b></div>
      </div>`;
    }

    const pulse = document.getElementById('opsPulse');
    if (pulse) {
      const chips = pending.length
        ? `<span class="ops-chip warn">${icon('wallet-cards')} ${pending.length} pagamento${pending.length === 1 ? '' : 's'} a conferir</span>${pendingWithChange.length ? `<span class="ops-chip info">${icon('banknote')} ${pendingWithChange.length} com troco</span>` : ''}`
        : `<span class="ops-chip good">${icon('circle-check-big')} Todos os pagamentos conferidos</span>`;

      pulse.innerHTML = `
        <div class="ops-pulse-main">
          <div class="ops-pulse-icon">${icon('badge-check')}</div>
          <div class="ops-pulse-copy"><strong>Conferência de pagamentos</strong><small>Pedidos cadastrados ficam aqui até o pagamento ser conferido.</small></div>
        </div>
        <div class="ops-pulse-items">${chips}</div>
        <button class="btn btn-light btn-sm" type="button" data-open-deliveries>${icon('arrow-right')}Conferir pedidos</button>`;
    }
  }

  const previousRenderDashboard = renderDashboard;
  renderDashboard = function xbSimplePaymentRenderDashboard() {
    previousRenderDashboard();
    updateDashboardAfterRender();
    refreshIcons();
  };

  function updateDeliveriesAfterRender() {
    const stats = [...document.querySelectorAll('#deliveryStats .stat')];
    if (stats[1]) {
      const value = stats[1].querySelector('.stat-value');
      const label = stats[1].querySelector('.stat-label');
      const detail = stats[1].querySelector('.stat-detail');
      if (value) value.textContent = String(db.deliveries.filter(item => item.status === PENDING_STATUS).length);
      if (label) label.textContent = 'Pagamento a conferir';
      if (detail) detail.textContent = 'Pendentes';
    }
    if (stats[2]) {
      const value = stats[2].querySelector('.stat-value');
      const label = stats[2].querySelector('.stat-label');
      const detail = stats[2].querySelector('.stat-detail');
      const iconBox = stats[2].querySelector('.stat-icon');
      if (value) value.textContent = String(db.deliveries.filter(item => item.status === 'Cancelada').length);
      if (label) label.textContent = 'Canceladas';
      if (detail) detail.textContent = 'Total';
      if (iconBox) {
        iconBox.className = 'stat-icon red';
        iconBox.innerHTML = icon('ban');
      }
    }

    document.querySelectorAll('[data-delivery-action="advance"]').forEach(button => {
      button.dataset.deliveryAction = 'confirm-payment';
      button.className = 'payment-confirm-btn';
      button.title = 'Conferir pagamento e marcar como entregue';
      button.setAttribute('aria-label', 'Conferir pagamento');
      button.innerHTML = `${icon('badge-check')}<span>Conferir pagamento</span>`;
    });
  }

  const previousRenderDeliveries = renderDeliveries;
  renderDeliveries = function xbSimplePaymentRenderDeliveries() {
    previousRenderDeliveries();
    updateDeliveriesAfterRender();
    refreshIcons();
  };

  const previousRenderClosing = renderClosing;
  renderClosing = function xbSimplePaymentRenderClosing() {
    previousRenderClosing();
    const cards = [...document.querySelectorAll('#closingStats .stat')];
    const pendingCard = cards.find(card => card.querySelector('.stat-label')?.textContent.trim() === 'Pendentes');
    if (pendingCard) {
      const label = pendingCard.querySelector('.stat-label');
      const detail = pendingCard.querySelector('.stat-detail');
      if (label) label.textContent = 'Pagamentos a conferir';
      if (detail) detail.textContent = 'Hoje';
    }
    refreshIcons();
  };

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-delivery-action="confirm-payment"]');
    if (!button) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const item = db.deliveries.find(delivery => delivery.id === button.dataset.id);
    if (!item || item.status === DELIVERED_STATUS || item.status === 'Cancelada') return;

    item.status = DELIVERED_STATUS;
    item.updatedAt = new Date().toISOString();
    save();
    toast(`Pagamento conferido. Entrega #${String(item.code).padStart(3, '0')} concluída.`);
    renderAll();
  }, true);

  if (!document.getElementById('xbSimplePaymentFlowStyle')) {
    const style = document.createElement('style');
    style.id = 'xbSimplePaymentFlowStyle';
    style.textContent = `
      .payment-confirm-btn{
        min-height:36px;display:inline-flex;align-items:center;justify-content:center;gap:7px;
        padding:0 12px;border:1px solid #b9dfca;border-radius:11px;
        background:linear-gradient(135deg,#effaf3 0%,#e2f5e9 100%);color:#13754a;
        font:inherit;font-size:.78rem;font-weight:800;white-space:nowrap;
        box-shadow:0 5px 14px rgba(19,117,74,.08);transition:.17s ease
      }
      .payment-confirm-btn:hover{transform:translateY(-1px);border-color:#93cfad;background:linear-gradient(135deg,#e8f8ee 0%,#d9f1e3 100%);box-shadow:0 9px 20px rgba(19,117,74,.13)}
      .payment-confirm-btn svg{width:16px;height:16px;stroke-width:2.2}
      @media(max-width:720px){.payment-confirm-btn{min-height:38px;padding:0 10px;font-size:.75rem}}
    `;
    document.head.appendChild(style);
  }

  migrateLegacyRouteStatus();
  configureStatusFilter();
  updateStaticCopy();
  renderAll();
  refreshIcons();
})();