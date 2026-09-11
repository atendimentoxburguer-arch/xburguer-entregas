(() => {
  if (window.__xbPerformanceModeInstalled) return;
  window.__xbPerformanceModeInstalled = true;

  const cores = Number(navigator.hardwareConcurrency || 0);
  const memory = Number(navigator.deviceMemory || 0);
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
  const lowPower = reducedMotion || (cores > 0 && cores <= 4) || (memory > 0 && memory <= 4);

  document.documentElement.classList.toggle('xb-low-power', lowPower);

  if (!document.getElementById('xbPerformanceModeStyle')) {
    const style = document.createElement('style');
    style.id = 'xbPerformanceModeStyle';
    style.textContent = `
      html.xb-low-power{scroll-behavior:auto!important}
      html.xb-low-power body{text-rendering:optimizeSpeed}
      html.xb-low-power *,html.xb-low-power *::before,html.xb-low-power *::after{
        animation-duration:.01ms!important;animation-iteration-count:1!important;
        transition-duration:.04s!important;scroll-behavior:auto!important;
        will-change:auto!important
      }
      html.xb-low-power .brand-orbit{display:none!important}
      html.xb-low-power .xb-cloud-badge.connecting .xb-cloud-dot{animation:none!important}
      html.xb-low-power .login-brand,
      html.xb-low-power .hero,
      html.xb-low-power .card,
      html.xb-low-power .stat,
      html.xb-low-power .courier-card,
      html.xb-low-power .modal-card,
      html.xb-low-power .xb-confirm-card{box-shadow:0 2px 9px rgba(55,26,18,.045)!important}
      html.xb-low-power .xb-confirm-overlay,
      html.xb-low-power .drawer-backdrop{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
      html.xb-low-power .page:not(.active){content-visibility:hidden}
      html.xb-low-power .btn:hover,
      html.xb-low-power .icon-btn:hover,
      html.xb-low-power .payment-confirm-btn:hover,
      html.xb-low-power .courier-card:hover,
      html.xb-low-power .card:hover{transform:none!important}
      html.xb-low-power .progress span{transition:none!important}
      html.xb-low-power .table-wrap{scroll-behavior:auto!important}
    `;
    document.head.appendChild(style);
  }

  // Lucide percorre o DOM inteiro a cada createIcons(). Agrupa várias chamadas
  // no mesmo frame e só executa se realmente houver novos <i data-lucide>.
  if (typeof refreshIcons === 'function' && !window.__xbRefreshIconsOptimized) {
    window.__xbRefreshIconsOptimized = true;
    const refreshIconsNow = refreshIcons;
    let iconFrame = 0;
    refreshIcons = function xbScheduledIconRefresh() {
      if (iconFrame || document.hidden) return;
      if (!document.querySelector('i[data-lucide]')) return;
      iconFrame = requestAnimationFrame(() => {
        iconFrame = 0;
        if (document.hidden || !document.querySelector('i[data-lucide]')) return;
        refreshIconsNow();
      });
    };
  }

  // Atualiza somente a página visível. As demais telas são renderizadas quando
  // o usuário abre cada seção, reduzindo CPU, memória e manipulação de DOM.
  if (typeof renderAll === 'function' && !window.__xbRenderAllOptimized) {
    window.__xbRenderAllOptimized = true;
    let courierSignature = '';
    let todayKeyCache = '';
    let todayTextCache = '';

    const currentPage = () => {
      const id = document.querySelector('.page.active')?.id || 'page-dashboard';
      return id.replace(/^page-/, '');
    };

    function updateTodayLabel() {
      const label = document.getElementById('todayLabel');
      if (!label) return;
      const key = typeof dateKey === 'function' ? dateKey() : new Date().toDateString();
      if (key !== todayKeyCache) {
        todayKeyCache = key;
        todayTextCache = new Date().toLocaleDateString('pt-BR', {
          weekday: 'short', day: '2-digit', month: 'short', year: 'numeric'
        });
      }
      if (label.textContent !== todayTextCache) label.textContent = todayTextCache;
    }

    function updateCourierSelectsOnlyWhenNeeded() {
      const nextSignature = JSON.stringify((db.couriers || []).map(item => [item.id, item.name, item.active, Number(item.fee || 0)]));
      if (nextSignature === courierSignature) return;

      const deliverySelect = document.getElementById('deliveryCourier');
      const editSelect = document.getElementById('editDeliveryCourier');
      const deliveryValue = deliverySelect?.value || '';
      const editValue = editSelect?.value || '';

      renderSelects();
      courierSignature = nextSignature;

      if (deliverySelect && [...deliverySelect.options].some(option => option.value === deliveryValue)) {
        deliverySelect.value = deliveryValue;
      }
      if (editSelect && [...editSelect.options].some(option => option.value === editValue)) {
        editSelect.value = editValue;
      }
    }

    renderAll = function xbRenderVisiblePageOnly() {
      updateTodayLabel();
      updateCourierSelectsOnlyWhenNeeded();

      const page = currentPage();
      if (page === 'dashboard') renderDashboard();
      else if (page === 'deliveries') renderDeliveries();
      else if (page === 'couriers') renderCouriers();
      else if (page === 'closing') renderClosing();
      else if (page === 'reports') renderReports();
      else if (page === 'settings') renderSettings();
      else if (page === 'newDelivery') {
        const fee = document.getElementById('deliveryFee');
        if (fee && !fee.value) fee.value = Number(db.settings?.defaultFee || 0).toFixed(2);
        if (typeof syncPaymentFields === 'function') syncPaymentFields();
      }

      refreshIcons();
    };
  }

  // Em hardware fraco, a busca de entregas não reconstrói a tabela a cada tecla.
  // Aguarda uma pausa muito curta na digitação e então renderiza uma única vez.
  if (lowPower && !window.__xbDeliverySearchDebounced) {
    window.__xbDeliverySearchDebounced = true;
    let searchTimer = 0;
    document.addEventListener('input', event => {
      if (event.target?.id !== 'deliverySearch' || event.isComposing) return;
      event.stopPropagation();
      event.stopImmediatePropagation();
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        if (document.hidden) return;
        if (document.getElementById('page-deliveries')?.classList.contains('active') && typeof renderDeliveries === 'function') {
          renderDeliveries();
          refreshIcons();
        }
      }, 120);
    }, true);
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && typeof refreshIcons === 'function') refreshIcons();
  });

  const runWhenIdle = callback => {
    if (typeof requestIdleCallback === 'function') {
      return requestIdleCallback(callback, { timeout: 1200 });
    }
    return setTimeout(callback, 80);
  };

  window.XBPerformance = Object.freeze({
    lowPower,
    hardwareConcurrency: cores || null,
    deviceMemory: memory || null,
    runWhenIdle
  });
})();
