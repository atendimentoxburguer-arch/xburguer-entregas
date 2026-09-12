(() => {
  if (window.__xbCourierFeeConsistencyInstalled) return;
  window.__xbCourierFeeConsistencyInstalled = true;

  const isFeePayable = item => ['Entregue', 'Cancelada'].includes(item?.status);
  const numberValue = value => Number.isFinite(Number(value)) ? Number(value) : 0;

  function courierById(id) {
    return (db.couriers || []).find(item => item.id === id) || null;
  }

  function defaultFeeFor(courierId) {
    return Math.max(0, numberValue(courierById(courierId)?.fee));
  }

  // Regra de integridade local: um entregador cuja taxa padrão é positiva nunca
  // pode ficar com uma entrega em R$ 0,00 por falha de formulário/cache.
  // Taxas personalizadas POSITIVAS continuam permitidas para casos especiais.
  function normalizeDeliveryFee(item, touch = true) {
    if (!item?.courierId) return false;
    const defaultFee = defaultFeeFor(item.courierId);
    const currentFee = numberValue(item.fee);

    if (currentFee < 0 || (defaultFee > 0 && currentFee <= 0)) {
      item.fee = defaultFee;
      if (touch) item.updatedAt = new Date().toISOString();
      return true;
    }
    return false;
  }

  function repairInvalidFees() {
    let changed = false;
    (db.deliveries || []).forEach(item => {
      if (normalizeDeliveryFee(item)) changed = true;
    });
    return changed;
  }

  function applyFeeToInput(courierSelectId, feeInputId, forceDefault = false) {
    const select = document.getElementById(courierSelectId);
    const input = document.getElementById(feeInputId);
    if (!select || !input) return;

    const defaultFee = defaultFeeFor(select.value);
    const currentFee = numberValue(input.value);
    if (forceDefault || currentFee < 0 || (defaultFee > 0 && currentFee <= 0)) {
      input.value = defaultFee.toFixed(2);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  // Ao trocar o entregador, assume imediatamente a taxa padrão do novo entregador.
  // O usuário ainda pode substituir por outro valor positivo depois da escolha.
  document.getElementById('deliveryCourier')?.addEventListener('change', () => {
    applyFeeToInput('deliveryCourier', 'deliveryFee', true);
  });
  document.getElementById('editDeliveryCourier')?.addEventListener('change', () => {
    applyFeeToInput('editDeliveryCourier', 'editDeliveryFee', true);
  });

  // Executa na fase de captura, antes dos handlers de cadastro/edição existentes.
  // Assim até versões antigas do formulário recebem a correção antes de salvar.
  document.getElementById('deliveryForm')?.addEventListener('submit', () => {
    applyFeeToInput('deliveryCourier', 'deliveryFee');
  }, true);
  document.getElementById('deliveryEditForm')?.addEventListener('submit', () => {
    applyFeeToInput('editDeliveryCourier', 'editDeliveryFee');
  }, true);

  // Última barreira no navegador: qualquer rotina que chame save() passa primeiro
  // por uma verificação das taxas, inclusive restauração, edição e sincronização local.
  if (typeof window.save === 'function' && !window.save.__xbFeeIntegrityGuard) {
    const previousSave = window.save;
    const guardedSave = function xbFeeIntegritySave(...args) {
      repairInvalidFees();
      return previousSave.apply(this, args);
    };
    guardedSave.__xbFeeIntegrityGuard = true;
    guardedSave.__xbPreviousSave = previousSave;
    window.save = guardedSave;
  }

  function persistRepairsIfNeeded() {
    if (!repairInvalidFees()) return false;
    if (typeof save === 'function') save();
    return true;
  }

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

      // A quantidade exibida representa exatamente quantas corridas geraram taxa.
      // Canceladas entram porque o entregador recebe a taxa mesmo com cancelamento.
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

  // Corrige qualquer dado local antigo inválido uma única vez na inicialização.
  requestAnimationFrame(() => {
    persistRepairsIfNeeded();
    patchCourierCards();
  });

  // Depois de baixar o snapshot do Supabase, valida novamente antes de continuar.
  window.addEventListener('xb:cloud-ready', () => {
    setTimeout(() => {
      persistRepairsIfNeeded();
      patchCourierCards();
    }, 0);
  });

  window.addEventListener('xb:enhancements-ready', () => {
    wrapRenderCouriers();
    patchCourierCards();
  });

  window.addEventListener('xb:data-saved', () => {
    if (document.getElementById('page-couriers')?.classList.contains('active')) {
      requestAnimationFrame(patchCourierCards);
    }
  });

  window.XBCourierFeeConsistency = Object.freeze({
    refresh: patchCourierCards,
    repair: persistRepairsIfNeeded,
    defaultFeeFor
  });
})();