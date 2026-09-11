(() => {
  if (window.__xbChangeCalculatorInstalled) return;
  window.__xbChangeCalculatorInstalled = true;

  function parseValue(value) {
    if (window.XBCurrency?.parse) {
      const parsed = window.XBCurrency.parse(value);
      return parsed === null ? null : Number(parsed);
    }

    let text = String(value ?? '').trim();
    if (!text) return null;
    text = text.replace(/\s+/g, '').replace(/^R\$/i, '').replace(/[^0-9.,]/g, '');
    if (!text) return null;

    const comma = text.lastIndexOf(',');
    const dot = text.lastIndexOf('.');
    if (comma >= 0 && dot >= 0) {
      text = comma > dot ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
    } else if (comma >= 0) {
      text = text.replace(/\./g, '').replace(',', '.');
    }

    const number = Number(text);
    return Number.isFinite(number) ? number : null;
  }

  function changeDue(orderValue, changeFor) {
    const order = parseValue(orderValue);
    const paid = parseValue(changeFor);
    if (order === null || paid === null) return null;
    return paid - order;
  }

  function previewFor(fieldId, valueId, changeId, paymentResolver) {
    const field = document.getElementById(fieldId);
    if (!field) return null;

    let box = field.querySelector('.xb-change-preview');
    if (!box) {
      box = document.createElement('div');
      box.className = 'xb-change-preview hidden';
      box.setAttribute('role', 'status');
      box.setAttribute('aria-live', 'polite');
      field.appendChild(box);
    }

    const payment = paymentResolver();
    const orderInput = document.getElementById(valueId);
    const changeInput = document.getElementById(changeId);
    const order = parseValue(orderInput?.value);
    const changeFor = parseValue(changeInput?.value);

    if (payment !== 'Dinheiro' || changeFor === null || !String(changeInput?.value || '').trim()) {
      box.className = 'xb-change-preview hidden';
      box.innerHTML = '';
      return null;
    }

    if (order === null || order <= 0) {
      box.className = 'xb-change-preview neutral';
      box.innerHTML = `<span>${icon('calculator')}</span><div><small>Troco para o entregador</small><strong>Informe primeiro o valor do pedido</strong></div>`;
      refreshIcons();
      return null;
    }

    const due = changeFor - order;
    if (due < 0) {
      box.className = 'xb-change-preview invalid';
      box.innerHTML = `<span>${icon('triangle-alert')}</span><div><small>Valor inválido</small><strong>O troco para precisa ser maior ou igual a ${money(order)}</strong></div>`;
      refreshIcons();
      return due;
    }

    box.className = `xb-change-preview ${due > 0 ? 'ready' : 'zero'}`;
    box.innerHTML = due > 0
      ? `<span>${icon('banknote')}</span><div><small>Troco que precisa ir com o entregador</small><strong>${money(due)}</strong><em>Pedido ${money(order)} · cliente paga com ${money(changeFor)}</em></div>`
      : `<span>${icon('circle-check')}</span><div><small>Troco para o entregador</small><strong>Não precisa levar troco</strong><em>O cliente vai pagar o valor exato.</em></div>`;
    refreshIcons();
    return due;
  }

  function updateNewPreview() {
    return previewFor(
      'changeField',
      'deliveryValue',
      'deliveryChange',
      () => document.querySelector('input[name="payment"]:checked')?.value || 'Dinheiro'
    );
  }

  function updateEditPreview() {
    return previewFor(
      'editChangeField',
      'editDeliveryValue',
      'editDeliveryChange',
      () => document.getElementById('editDeliveryPayment')?.value || 'Dinheiro'
    );
  }

  const previousPaymentHTML = paymentHTML;
  paymentHTML = function xbPaymentWithChangeDue(item) {
    const base = previousPaymentHTML(item);
    if (item?.payment !== 'Dinheiro') return base;

    const changeFor = getChangeFor(item);
    if (changeFor === '' || changeFor === null || changeFor === undefined) return base;

    const due = changeDue(item.orderValue, changeFor);
    if (due === null || due < 0) return base;

    return `${base}<span class="table-muted xb-change-due">Troco a levar: <b>${money(due)}</b></span>`;
  };

  document.addEventListener('input', event => {
    const id = event.target?.id;
    if (id === 'deliveryValue' || id === 'deliveryChange') updateNewPreview();
    if (id === 'editDeliveryValue' || id === 'editDeliveryChange') updateEditPreview();
  });

  document.addEventListener('change', event => {
    const id = event.target?.id;
    if (event.target?.matches?.('input[name="payment"]') || id === 'deliveryValue' || id === 'deliveryChange') {
      requestAnimationFrame(updateNewPreview);
    }
    if (id === 'editDeliveryPayment' || id === 'editDeliveryValue' || id === 'editDeliveryChange') {
      requestAnimationFrame(updateEditPreview);
    }
  });

  if (typeof openDeliveryEditor === 'function') {
    const previousOpenDeliveryEditor = openDeliveryEditor;
    openDeliveryEditor = function xbOpenDeliveryEditorWithChange(...args) {
      const result = previousOpenDeliveryEditor.apply(this, args);
      requestAnimationFrame(updateEditPreview);
      return result;
    };
  }

  document.getElementById('deliveryForm')?.addEventListener('reset', () => {
    requestAnimationFrame(updateNewPreview);
  });

  if (!document.getElementById('xbChangeCalculatorStyle')) {
    const style = document.createElement('style');
    style.id = 'xbChangeCalculatorStyle';
    style.textContent = `
      .xb-change-preview{margin-top:10px;padding:11px 12px;border-radius:12px;display:flex;align-items:flex-start;gap:10px;border:1px solid #ddd2ca;background:#faf6f2;color:#4f4540}
      .xb-change-preview.hidden{display:none!important}
      .xb-change-preview>span{width:32px;height:32px;border-radius:10px;display:grid;place-items:center;flex:0 0 auto;background:#fff;border:1px solid currentColor}
      .xb-change-preview>span svg{width:16px;height:16px}
      .xb-change-preview>div{min-width:0;display:flex;flex-direction:column;gap:2px}
      .xb-change-preview small{font-size:.73rem;font-weight:800;text-transform:uppercase;letter-spacing:.025em;opacity:.78}
      .xb-change-preview strong{font-size:1rem;line-height:1.25}
      .xb-change-preview em{font-size:.76rem;font-style:normal;opacity:.78;line-height:1.35}
      .xb-change-preview.ready{border-color:#bfe1cd;background:linear-gradient(135deg,#effaf3,#e6f6ed);color:#126d45}
      .xb-change-preview.zero{border-color:#d8dfc2;background:linear-gradient(135deg,#f8faef,#f1f5df);color:#5b6b1d}
      .xb-change-preview.invalid{border-color:#efc8cb;background:linear-gradient(135deg,#fff4f4,#fce8e9);color:#9b2029}
      .xb-change-preview.neutral{border-color:#e2d7ce;background:linear-gradient(135deg,#fffaf6,#f5eee8);color:#6e5d54}
      .xb-change-due{display:block!important;margin-top:3px;color:#0f7448!important;font-weight:800!important}
      .xb-change-due b{font-weight:900}
      html.xb-low-power .xb-change-preview{background:#f7f3ef!important;box-shadow:none!important}
    `;
    document.head.appendChild(style);
  }

  updateNewPreview();
  updateEditPreview();

  window.XBChangeCalculator = Object.freeze({
    calculate: changeDue,
    refresh: () => {
      updateNewPreview();
      updateEditPreview();
    }
  });
})();
