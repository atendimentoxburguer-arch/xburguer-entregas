(() => {
  if (window.__xbPaymentConfirmationProInstalled) return;
  window.__xbPaymentConfirmationProInstalled = true;

  const valueOf = value => Number.isFinite(Number(value)) ? Number(value) : 0;

  function completionProblem(item) {
    if (!item) return 'Pedido não encontrado.';
    if (valueOf(item.orderValue) <= 0) return 'Este pedido está sem valor. Edite a entrega antes de conferir o pagamento.';
    if (!String(item.address || '').trim()) return 'Este pedido está sem endereço. Edite a entrega antes de conferir o pagamento.';
    if (!item.courierId) return 'Selecione um entregador antes de concluir esta entrega.';
    if (valueOf(item.fee) < 0) return 'A taxa de entrega não pode ser negativa.';
    const changeFor = getChangeFor(item) ? valueOf(getChangeFor(item)) : 0;
    if (item.payment === 'Dinheiro' && changeFor && changeFor < valueOf(item.orderValue)) {
      return 'O valor informado para troco é menor que o valor do pedido. Corrija antes de conferir.';
    }
    return '';
  }

  window.addEventListener('click', async event => {
    const button = event.target.closest?.('[data-delivery-action="confirm-payment"]');
    if (!button) return;

    // Intercepta antes do fluxo antigo para exigir uma conferência explícita.
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const item = db.deliveries.find(delivery => delivery.id === button.dataset.id);
    if (!item || item.status === 'Entregue' || item.status === 'Cancelada') return;

    const problem = completionProblem(item);
    if (problem) {
      toast(problem, 'error');
      return;
    }

    const orderValue = valueOf(item.orderValue);
    const changeFor = getChangeFor(item) ? valueOf(getChangeFor(item)) : 0;
    const changeDue = item.payment === 'Dinheiro' && changeFor >= orderValue ? changeFor - orderValue : 0;
    const person = courier(item.courierId);

    const detailParts = [
      `Pedido #${String(item.code || '').padStart(3, '0')}`,
      item.client?.trim() || 'Cliente não informado',
      item.payment || 'Pagamento não informado',
      money(orderValue),
      person?.name || 'Entregador não informado'
    ];
    if (item.payment === 'Dinheiro' && changeFor) {
      detailParts.push(`Troco para ${money(changeFor)}`);
      detailParts.push(`Levar ${money(changeDue)} de troco`);
    }

    const warning = item.payment === 'Dinheiro' && changeFor
      ? `Separe ${money(changeDue)} de troco para o entregador. Depois de confirmar, o pedido será marcado como entregue e entrará no fechamento do dia.`
      : 'Depois de confirmar, o pedido será marcado como entregue e entrará no fechamento do dia.';

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

    // Confere de novo após a confirmação visual para evitar concluir um registro
    // alterado por outro aparelho enquanto a janela estava aberta.
    const latest = db.deliveries.find(delivery => delivery.id === button.dataset.id);
    const latestProblem = completionProblem(latest);
    if (!latest || latestProblem) {
      toast(latestProblem || 'O pedido foi alterado. Atualize a tela e confira novamente.', 'error');
      return;
    }

    latest.status = 'Entregue';
    latest.paymentConfirmedAt = new Date().toISOString();
    latest.updatedAt = new Date().toISOString();
    save();
    toast(`Pagamento conferido. Entrega #${String(latest.code).padStart(3, '0')} concluída.`);
    renderAll();
  }, true);

  window.XBPaymentConfirmation = Object.freeze({ completionProblem });
})();
