(() => {
  if (window.__xbDeliveryEditPlusInstalled) return;
  window.__xbDeliveryEditPlusInstalled = true;

  const EDITABLE_STATUSES = [
    { value: 'Aguardando', label: 'Pagamento a conferir' },
    { value: 'Entregue', label: 'Entregue' },
    { value: 'Cancelada', label: 'Cancelada' }
  ];

  function ensureStatusField() {
    const form = document.getElementById('deliveryEditForm');
    const grid = form?.querySelector('.modal-body.form-grid');
    if (!grid || document.getElementById('editDeliveryStatus')) return;

    const paymentField = document.getElementById('editDeliveryPayment')?.closest('.field');
    const field = document.createElement('div');
    field.className = 'field span-6 xb-edit-status-field';
    field.innerHTML = `
      <label for="editDeliveryStatus">Situação do pedido</label>
      <select id="editDeliveryStatus">
        ${EDITABLE_STATUSES.map(item => `<option value="${item.value}">${item.label}</option>`).join('')}
      </select>
      <small class="field-help">Você pode reabrir um pedido entregue ou corrigir o status quando necessário.</small>
    `;

    if (paymentField?.nextSibling) paymentField.parentNode.insertBefore(field, paymentField.nextSibling);
    else grid.appendChild(field);
  }

  function setEditStatus(item) {
    const select = document.getElementById('editDeliveryStatus');
    if (!select || !item) return;
    select.value = item.status === 'Em rota' ? 'Aguardando' : (item.status || 'Aguardando');
  }

  function enhanceEditorHeader(item) {
    const title = document.getElementById('deliveryModalTitle');
    if (title && item) title.textContent = `Editar entrega #${String(item.code || '').padStart(3, '0')}`;
  }

  function syncFeeFromEditedCourier() {
    const courierSelect = document.getElementById('editDeliveryCourier');
    const feeInput = document.getElementById('editDeliveryFee');
    if (!courierSelect || !feeInput) return;

    const person = db.couriers.find(item => item.id === courierSelect.value);
    if (!person) return;

    feeInput.value = Number(person.fee || 0).toFixed(2);
    feeInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  ensureStatusField();

  const previousOpenDeliveryEditor = openDeliveryEditor;
  openDeliveryEditor = function xbOpenFullDeliveryEditor(item) {
    ensureStatusField();
    previousOpenDeliveryEditor(item);
    setEditStatus(item);
    enhanceEditorHeader(item);
  };

  // Ao trocar o entregador de uma entrega já cadastrada, a taxa acompanha
  // automaticamente a taxa cadastrada para aquele entregador. Antes disso, a
  // troca podia manter a taxa do entregador anterior e causar divergência.
  document.getElementById('editDeliveryCourier')?.addEventListener('change', syncFeeFromEditedCourier);

  document.getElementById('deliveryEditForm')?.addEventListener('submit', () => {
    const id = document.getElementById('editDeliveryId')?.value;
    const select = document.getElementById('editDeliveryStatus');
    const item = db.deliveries.find(delivery => delivery.id === id);
    if (!item || !select) return;

    const nextStatus = EDITABLE_STATUSES.some(option => option.value === select.value)
      ? select.value
      : 'Aguardando';

    item.status = nextStatus;
    item.updatedAt = new Date().toISOString();
    save();
    renderAll();
  });

  function makeEditButtonsClear() {
    document.querySelectorAll('[data-delivery-action="edit"]').forEach(button => {
      button.classList.add('delivery-edit-btn');
      button.title = 'Editar todas as informações da entrega';
      button.setAttribute('aria-label', 'Editar entrega');
      button.innerHTML = `${icon('pencil')}<span>Editar</span>`;
    });
  }

  const previousRenderDeliveries = renderDeliveries;
  renderDeliveries = function xbRenderDeliveriesWithFullEdit() {
    previousRenderDeliveries();
    makeEditButtonsClear();
    refreshIcons();
  };

  if (!document.getElementById('xbDeliveryEditPlusStyle')) {
    const style = document.createElement('style');
    style.id = 'xbDeliveryEditPlusStyle';
    style.textContent = `
      .delivery-edit-btn{
        min-height:36px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:6px!important;
        width:auto!important;padding:0 10px!important;border-radius:10px!important;color:#6f4b16!important;
        border-color:#ead8ae!important;background:linear-gradient(135deg,#fffaf0,#fff1cf)!important;
        font-size:.76rem!important;font-weight:800!important;white-space:nowrap!important
      }
      .delivery-edit-btn:hover{border-color:#dabb77!important;background:linear-gradient(135deg,#fff6e3,#ffe7b0)!important}
      .delivery-edit-btn svg{width:15px!important;height:15px!important}
      .xb-edit-status-field select{font-weight:750}
      .xb-edit-status-field .field-help{display:block;margin-top:7px;line-height:1.45}
      @media(max-width:720px){
        .delivery-edit-btn{min-height:38px!important;padding:0 9px!important}
      }
    `;
    document.head.appendChild(style);
  }

  renderDeliveries();
  refreshIcons();
})();
