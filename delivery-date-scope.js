(() => {
  if (window.__xbDeliveryDateScopeInstalled) return;
  window.__xbDeliveryDateScopeInstalled = true;

  const isPending = item => item?.status === 'Aguardando' || item?.status === 'Em rota';

  function scopedDeliveries() {
    const range = document.getElementById('dateFilter')?.value || 'today';
    if (typeof filterRange === 'function') return filterRange([...(db.deliveries || [])], range);
    return [...(db.deliveries || [])];
  }

  function setCard(card, value, label, detail) {
    if (!card) return;
    const valueNode = card.querySelector('.stat-value');
    const labelNode = card.querySelector('.stat-label');
    const detailNode = card.querySelector('.stat-detail');
    if (valueNode) valueNode.textContent = String(value);
    if (labelNode) labelNode.textContent = label;
    if (detailNode && detail !== undefined) detailNode.textContent = detail;
  }

  function applyDateScopedStats() {
    const holder = document.getElementById('deliveryStats');
    if (!holder) return;

    const items = scopedDeliveries();
    const paymentPending = items.filter(item => isPending(item) && item.payment !== 'Pago online');
    const onlinePending = items.filter(item => isPending(item) && item.payment === 'Pago online');
    const delivered = items.filter(item => item.status === 'Entregue');
    const cards = [...holder.querySelectorAll('.stat')];

    setCard(cards[0], items.length, 'Total de entregas', '');
    setCard(cards[1], paymentPending.length, 'Pagamento a conferir', 'Pendentes');
    setCard(cards[2], onlinePending.length, 'Pagos online', 'Aguardando entrega');
    setCard(cards[3], delivered.length, 'Entregues', '');
  }

  if (typeof renderDeliveries === 'function') {
    const previousRenderDeliveries = renderDeliveries;
    renderDeliveries = function xbDateScopedRenderDeliveries() {
      previousRenderDeliveries();
      applyDateScopedStats();
    };
  }

  ['deliverySearch', 'statusFilter', 'dateFilter'].forEach(id => {
    const control = document.getElementById(id);
    if (!control) return;
    const eventName = id === 'deliverySearch' ? 'input' : 'change';
    control.addEventListener(eventName, () => setTimeout(applyDateScopedStats, 0));
  });

  ['xb:cloud-ready', 'xb:cloud-pulled', 'xb:cloud-synced'].forEach(name => {
    window.addEventListener(name, () => setTimeout(applyDateScopedStats, 0));
  });

  applyDateScopedStats();
})();
