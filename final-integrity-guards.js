(() => {
  if (window.__xbFinalIntegrityGuardsInstalled) return;
  window.__xbFinalIntegrityGuardsInstalled = true;

  const finalStatuses = new Set(['Entregue', 'Cancelada']);
  const numberValue = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const dayKey = value => window.XBMetrics?.dayKey?.(value) || (typeof dateKey === 'function' ? dateKey(value instanceof Date ? value : new Date(value)) : '');

  function issueForCompletion(item) {
    if (!item) return 'Pedido não encontrado.';
    if (numberValue(item.orderValue) <= 0) return 'Informe um valor de pedido maior que zero antes de concluir esta entrega.';
    if (!String(item.address || '').trim()) return 'Informe o endereço antes de concluir esta entrega.';
    if (!item.courierId) return 'Selecione um entregador antes de concluir esta entrega.';
    if (numberValue(item.fee) < 0) return 'A taxa de entrega não pode ser negativa.';
    if (item.payment === 'Dinheiro' && item.changeFor !== '' && item.changeFor !== null && item.changeFor !== undefined && numberValue(item.changeFor) < numberValue(item.orderValue)) {
      return 'O valor para troco não pode ser menor que o valor do pedido.';
    }
    return '';
  }

  function deliveryIssues(item) {
    const issues = [];
    if (!item || !item.id) issues.push('registro sem ID');
    if (!Number.isInteger(Number(item?.code)) || Number(item?.code) <= 0) issues.push('número de pedido inválido');
    if (!String(item?.address || '').trim()) issues.push('endereço ausente');
    if (numberValue(item?.orderValue) <= 0) issues.push('valor do pedido zerado');
    if (numberValue(item?.fee) < 0) issues.push('taxa negativa');
    if (item?.payment !== 'Dinheiro' && item?.changeFor !== '' && item?.changeFor !== null && item?.changeFor !== undefined) issues.push('troco em pagamento não monetário');
    if (item?.payment === 'Dinheiro' && item?.changeFor !== '' && item?.changeFor !== null && item?.changeFor !== undefined && numberValue(item.changeFor) < numberValue(item.orderValue)) issues.push('troco menor que o pedido');
    if (item?.status === 'Entregue' && !item?.courierId) issues.push('entrega concluída sem entregador');
    return issues;
  }

  function diagnostics() {
    const issues = [];
    const codes = new Set();
    const ids = new Set();
    (db.deliveries || []).forEach(item => {
      const id = String(item?.id || '');
      const code = Number(item?.code || 0);
      if (id && ids.has(id)) issues.push(`ID duplicado: ${id}`);
      if (id) ids.add(id);
      if (code > 0 && codes.has(code)) issues.push(`Pedido duplicado: #${code}`);
      if (code > 0) codes.add(code);
      deliveryIssues(item).forEach(issue => issues.push(`Pedido #${code || '?'}: ${issue}`));
    });
    (db.closings || []).forEach(closing => {
      if (window.XBClosingContinuity?.needsRepair?.(closing)) issues.push(`Fechamento ${closing.date}: registro interno divergente`);
    });
    return { ok: issues.length === 0, issues };
  }

  function refreshAuditIndicator() {
    const result = diagnostics();
    const node = document.getElementById('auditIntegrityStatus');
    if (node) {
      node.textContent = result.ok ? 'Verificada' : `${result.issues.length} pendência${result.issues.length === 1 ? '' : 's'}`;
      node.style.color = result.ok ? '' : '#b42318';
      node.title = result.ok ? 'Dados operacionais conferidos.' : result.issues.slice(0, 5).join('\n');
    }
    return result;
  }

  function patchInvalidDeliveryRows() {
    document.querySelectorAll('#deliveriesTable tbody tr').forEach(row => {
      row.classList.remove('xb-integrity-attention');
      row.querySelector('.xb-integrity-row-note')?.remove();
      const button = row.querySelector('[data-id][data-delivery-action], [data-edit-delivery], [data-delivery-edit]');
      const id = button?.dataset?.id || button?.dataset?.editDelivery || button?.dataset?.deliveryEdit;
      const item = (db.deliveries || []).find(delivery => String(delivery.id) === String(id));
      if (!item || finalStatuses.has(item.status)) return;
      const problem = issueForCompletion(item);
      if (!problem) return;
      row.classList.add('xb-integrity-attention');
      const status = row.querySelector('.status');
      if (status?.parentElement) {
        const note = document.createElement('span');
        note.className = 'table-muted xb-integrity-row-note';
        note.textContent = numberValue(item.orderValue) <= 0 ? 'Corrigir valor do pedido' : 'Corrigir dados antes de concluir';
        status.parentElement.appendChild(note);
      }
    });
  }

  function patchCourierCards() {
    const cards = [...document.querySelectorAll('#courierGrid .courier-card')];
    cards.forEach((card, index) => {
      const person = db.couriers?.[index];
      if (!person) return;
      const payable = (db.deliveries || []).filter(item => item.courierId === person.id && finalStatuses.has(item.status));
      const totalFees = payable.reduce((sum, item) => sum + Math.round(numberValue(item.fee) * 100), 0) / 100;
      const rows = card.querySelectorAll('.courier-data');
      const countBlock = rows[0]?.children?.[1];
      const feeBlock = rows[1]?.children?.[0];
      if (countBlock) {
        const label = countBlock.querySelector('span');
        const value = countBlock.querySelector('strong');
        if (label) label.textContent = 'Entregas com taxa';
        if (value) value.textContent = String(payable.length);
      }
      if (feeBlock) {
        const label = feeBlock.querySelector('span');
        const value = feeBlock.querySelector('strong');
        if (label) label.textContent = 'Taxas a receber';
        if (value) value.textContent = money(totalFees);
      }
    });
  }

  function patchClosingButton() {
    const button = document.getElementById('closeDayBtn');
    if (!button || button.classList.contains('hidden')) return;
    const today = dayKey(new Date());
    const pending = (db.deliveries || []).filter(item => dayKey(item.createdAt) === today && (item.status === 'Aguardando' || item.status === 'Em rota'));
    button.disabled = pending.length > 0;
    button.title = pending.length ? `Existem ${pending.length} entrega(s) pendente(s). Conclua ou cancele antes de fechar.` : 'Finalizar e conferir o dia no banco';
  }

  function refreshVisible() {
    patchInvalidDeliveryRows();
    patchCourierCards();
    patchClosingButton();
    refreshAuditIndicator();
    if (typeof refreshIcons === 'function') refreshIcons();
  }

  document.addEventListener('click', event => {
    const button = event.target.closest?.('[data-delivery-action="advance"], [data-delivery-action="confirm-payment"], [data-delivery-action="complete-online"]');
    if (!button) return;
    const item = (db.deliveries || []).find(delivery => String(delivery.id) === String(button.dataset.id));
    if (!item || finalStatuses.has(item.status)) return;
    const problem = issueForCompletion(item);
    if (!problem) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (typeof toast === 'function') toast(`${problem} Edite o pedido #${String(item.code || '').padStart(3, '0')} e tente novamente.`, 'error');
  }, true);

  if (!document.getElementById('xbFinalIntegrityStyle')) {
    const style = document.createElement('style');
    style.id = 'xbFinalIntegrityStyle';
    style.textContent = `
      #deliveriesTable tbody tr.xb-integrity-attention{background:linear-gradient(90deg,rgba(255,247,230,.9),rgba(255,252,247,.72))!important}
      .xb-integrity-row-note{display:block!important;margin-top:5px!important;color:#9a6413!important;font-weight:800!important}
      #closeDayBtn:disabled{opacity:.58;cursor:not-allowed;filter:saturate(.65)}
    `;
    document.head.appendChild(style);
  }

  ['xb:cloud-ready', 'xb:cloud-pulled', 'xb:cloud-synced', 'xb:data-saved', 'xb:enhancements-ready'].forEach(name => {
    window.addEventListener(name, () => setTimeout(refreshVisible, 0));
  });
  document.addEventListener('change', () => setTimeout(refreshVisible, 0));
  document.addEventListener('click', () => setTimeout(refreshVisible, 0));
  requestAnimationFrame(refreshVisible);

  window.XBFinalIntegrity = Object.freeze({
    check: diagnostics,
    issueForCompletion,
    refresh: refreshVisible
  });
})();
