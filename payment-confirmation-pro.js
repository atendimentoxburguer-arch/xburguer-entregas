(() => {
  if (window.__xbPaymentConfirmationProInstalled) return;
  window.__xbPaymentConfirmationProInstalled = true;

  const valueOf = value => Number.isFinite(Number(value)) ? Number(value) : 0;

  window.addEventListener('click', async event => {
    const button = event.target.closest?.('[data-delivery-action="confirm-payment"]');
    if (!button) return;

    // Intercepta antes do fluxo antigo para exigir uma conferência explícita.
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const item = db.deliveries.find(delivery => delivery.id === button.dataset.id);
    if (!item || item.status === 'Entregue' || item.status === 'Cancelada') return;

    const orderValue = valueOf(item.orderValue);
    const changeFor = getChangeFor(item) ? valueOf(getChangeFor(item)) : 0;
    const changeDue = item.payment === 'Dinheiro' && changeFor >= orderValue ? changeFor - orderValue : 0;
    const person = courier(item.courierId);

    if (orderValue <= 0) {
      toast('Este pedido está sem valor. Edite a entrega antes de conferir o pagamento.', 'error');
      return;
    }

    if (item.payment === 'Dinheiro' && changeFor && changeFor < orderValue) {
      toast('O valor informado para troco é menor que o valor do pedido. Corrija antes de conferir.', 'error');
      return;
    }

    const detailParts = [
      `Pedido #${String(item.code || '').padStart(3, '0')}`,
      item.client?.trim() || 'Cliente não informado',
      item.payment || 'Pagamento não informado',
      money(orderValue)
    ];
    if (person?.name) detailParts.push(person.name);
    if (item.payment === 'Dinheiro' && changeFor) {
      detailParts.push(`Troco para ${money(changeFor)}`);
      detailParts.push(`Levar ${money(changeDue)} de troco`);
    }

    const warning = person
      ? (item.payment === 'Dinheiro' && changeFor
          ? `Separe ${money(changeDue)} de troco para o entregador. Depois de confirmar, o pedido será marcado como entregue e entrará no fechamento do dia.`
          : 'Depois de confirmar, o pedido será marcado como entregue e entrará no fechamento do dia.')
      : 'Atenção: este pedido está sem entregador definido. Ele será entregue e ficará separado no fechamento por entregador.';

    const ok = typeof window.xbConfirm === 'function'
      ? await window.xbConfirm({
          title: 'Conferir este pagamento?',
          text: 'Revise a forma de pagamento e o valor antes de concluir o pedido.',
          detail: detailParts.join(' • '),
          warning,
          confirmText: 'Pagamento conferido',
          cancelText: 'Voltar e revisar',
          icon: 'badge-check',
          kicker: 'CONFERÊNCIA DE PAGAMENTO',
          tone: 'warning'
        })
      : window.confirm(`${detailParts.join(' • ')}\n\nConfirmar pagamento e marcar como entregue?`);

    if (!ok) return;

    item.status = 'Entregue';
    item.paymentConfirmedAt = new Date().toISOString();
    item.updatedAt = new Date().toISOString();
    save();
    toast(`Pagamento conferido. Entrega #${String(item.code).padStart(3, '0')} concluída.`);
    renderAll();
  }, true);
})();
