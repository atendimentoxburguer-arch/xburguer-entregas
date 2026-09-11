(() => {
  if (window.__xbConfirmUIInstalled) return;
  window.__xbConfirmUIInstalled = true;

  const style = document.createElement('style');
  style.id = 'xb-confirm-ui-style';
  style.textContent = `
    .xb-confirm-overlay{position:fixed;inset:0;z-index:5000;display:grid;place-items:center;padding:24px;background:rgba(31,16,14,.56);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);opacity:0;visibility:hidden;pointer-events:none;transition:opacity .2s ease,visibility .2s ease}
    .xb-confirm-overlay.open{opacity:1;visibility:visible;pointer-events:auto}
    .xb-confirm-card{width:min(470px,100%);overflow:hidden;border:1px solid rgba(123,53,45,.10);border-radius:26px;background:linear-gradient(180deg,#fffefd 0%,#fffaf6 100%);box-shadow:0 34px 90px rgba(43,14,11,.28);transform:translateY(14px) scale(.97);opacity:0;transition:transform .22s cubic-bezier(.2,.8,.2,1),opacity .2s ease}
    .xb-confirm-overlay.open .xb-confirm-card{transform:translateY(0) scale(1);opacity:1}
    .xb-confirm-top{position:relative;padding:30px 30px 18px;text-align:center}
    .xb-confirm-close{position:absolute;right:18px;top:18px;width:38px;height:38px;display:grid;place-items:center;border:1px solid #eee2db;border-radius:12px;background:#fff;color:#756963;transition:.18s ease}
    .xb-confirm-close:hover{background:#f7efeb;color:#9f0710;transform:rotate(4deg)}
    .xb-confirm-close svg{width:18px;height:18px}
    .xb-confirm-icon-wrap{position:relative;width:82px;height:82px;margin:0 auto 20px;display:grid;place-items:center;border-radius:24px;background:linear-gradient(145deg,#fff0f1,#ffe2e5);color:#b20c17;box-shadow:0 16px 34px rgba(178,12,23,.14)}
    .xb-confirm-icon-wrap:before,.xb-confirm-icon-wrap:after{content:"";position:absolute;border-radius:28px;border:1px solid rgba(178,12,23,.10)}
    .xb-confirm-icon-wrap:before{inset:-7px}.xb-confirm-icon-wrap:after{inset:-14px;opacity:.55}
    .xb-confirm-icon-wrap svg{position:relative;z-index:1;width:34px;height:34px;stroke-width:2.2}
    .xb-confirm-card.warning .xb-confirm-icon-wrap{background:linear-gradient(145deg,#fff8e9,#ffefc8);color:#b66e09;box-shadow:0 16px 34px rgba(182,110,9,.14)}
    .xb-confirm-card.warning .xb-confirm-icon-wrap:before,.xb-confirm-card.warning .xb-confirm-icon-wrap:after{border-color:rgba(182,110,9,.12)}
    .xb-confirm-kicker{display:inline-flex;align-items:center;gap:7px;margin-bottom:10px;padding:7px 10px;border-radius:999px;background:#fff1f2;border:1px solid #f1d0d3;color:#940811;font-size:10px;font-weight:800;letter-spacing:1.25px;text-transform:uppercase}
    .xb-confirm-card.warning .xb-confirm-kicker{background:#fff7e8;border-color:#f1dfb8;color:#9a630d}
    .xb-confirm-title{margin:0;color:#211917;font-size:25px;line-height:1.18;font-weight:800;letter-spacing:-.65px}
    .xb-confirm-text{max-width:390px;margin:11px auto 0;color:#655b56;font-size:14px;line-height:1.65;font-weight:550}
    .xb-confirm-detail{margin:18px 30px 0;padding:14px 16px;border:1px solid #eee3dc;border-radius:15px;background:#fff;color:#4f4540;font-size:13px;line-height:1.55;font-weight:650;text-align:left}
    .xb-confirm-detail:empty{display:none}
    .xb-confirm-warning{display:flex;align-items:flex-start;gap:10px;margin:14px 30px 0;padding:12px 14px;border-radius:14px;background:#fff2f3;color:#8f1119;font-size:12px;line-height:1.5;font-weight:700;text-align:left}
    .xb-confirm-card.warning .xb-confirm-warning{background:#fff8e9;color:#86570c}
    .xb-confirm-warning svg{width:17px;height:17px;flex:0 0 auto;margin-top:1px}
    .xb-confirm-actions{display:grid;grid-template-columns:1fr 1.25fr;gap:11px;padding:24px 30px 30px}
    .xb-confirm-btn{min-height:48px;border-radius:13px;font-size:13px;font-weight:800;letter-spacing:-.1px;transition:.18s ease;display:flex;align-items:center;justify-content:center;gap:8px}
    .xb-confirm-btn svg{width:17px;height:17px}
    .xb-confirm-cancel{border:1px solid #e5d9d1;background:#fff;color:#5f5550}
    .xb-confirm-cancel:hover{background:#f8f2ee;border-color:#d9cbc2;transform:translateY(-1px)}
    .xb-confirm-primary{border:0;background:linear-gradient(90deg,#9e0710,#cf1823);color:#fff;box-shadow:0 12px 26px rgba(167,10,20,.20)}
    .xb-confirm-primary:hover{transform:translateY(-1px);box-shadow:0 16px 30px rgba(167,10,20,.27)}
    .xb-confirm-card.warning .xb-confirm-primary{background:linear-gradient(90deg,#b46b08,#dc8d18);box-shadow:0 12px 26px rgba(180,107,8,.18)}
    .xb-confirm-card.warning .xb-confirm-primary:hover{box-shadow:0 16px 30px rgba(180,107,8,.25)}
    @media (max-width:520px){
      .xb-confirm-overlay{padding:14px;align-items:end}
      .xb-confirm-card{border-radius:24px 24px 18px 18px}
      .xb-confirm-top{padding:28px 22px 16px}
      .xb-confirm-title{font-size:22px}
      .xb-confirm-detail,.xb-confirm-warning{margin-left:22px;margin-right:22px}
      .xb-confirm-actions{grid-template-columns:1fr;padding:20px 22px 24px}
      .xb-confirm-primary{order:-1}
    }
  `;
  document.head.appendChild(style);

  const overlay = document.createElement('div');
  overlay.className = 'xb-confirm-overlay';
  overlay.id = 'xbConfirmOverlay';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML = `
    <div class="xb-confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="xbConfirmTitle" aria-describedby="xbConfirmText">
      <div class="xb-confirm-top">
        <button type="button" class="xb-confirm-close" aria-label="Fechar"><i data-lucide="x"></i></button>
        <div class="xb-confirm-icon-wrap" id="xbConfirmIcon"><i data-lucide="trash-2"></i></div>
        <div class="xb-confirm-kicker" id="xbConfirmKicker">CONFIRMAÇÃO</div>
        <h2 class="xb-confirm-title" id="xbConfirmTitle">Confirmar ação?</h2>
        <p class="xb-confirm-text" id="xbConfirmText"></p>
      </div>
      <div class="xb-confirm-detail" id="xbConfirmDetail"></div>
      <div class="xb-confirm-warning"><i data-lucide="triangle-alert"></i><span id="xbConfirmWarning">Essa ação não pode ser desfeita.</span></div>
      <div class="xb-confirm-actions">
        <button type="button" class="xb-confirm-btn xb-confirm-cancel" id="xbConfirmCancel"><i data-lucide="arrow-left"></i><span>Voltar</span></button>
        <button type="button" class="xb-confirm-btn xb-confirm-primary" id="xbConfirmPrimary"><i data-lucide="trash-2"></i><span>Confirmar</span></button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const card = overlay.querySelector('.xb-confirm-card');
  const titleEl = document.getElementById('xbConfirmTitle');
  const textEl = document.getElementById('xbConfirmText');
  const detailEl = document.getElementById('xbConfirmDetail');
  const warningEl = document.getElementById('xbConfirmWarning');
  const kickerEl = document.getElementById('xbConfirmKicker');
  const iconEl = document.getElementById('xbConfirmIcon');
  const cancelBtn = document.getElementById('xbConfirmCancel');
  const primaryBtn = document.getElementById('xbConfirmPrimary');
  const closeBtn = overlay.querySelector('.xb-confirm-close');

  let resolver = null;
  let previousFocus = null;

  function redrawIcons() {
    if (window.lucide?.createIcons) window.lucide.createIcons({ attrs: { 'stroke-width': 2 } });
  }

  function closeConfirm(result) {
    if (!resolver) return;
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    const resolve = resolver;
    resolver = null;
    setTimeout(() => {
      if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
      previousFocus = null;
      resolve(result);
    }, 160);
  }

  function confirmAction({
    title,
    text,
    detail = '',
    warning = 'Essa ação não pode ser desfeita.',
    confirmText = 'Confirmar',
    cancelText = 'Voltar',
    icon = 'trash-2',
    kicker = 'CONFIRMAÇÃO DE SEGURANÇA',
    tone = 'danger'
  }) {
    if (resolver) closeConfirm(false);
    previousFocus = document.activeElement;
    card.classList.toggle('warning', tone === 'warning');
    titleEl.textContent = title || 'Confirmar ação?';
    textEl.textContent = text || '';
    detailEl.textContent = detail || '';
    warningEl.textContent = warning || '';
    kickerEl.textContent = kicker;
    iconEl.innerHTML = `<i data-lucide="${icon}"></i>`;
    primaryBtn.innerHTML = `<i data-lucide="${tone === 'warning' ? icon : 'trash-2'}"></i><span>${confirmText}</span>`;
    cancelBtn.querySelector('span').textContent = cancelText;
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    redrawIcons();
    setTimeout(() => primaryBtn.focus(), 30);
    return new Promise(resolve => { resolver = resolve; });
  }

  window.xbConfirm = confirmAction;

  cancelBtn.addEventListener('click', () => closeConfirm(false));
  closeBtn.addEventListener('click', () => closeConfirm(false));
  primaryBtn.addEventListener('click', () => closeConfirm(true));
  overlay.addEventListener('click', event => {
    if (event.target === overlay) closeConfirm(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && overlay.classList.contains('open')) {
      event.preventDefault();
      closeConfirm(false);
    }
  });

  function stopOriginal(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  document.addEventListener('click', async event => {
    const deliveryButton = event.target.closest('[data-delivery-action="delete"],[data-delivery-action="cancel"]');
    const courierButton = event.target.closest('[data-courier-action="delete"]');
    const clearButton = event.target.closest('#clearDataBtn');
    const reopenButton = event.target.closest('#reopenDayBtn');

    if (!deliveryButton && !courierButton && !clearButton && !reopenButton) return;
    stopOriginal(event);

    if (deliveryButton) {
      const item = db.deliveries.find(delivery => delivery.id === deliveryButton.dataset.id);
      if (!item) return;
      const code = String(item.code || '').padStart(3, '0');
      const client = item.client?.trim() || 'Cliente não informado';
      const isDelete = deliveryButton.dataset.deliveryAction === 'delete';

      if (isDelete) {
        const ok = await confirmAction({
          title: `Excluir entrega #${code}?`,
          text: 'A entrega será apagada definitivamente do histórico do sistema.',
          detail: `${client}${item.address ? ` • ${item.address}` : ''}`,
          warning: 'Depois de excluir, não será possível recuperar esta entrega.',
          confirmText: 'Sim, excluir',
          cancelText: 'Manter entrega',
          icon: 'trash-2'
        });
        if (!ok) return;
        db.deliveries = db.deliveries.filter(delivery => delivery.id !== item.id);
        save();
        toast('Entrega excluída.');
        renderAll();
        return;
      }

      const ok = await confirmAction({
        title: `Cancelar entrega #${code}?`,
        text: 'A entrega será marcada como cancelada, mas continuará disponível no histórico.',
        detail: `${client}${item.address ? ` • ${item.address}` : ''}`,
        warning: 'O pedido não será apagado; apenas ficará com status Cancelada.',
        confirmText: 'Cancelar entrega',
        cancelText: 'Voltar',
        icon: 'ban',
        kicker: 'CONFIRMAR CANCELAMENTO',
        tone: 'warning'
      });
      if (!ok) return;
      item.status = 'Cancelada';
      item.updatedAt = new Date().toISOString();
      save();
      toast('Entrega cancelada.');
      renderAll();
      return;
    }

    if (courierButton) {
      const id = courierButton.dataset.id;
      const person = db.couriers.find(item => item.id === id);
      if (!person) return;
      if (db.deliveries.some(item => item.courierId === id)) {
        toast('Esse entregador possui entregas. Marque como inativo em vez de excluir.', 'error');
        return;
      }
      const ok = await confirmAction({
        title: 'Excluir entregador?',
        text: 'O entregador será removido da equipe cadastrada no sistema.',
        detail: `${person.name}${person.phone ? ` • ${person.phone}` : ''}`,
        warning: 'Depois de excluir, será necessário cadastrá-lo novamente para recuperar o registro.',
        confirmText: 'Excluir entregador',
        cancelText: 'Manter entregador',
        icon: 'user-x'
      });
      if (!ok) return;
      db.couriers = db.couriers.filter(item => item.id !== id);
      save();
      toast('Entregador excluído.');
      renderAll();
      return;
    }

    if (clearButton) {
      const deliveriesCount = db.deliveries.length;
      const closingsCount = db.closings.length;
      if (!deliveriesCount && !closingsCount) {
        toast('Não há entregas ou fechamentos para apagar.', 'error');
        return;
      }
      const ok = await confirmAction({
        title: 'Apagar dados operacionais?',
        text: 'Todas as entregas e todos os fechamentos serão removidos de uma vez.',
        detail: `${deliveriesCount} entrega${deliveriesCount === 1 ? '' : 's'} • ${closingsCount} fechamento${closingsCount === 1 ? '' : 's'}`,
        warning: 'Essa é uma exclusão permanente. Faça um backup antes se quiser preservar esses dados.',
        confirmText: 'Apagar tudo',
        cancelText: 'Não apagar',
        icon: 'database-zap',
        kicker: 'ATENÇÃO • EXCLUSÃO EM MASSA'
      });
      if (!ok) return;
      db.deliveries = [];
      db.closings = [];
      save();
      toast('Entregas e fechamentos apagados.');
      renderAll();
      return;
    }

    if (reopenButton) {
      const today = dateKey();
      if (!db.closings.some(item => item.date === today)) return;
      const ok = await confirmAction({
        title: 'Reabrir o fechamento de hoje?',
        text: 'O registro de fechamento de hoje será removido e o dia voltará a ficar aberto para ajustes.',
        detail: 'As entregas cadastradas continuarão no sistema normalmente.',
        warning: 'Somente o fechamento será desfeito; os pedidos não serão apagados.',
        confirmText: 'Reabrir dia',
        cancelText: 'Manter fechado',
        icon: 'rotate-ccw',
        kicker: 'CONFIRMAR REABERTURA',
        tone: 'warning'
      });
      if (!ok) return;
      db.closings = db.closings.filter(item => item.date !== today);
      save();
      toast('Fechamento reaberto.');
      renderClosing();
      if (typeof refreshIcons === 'function') refreshIcons();
    }
  }, true);

  redrawIcons();
})();
