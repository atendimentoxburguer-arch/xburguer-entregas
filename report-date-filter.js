(() => {
  if (window.__xbReportDateFilterInstalled) return;
  window.__xbReportDateFilterInstalled = true;

  if (typeof reportItems !== 'function' || typeof renderReports !== 'function') return;

  const originalReportItems = reportItems;
  const renderReportsBeforeDateFilter = renderReports;
  let selectedDate = '';

  const numberValue = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const sum = (items, field) => (items || []).reduce((total, item) => total + numberValue(item[field]), 0);

  function formatDay(key) {
    const [year, month, day] = String(key || '').split('-').map(Number);
    if (!year || !month || !day) return key || '';
    return new Date(year, month - 1, day).toLocaleDateString('pt-BR', {
      weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric'
    });
  }

  function previousDayKey(key) {
    const [year, month, day] = String(key || '').split('-').map(Number);
    if (!year || !month || !day) return '';
    const value = new Date(year, month - 1, day);
    value.setDate(value.getDate() - 1);
    return dateKey(value);
  }

  function deliveredForDate(key) {
    if (!key) return [];
    return (db.deliveries || []).filter(item =>
      item.status === 'Entregue' && dateKey(new Date(item.createdAt)) === key
    );
  }

  function deltaLabel(current, previous) {
    if (!previous) {
      if (!current) return 'igual ao dia anterior';
      return 'sem base no dia anterior';
    }
    const value = ((current - previous) / previous) * 100;
    const rounded = Math.round(value * 10) / 10;
    if (!rounded) return 'igual ao dia anterior';
    return `${rounded > 0 ? '+' : ''}${rounded.toLocaleString('pt-BR')}%`;
  }

  function topPayment(items) {
    const map = new Map();
    (items || []).forEach(item => {
      const key = item.payment || 'Não informado';
      const row = map.get(key) || { name: key, count: 0, value: 0 };
      row.count += 1;
      row.value += numberValue(item.orderValue);
      map.set(key, row);
    });
    return [...map.values()].sort((a, b) => b.value - a.value)[0] || null;
  }

  function ensureControls() {
    const page = document.getElementById('page-reports');
    const head = page?.querySelector('.page-head');
    const range = document.getElementById('reportRange');
    if (!head || !range) return null;

    let bar = document.getElementById('reportPeriodControls');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'reportPeriodControls';
      bar.className = 'report-period-controls';
      range.insertAdjacentElement('beforebegin', bar);
      bar.appendChild(range);

      const specific = document.createElement('label');
      specific.className = 'report-date-control';
      specific.innerHTML = `
        <span>${icon('calendar-search')}Dia específico</span>
        <input type="date" id="reportSpecificDate" aria-label="Escolher um dia específico para o relatório">
      `;
      bar.appendChild(specific);

      const clear = document.createElement('button');
      clear.type = 'button';
      clear.id = 'reportDateClear';
      clear.className = 'btn btn-light btn-sm report-date-clear hidden';
      clear.innerHTML = `${icon('x')}Voltar ao período`;
      bar.appendChild(clear);

      const info = document.createElement('div');
      info.id = 'reportSelectedDateInfo';
      info.className = 'report-selected-date-info hidden';
      head.insertAdjacentElement('afterend', info);

      const input = document.getElementById('reportSpecificDate');
      if (input) {
        input.max = dateKey();
        input.addEventListener('change', () => {
          selectedDate = input.value || '';
          renderReports();
        });
      }

      clear.addEventListener('click', () => {
        selectedDate = '';
        if (input) input.value = '';
        renderReports();
      });

      // Se o usuário escolher novamente um período, o dia específico é desativado
      // antes do listener original do relatório executar.
      range.addEventListener('change', () => {
        if (!selectedDate) return;
        selectedDate = '';
        if (input) input.value = '';
        updateControls();
      }, true);
    }

    return bar;
  }

  function updateControls() {
    ensureControls();
    const range = document.getElementById('reportRange');
    const input = document.getElementById('reportSpecificDate');
    const clear = document.getElementById('reportDateClear');
    const info = document.getElementById('reportSelectedDateInfo');

    if (input) {
      input.max = dateKey();
      if (input.value !== selectedDate) input.value = selectedDate;
    }
    range?.classList.toggle('report-range-inactive', Boolean(selectedDate));
    clear?.classList.toggle('hidden', !selectedDate);

    if (info) {
      info.classList.toggle('hidden', !selectedDate);
      info.innerHTML = selectedDate
        ? `${icon('calendar-check')}<span>Exibindo somente as entregas concluídas de <b>${esc(formatDay(selectedDate))}</b>.</span>`
        : '';
    }
  }

  function renderSpecificDayInsights() {
    if (!selectedDate) return;
    const panel = document.getElementById('reportInsights');
    if (!panel) return;

    const current = deliveredForDate(selectedDate);
    const previousKey = previousDayKey(selectedDate);
    const previous = deliveredForDate(previousKey);
    const revenue = sum(current, 'orderValue');
    const previousRevenue = sum(previous, 'orderValue');
    const ticket = current.length ? revenue / current.length : 0;
    const previousTicket = previous.length ? previousRevenue / previous.length : 0;
    const payment = topPayment(current);

    panel.innerHTML = `
      <article>${icon('trending-up')}<div><span>Faturamento x dia anterior</span><strong>${deltaLabel(revenue, previousRevenue)}</strong><small>${money(revenue)} em ${esc(formatDay(selectedDate))} · ${money(previousRevenue)} no dia anterior</small></div></article>
      <article>${icon('receipt-text')}<div><span>Ticket médio x dia anterior</span><strong>${deltaLabel(ticket, previousTicket)}</strong><small>Ticket ${money(ticket)} · anterior ${money(previousTicket)}</small></div></article>
      <article>${icon('credit-card')}<div><span>Forma de pagamento líder</span><strong>${esc(payment?.name || 'Sem dados')}</strong><small>${payment ? `${money(payment.value)} · ${payment.count} pedido${payment.count === 1 ? '' : 's'}` : 'Nenhuma entrega concluída neste dia'}</small></div></article>
      <article>${icon('package-check')}<div><span>Entregas x dia anterior</span><strong>${current.length}</strong><small>${current.length} no dia escolhido · ${previous.length} no dia anterior</small></div></article>`;
  }

  reportItems = function xbReportItemsBySpecificDate() {
    if (selectedDate) return deliveredForDate(selectedDate);
    return originalReportItems();
  };

  renderReports = function xbReportsWithSpecificDate() {
    ensureControls();
    const result = renderReportsBeforeDateFilter();
    updateControls();
    renderSpecificDayInsights();
    refreshIcons();
    return result;
  };

  if (!document.getElementById('xbReportDateFilterStyle')) {
    const style = document.createElement('style');
    style.id = 'xbReportDateFilterStyle';
    style.textContent = `
      .report-period-controls{display:flex;align-items:center;justify-content:flex-end;gap:9px;flex-wrap:wrap}
      .report-date-control{display:flex;align-items:center;gap:8px;min-height:42px;padding:0 10px;border:1px solid #dfd3ca;border-radius:12px;background:linear-gradient(180deg,#fffdfb,#f8efe8);color:#645850;font-size:.76rem;font-weight:800}
      .report-date-control>span{display:flex;align-items:center;gap:6px;white-space:nowrap}
      .report-date-control svg{width:15px;height:15px;color:#9b0b15}
      .report-date-control input{border:0;background:transparent;color:#2a211e;font:inherit;font-weight:800;outline:none;min-width:132px;color-scheme:light}
      .report-date-clear{min-height:42px!important;white-space:nowrap}
      #reportRange.report-range-inactive{opacity:.62}
      .report-selected-date-info{display:flex;align-items:center;gap:9px;margin:-3px 0 18px;padding:10px 13px;border:1px solid #ead7b0;border-radius:12px;background:linear-gradient(135deg,#fff9ea,#fff2cf);color:#795811;font-size:.82rem;line-height:1.45}
      .report-selected-date-info.hidden{display:none!important}
      .report-selected-date-info svg{width:17px;height:17px;flex:0 0 auto}
      @media(max-width:760px){
        #page-reports .page-head{align-items:flex-start!important;flex-direction:column}
        .report-period-controls{width:100%;justify-content:flex-start}
        .report-period-controls .head-select{flex:1;min-width:150px}
        .report-date-control{flex:1;justify-content:space-between;min-width:220px}
      }
      @media(max-width:520px){
        .report-period-controls{display:grid;grid-template-columns:1fr;width:100%}
        .report-period-controls .head-select,.report-date-control,.report-date-clear{width:100%!important}
        .report-date-control input{flex:1;min-width:0}
      }
      html.xb-low-power .report-date-control,html.xb-low-power .report-selected-date-info{box-shadow:none!important}
    `;
    document.head.appendChild(style);
  }

  ensureControls();
  updateControls();
  if (document.getElementById('page-reports')?.classList.contains('active')) renderReports();

  window.XBReportDateFilter = Object.freeze({
    get selectedDate() { return selectedDate; },
    setDate(value) {
      selectedDate = String(value || '');
      renderReports();
    },
    clear() {
      selectedDate = '';
      renderReports();
    }
  });
})();
