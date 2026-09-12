(() => {
  if (window.__xbSimplePaymentFlowInstalled) return;
  window.__xbSimplePaymentFlowInstalled = true;

  const PENDING_STATUS = 'Aguardando';
  const DELIVERED_STATUS = 'Entregue';
  const ONLINE_PAYMENT = 'Pago online';

  const isPending = item => item?.status === PENDING_STATUS || item?.status === 'Em rota';
  const isOnlinePaid = item => item?.payment === ONLINE_PAYMENT;
  const needsPaymentCheck = item => isPending(item) && !isOnlinePaid(item);
  const waitsOnlyDelivery = item => isPending(item) && isOnlinePaid(item);

  function pendingToday() {
    return todayDeliveries().filter(isPending);
  }

  function migrateLegacyState() {
    let changed = false;
    db.deliveries.forEach(item => {
      if (item.status === 'Em rota') {
        item.status = PENDING_STATUS;
        item.updatedAt = new Date().toISOString();
        changed = true;
      }
      // Pedidos "Pago online" já estavam quitados na origem. Para registros antigos,
      // usamos a criação como referência de confirmação quando não havia timestamp.
      if (item.payment === ONLINE_PAYMENT && !item.paymentConfirmedAt) {
        item.paymentConfirmedAt = item.createdAt || new Date().toISOString();
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
      if (option.value === PENDING_STATUS) option.textContent = 'Pendentes';
    });

    if (select.value === 'Em rota') select.value = '';
  }

  function updateStaticCopy() {
    const heroText = document.querySelector('#page-dashboard .hero-copy p');
    if (heroText) heroText.textContent = 'Cadastre os pedidos, confira os pagamentos quando necessário e acompanhe as entregas do dia.';

    const deliveryCardSubtitle = document.querySelector('#deliveryForm .card-head p');
    if (deliveryCardSubtitle) deliveryCardSubtitle.textContent = 'Pedidos pagos online já ficam confirmados; os demais aguardam conferência do pagamento.';
  }

  const previousStatusHTML = statusHTML;
  statusHTML = function xbSimpleStatusHTML(status) {
    if (status === PENDING_STATUS || status === 'Em rota') {
      return '<span class="status waiting">Pendente</span>';
    }
    return previousStatusHTML(status);
  };

  const previousPaymentHTML = paymentHTML;
  paymentHTML = function xbPaymentStateHTML(item) {
    const base = previousPaymentHTML(item);
    if (!isOnlinePaid(item)) return base;
    return `${base}<span class="table-muted xb-online-paid-label">${icon('circle-check-big')} Pagamento confirmado</span>`;
  };

  function feePayableToday() {
    return todayDeliveries().filter(item => ['Entregue', 'Cancelada'].includes(item.status));
  }

  function updateDashboardAfterRender() {
    const allPending = pendingToday();
    const paymentPending = allPending.filter(needsPaymentCheck);
    const onlinePending = allPending.filter(waitsOnlyDelivery);
    const done = delivered(todayDeliveries());
    const pendingCash = paymentPending.filter(item => item.payment === 'Dinheiro');
    const pendingWithChange = pendingCash.filter(item => getChangeFor(item));

    const cards = [...document.querySelectorAll('#dashboardStats .stat')];
    const routeCard = cards.find(card => card.querySelector('.stat-label')?.textContent.trim() === 'Em rota agora');
    if (routeCard) {
      const value = routeCard.querySelector('.stat-value');
      const label = routeCard.querySelector('.stat-label');
      const detail = routeCard.querySelector('.stat-detail');
      const iconBox = routeCard.querySelector('.stat-icon');
      if (value) value.textContent = String(paymentPending.length);
      if (label) label.textContent = 'Pagamentos a conferir';
      if (detail) detail.textContent = 'Pendentes';
      if (iconBox) {
        iconBox.className = 'stat-icon orange';
        iconBox.innerHTML = icon('wallet-cards');
      }
    }

    const summary = document.getElementById('operationSummary');
    if (summary) {
      const fees = feePayableToday().reduce((sum, item) => sum + Number(item.fee || 0), 0);
      summary.innerHTML = `<div class="summary-list">
        <div class="summary-row"><span>Pagamentos a conferir</span><b>${paymentPending.length}</b></div>
        <div class="summary-row"><span>Pagos online aguardando entrega</span><b>${onlinePending.length}</b></div>
        <div class="summary-row"><span>Entregues hoje</span><b>${done.length}</b></div>
        <div class="summary-row total"><span>Taxas dos entregadores</span><b>${money(fees)}</b></div>
      </div>`;
    }

    const pulse = document.getElementById('opsPulse');
    if (pulse) {
      const chips = [
        paymentPending.length
          ? `<span class="ops-chip warn">${icon('wallet-cards')} ${paymentPending.length} pagamento${paymentPending.length === 1 ? '' : 's'} a conferir</span>`
          : `<span class="ops-chip good">${icon('circle-check-big')} Nenhum pagamento pendente</span>`,
        onlinePending.length
          ? `<span class="ops-chip good">${icon('badge-check')} ${onlinePending.length} pago${onlinePending.length === 1 ? '' : 's'} online aguardando entrega</span>`
          : '',
        pendingWithChange.length
          ? `<span class="ops-chip info">${icon('banknote')} ${pendingWithChange.length} com troco</span>`
          : ''
      ].filter(Boolean).join('');

      pulse.innerHTML = `
        <div class="ops-pulse-main">
          <div class="ops-pulse-icon">${icon('badge-check')}</div>
          <div class="ops-pulse-copy"><strong>Pagamentos e entregas</strong><small>Pago online não precisa de conferência; basta marcar a entrega quando for concluída.</small></div>
        </div>
        <div class="ops-pulse-items">${chips}</div>
        <button class="btn btn-light btn-sm" type="button" data-open-deliveries>${icon('arrow-right')}Ver pedidos</button>`;
    }
  }

  const previousRenderDashboard = renderDashboard;
  renderDashboard = function xbSimplePaymentRenderDashboard() {
    previousRenderDashboard();
    updateDashboardAfterRender();
    refreshIcons();
  };

  function updateDeliveryRow(item, button) {
    const row = button?.closest('tr');
    if (!row) return;
    const status = row.querySelector('.status.waiting');
    if (status) {
      status.textContent = isOnlinePaid(item) ? 'Aguardando entrega' : 'Pagamento a conferir';
      status.classList.toggle('xb-online-waiting', isOnlinePaid(item));
    }
  }

  function updateDeliveriesAfterRender() {
    const allPending = db.deliveries.filter(isPending);
    const paymentPending = allPending.filter(needsPaymentCheck);
    const onlinePending = allPending.filter(waitsOnlyDelivery);
    const stats = [...document.querySelectorAll('#deliveryStats .stat')];

    if (stats[1]) {
      const value = stats[1].querySelector('.stat-value');
      const label = stats[1].querySelector('.stat-label');
      const detail = stats[1].querySelector('.stat-detail');
      if (value) value.textContent = String(paymentPending.length);
      if (label) label.textContent = 'Pagamento a conferir';
      if (detail) detail.textContent = 'Pendentes';
    }
    if (stats[2]) {
      const value = stats[2].querySelector('.stat-value');
      const label = stats[2].querySelector('.stat-label');
      const detail = stats[2].querySelector('.stat-detail');
      const iconBox = stats[2].querySelector('.stat-icon');
      if (value) value.textContent = String(onlinePending.length);
      if (label) label.textContent = 'Pagos online';
      if (detail) detail.textContent = 'Aguardando entrega';
      if (iconBox) {
        iconBox.className = 'stat-icon green';
        iconBox.innerHTML = icon('badge-check');
      }
    }

    document.querySelectorAll('[data-delivery-action="advance"]').forEach(button => {
      const item = db.deliveries.find(delivery => delivery.id === button.dataset.id);
      if (!item) return;

      if (isOnlinePaid(item)) {
        button.dataset.deliveryAction = 'complete-online';
        button.className = 'payment-confirm-btn online-delivery-btn';
        button.title = 'Pagamento já confirmado. Marcar entrega como concluída';
        button.setAttribute('aria-label', 'Marcar como entregue');
        button.innerHTML = `${icon('package-check')}<span>Marcar como entregue</span>`;
      } else {
        button.dataset.deliveryAction = 'confirm-payment';
        button.className = 'payment-confirm-btn';
        button.title = 'Conferir pagamento e marcar como entregue';
        button.setAttribute('aria-label', 'Conferir pagamento');
        button.innerHTML = `${icon('badge-check')}<span>Conferir pagamento</span>`;
      }
      updateDeliveryRow(item, button);
    });

    // Reaplica a identificação nas linhas já convertidas em renderizações subsequentes.
    document.querySelectorAll('[data-delivery-action="confirm-payment"],[data-delivery-action="complete-online"]').forEach(button => {
      const item = db.deliveries.find(delivery => delivery.id === button.dataset.id);
      if (item) updateDeliveryRow(item, button);
    });
  }

  const previousRenderDeliveries = renderDeliveries;
  renderDeliveries = function xbSimplePaymentRenderDeliveries() {
    previousRenderDeliveries();
    updateDeliveriesAfterRender();
    refreshIcons();
  };

  ['deliverySearch', 'statusFilter', 'dateFilter'].forEach(id => {
    const control = document.getElementById(id);
    if (!control) return;
    const eventName = id === 'deliverySearch' ? 'input' : 'change';
    control.addEventListener(eventName, () => {
      setTimeout(() => {
        updateDeliveriesAfterRender();
        refreshIcons();
      }, 0);
    });
  });

  const previousRenderClosing = renderClosing;
  renderClosing = function xbSimplePaymentRenderClosing() {
    previousRenderClosing();
    const cards = [...document.querySelectorAll('#closingStats .stat')];
    const pendingCard = cards.find(card => card.querySelector('.stat-label')?.textContent.trim() === 'Pendentes');
    if (pendingCard) {
      const label = pendingCard.querySelector('.stat-label');
      const detail = pendingCard.querySelector('.stat-detail');
      if (label) label.textContent = 'Pendências';
      if (detail) detail.textContent = 'Pagamento ou entrega';
    }
    refreshIcons();
  };

  document.addEventListener('click', event => {
    const onlineButton = event.target.closest('[data-delivery-action="complete-online"]');
    const confirmButton = event.target.closest('[data-delivery-action="confirm-payment"]');
    const button = onlineButton || confirmButton;
    if (!button) return;

    // O fluxo profissional de conferência (payment-confirmation-pro.js) intercepta
    // pagamentos comuns antes daqui. Este fallback mantém o sistema funcional e
    // trata especificamente os pedidos já pagos online.
    if (confirmButton && window.__xbPaymentConfirmationProInstalled) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const item = db.deliveries.find(delivery => delivery.id === button.dataset.id);
    if (!item || item.status === DELIVERED_STATUS || item.status === 'Cancelada') return;

    const now = new Date().toISOString();
    item.status = DELIVERED_STATUS;
    if (isOnlinePaid(item) && !item.paymentConfirmedAt) item.paymentConfirmedAt = item.createdAt || now;
    if (!isOnlinePaid(item)) item.paymentConfirmedAt = now;
    item.updatedAt = now;
    save();
    toast(isOnlinePaid(item)
      ? `Entrega #${String(item.code).padStart(3, '0')} marcada como entregue.`
      : `Pagamento conferido. Entrega #${String(item.code).padStart(3, '0')} concluída.`);
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
      .online-delivery-btn{border-color:#bfd6eb;background:linear-gradient(135deg,#f0f7fd,#e3f0fb);color:#246490}
      .online-delivery-btn:hover{border-color:#9bc3e4;background:linear-gradient(135deg,#e8f4fd,#d8ebfa)}
      .xb-online-paid-label{display:flex!important;align-items:center;gap:4px;margin-top:3px;color:#13754a!important;font-weight:800!important}
      .xb-online-paid-label svg{width:13px;height:13px}
      .status.xb-online-waiting{background:#e9f4ff!important;color:#246490!important;border-color:#bedaf0!important}
      @media(max-width:720px){.payment-confirm-btn{min-height:38px;padding:0 10px;font-size:.75rem}}
    `;
    document.head.appendChild(style);
  }

  migrateLegacyState();
  configureStatusFilter();
  updateStaticCopy();
  renderAll();
  refreshIcons();
})();