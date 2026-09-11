(() => {
  if (window.__xbClosingSummaryInstalled) return;
  window.__xbClosingSummaryInstalled = true;

  const PAYMENT_METHODS = ['Dinheiro', 'PIX', 'Cartão', 'Pago online'];

  function countLabel(count) {
    return `${count} entrega${count === 1 ? '' : 's'}`;
  }

  function buildLiveClosingDetails() {
    const today = todayDeliveries();
    const done = delivered(today);
    const pending = today.filter(item => ['Aguardando', 'Em rota'].includes(item.status));
    const totalOrderValue = done.reduce((sum, item) => sum + Number(item.orderValue || 0), 0);
    const totalFees = done.reduce((sum, item) => sum + Number(item.fee || 0), 0);

    const payments = PAYMENT_METHODS.map(name => {
      const items = done.filter(item => item.payment === name);
      return {
        name,
        count: items.length,
        value: items.reduce((sum, item) => sum + Number(item.orderValue || 0), 0)
      };
    });

    const couriers = db.couriers.map(item => {
      const items = done.filter(delivery => delivery.courierId === item.id);
      return {
        id: item.id,
        name: item.name,
        count: items.length,
        fees: items.reduce((sum, delivery) => sum + Number(delivery.fee || 0), 0)
      };
    });

    const withoutCourier = done.filter(item => !item.courierId);
    if (withoutCourier.length) {
      couriers.push({
        id: '__without_courier__',
        name: 'Sem entregador definido',
        count: withoutCourier.length,
        fees: withoutCourier.reduce((sum, delivery) => sum + Number(delivery.fee || 0), 0)
      });
    }

    return {
      totalDeliveries: done.length,
      totalOrderValue,
      totalFees,
      pending: pending.length,
      payments,
      couriers
    };
  }

  function normalizedSnapshot(closing) {
    const details = closing?.detailsV2;
    if (!details || !Array.isArray(details.payments) || !Array.isArray(details.couriers)) return null;
    return {
      totalDeliveries: Number(details.totalDeliveries || 0),
      totalOrderValue: Number(details.totalOrderValue || 0),
      totalFees: Number(details.totalFees || 0),
      pending: Number(details.pending || 0),
      payments: PAYMENT_METHODS.map(name => {
        const row = details.payments.find(item => item.name === name) || {};
        return { name, count: Number(row.count || 0), value: Number(row.value || 0) };
      }),
      couriers: details.couriers.map(item => ({
        id: item.id || '',
        name: item.name || 'Entregador',
        count: Number(item.count || 0),
        fees: Number(item.fees || 0)
      }))
    };
  }

  function currentClosingDetails() {
    const closing = db.closings.find(item => item.date === dateKey());
    return normalizedSnapshot(closing) || buildLiveClosingDetails();
  }

  function ensureClosingStyles() {
    if (document.getElementById('xbClosingSummaryStyles')) return;
    const style = document.createElement('style');
    style.id = 'xbClosingSummaryStyles';
    style.textContent = `
      .closing-detail-list{display:grid;gap:10px}
      .closing-detail-row{
        display:grid;grid-template-columns:minmax(0,1fr) auto;gap:16px;align-items:center;
        padding:14px 15px;border:1px solid #eadfd7;border-radius:15px;
        background:linear-gradient(135deg,rgba(255,255,255,.96),rgba(249,242,236,.88));
        box-shadow:0 7px 18px rgba(64,31,21,.035)
      }
      .closing-detail-row:nth-child(even){background:linear-gradient(135deg,rgba(255,255,255,.96),rgba(255,247,235,.9))}
      .closing-detail-main{min-width:0;display:flex;flex-direction:column;gap:7px}
      .closing-detail-main .payment-inline{font-weight:800;color:#231b18}
      .closing-detail-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .closing-count-badge{
        display:inline-flex;align-items:center;width:max-content;padding:5px 9px;border-radius:999px;
        background:#fff0f1;border:1px solid #f0d1d4;color:#920811;font-size:.8rem;font-weight:800
      }
      .closing-detail-value{text-align:right;display:flex;flex-direction:column;gap:3px}
      .closing-detail-value strong{font-size:1.05rem;color:#201917;font-weight:800}
      .closing-detail-value small{color:#6b615b;font-size:.78rem;font-weight:700}
      .closing-courier-name{display:flex;align-items:center;gap:9px;font-weight:800;color:#211916}
      .closing-courier-icon{
        width:31px;height:31px;border-radius:10px;display:grid;place-items:center;flex:0 0 auto;
        color:#a80712;background:linear-gradient(145deg,#fff0f1,#ffe8e9);border:1px solid #f0d3d6
      }
      .closing-courier-icon svg{width:16px;height:16px}
      .closing-total-line{margin-top:2px;padding:14px 15px!important;border-radius:14px!important}
      @media(max-width:650px){
        .closing-detail-row{grid-template-columns:1fr;gap:10px}
        .closing-detail-value{text-align:left;flex-direction:row;align-items:baseline;gap:8px}
      }
    `;
    document.head.appendChild(style);
  }

  function updateClosingCardCopy() {
    const paymentsCard = document.getElementById('closingPayments')?.closest('.card');
    const couriersCard = document.getElementById('closingCouriers')?.closest('.card');
    if (paymentsCard) {
      const title = paymentsCard.querySelector('.card-head h3');
      const subtitle = paymentsCard.querySelector('.card-head p');
      if (title) title.textContent = 'Formas de pagamento';
      if (subtitle) subtitle.textContent = 'Quantidade e valor de cada forma de pagamento';
    }
    if (couriersCard) {
      const title = couriersCard.querySelector('.card-head h3');
      const subtitle = couriersCard.querySelector('.card-head p');
      if (title) title.textContent = 'Entregadores';
      if (subtitle) subtitle.textContent = 'Quantidade de entregas e total de taxas por entregador';
    }
  }

  function renderClosingDetails() {
    const data = currentClosingDetails();

    document.getElementById('closingStats').innerHTML =
      stat('package-check', 'blue', data.totalDeliveries, 'Entregas concluídas', 'Hoje') +
      stat('banknote', 'green', money(data.totalOrderValue), 'Valor total', 'Pedidos') +
      stat('coins', 'red', money(data.totalFees), 'Total em taxas', 'Entregadores') +
      stat('clock-3', 'orange', data.pending, 'Pendentes', 'Hoje');

    const payments = document.getElementById('closingPayments');
    if (payments) {
      payments.innerHTML = `<div class="closing-detail-list">${data.payments.map(row => {
        const percent = data.totalOrderValue ? Math.round(row.value / data.totalOrderValue * 100) : 0;
        return `<div class="closing-detail-row">
          <div class="closing-detail-main">
            <span class="payment-inline">${icon(paymentIcon(row.name))}<span>${esc(row.name)}</span></span>
            <div class="closing-detail-meta"><span class="closing-count-badge">${countLabel(row.count)}</span></div>
          </div>
          <div class="closing-detail-value"><strong>${money(row.value)}</strong><small>${percent}% do valor total</small></div>
        </div>`;
      }).join('')}</div><div class="summary-row total closing-total-line"><span>Total · ${countLabel(data.totalDeliveries)}</span><b>${money(data.totalOrderValue)}</b></div>`;
    }

    const couriers = document.getElementById('closingCouriers');
    if (couriers) {
      couriers.innerHTML = data.couriers.length ? `<div class="closing-detail-list">${data.couriers.map(row => `
        <div class="closing-detail-row">
          <div class="closing-detail-main">
            <span class="closing-courier-name"><span class="closing-courier-icon">${icon('bike')}</span><span>${esc(row.name)}</span></span>
            <div class="closing-detail-meta"><span class="closing-count-badge">${countLabel(row.count)}</span></div>
          </div>
          <div class="closing-detail-value"><strong>${money(row.fees)}</strong><small>Total de taxas</small></div>
        </div>`).join('')}</div><div class="summary-row total closing-total-line"><span>Total de taxas</span><b>${money(data.totalFees)}</b></div>` : empty('Nenhum entregador', 'Cadastre entregadores para acompanhar as taxas do dia.', 'bike');
    }

    updateClosingCardCopy();
    refreshIcons();
  }

  const originalRenderClosing = renderClosing;
  renderClosing = function xbDetailedRenderClosing() {
    originalRenderClosing();
    renderClosingDetails();
  };

  document.getElementById('closeDayBtn')?.addEventListener('click', () => {
    setTimeout(() => {
      const closing = db.closings.find(item => item.date === dateKey());
      if (!closing) return;
      closing.detailsV2 = buildLiveClosingDetails();
      save();
      renderClosing();
    }, 0);
  });

  ensureClosingStyles();
  renderClosing();
})();
