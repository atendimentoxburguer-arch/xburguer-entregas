(() => {
  if (window.__xbCourierFeeConsistencyInstalled) return;
  window.__xbCourierFeeConsistencyInstalled = true;

  const isFeePayable = item => ['Entregue', 'Cancelada'].includes(item?.status);
  const numberValue = value => Number.isFinite(Number(value)) ? Number(value) : 0;

  function patchCourierCards() {
    const cards = [...document.querySelectorAll('#courierGrid .courier-card')];

    cards.forEach((card, index) => {
      const person = db.couriers?.[index];
      if (!person) return;

      const payableRows = (db.deliveries || []).filter(item =>
        item.courierId === person.id && isFeePayable(item)
      );
      const cancelledRows = payableRows.filter(item => item.status === 'Cancelada');
      const totalFees = payableRows.reduce((sum, item) => sum + numberValue(item.fee), 0);

      const dataRows = card.querySelectorAll('.courier-data');

      // A quantidade exibida passa a representar exatamente quantas corridas
      // geraram taxa. Canceladas entram aqui porque, pela regra da operação,
      // o entregador recebe a taxa mesmo quando o pedido é cancelado.
      const deliveryBlock = dataRows[0]?.children?.[1];
      if (deliveryBlock) {
        const label = deliveryBlock.querySelector('span');
        const value = deliveryBlock.querySelector('strong');
        if (label) label.textContent = 'Entregas com taxa';
        if (value) value.textContent = String(payableRows.length);
      }

      const feeBlock = dataRows[1]?.children?.[0];
      if (feeBlock) {
        const label = feeBlock.querySelector('span');
        const value = feeBlock.querySelector('strong');
        if (label) label.textContent = 'Taxas a receber';
        if (value) value.textContent = money(totalFees);
      }

      let detail = card.querySelector('.xb-fee-consistency-note');
      if (cancelledRows.length) {
        if (!detail) {
          detail = document.createElement('div');
          detail.className = 'xb-fee-consistency-note';
          card.querySelector('.courier-actions')?.insertAdjacentElement('beforebegin', detail);
        }
        detail.textContent = `${cancelledRows.length} cancelada${cancelledRows.length === 1 ? '' : 's'} incluída${cancelledRows.length === 1 ? '' : 's'} na quantidade e nas taxas.`;
      } else {
        detail?.remove();
      }
    });
  }

  function wrapRenderCouriers() {
    const current = window.renderCouriers;
    if (typeof current !== 'function' || current.__xbFeeConsistencyWrapped) return;

    const wrapped = function xbRenderCouriersFeeConsistent(...args) {
      const result = current.apply(this, args);
      patchCourierCards();
      return result;
    };
    wrapped.__xbFeeConsistencyWrapped = true;
    window.renderCouriers = wrapped;
  }

  if (!document.getElementById('xbFeeConsistencyStyle')) {
    const style = document.createElement('style');
    style.id = 'xbFeeConsistencyStyle';
    style.textContent = `
      .xb-fee-consistency-note{
        margin:8px 0 0;padding:7px 9px;border-radius:9px;
        background:#fff8e8;color:#765413;font-size:.72rem;font-weight:700;line-height:1.35
      }
    `;
    document.head.appendChild(style);
  }

  wrapRenderCouriers();
  requestAnimationFrame(patchCourierCards);

  window.addEventListener('xb:enhancements-ready', () => {
    wrapRenderCouriers();
    patchCourierCards();
  });

  window.addEventListener('xb:data-saved', () => {
    if (document.getElementById('page-couriers')?.classList.contains('active')) {
      requestAnimationFrame(patchCourierCards);
    }
  });

  window.XBCourierFeeConsistency = Object.freeze({ refresh: patchCourierCards });
})();
