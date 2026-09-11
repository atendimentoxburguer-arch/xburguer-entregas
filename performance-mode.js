(() => {
  if (window.__xbPerformanceModeInstalled) return;
  window.__xbPerformanceModeInstalled = true;

  const cores = Number(navigator.hardwareConcurrency || 0);
  const memory = Number(navigator.deviceMemory || 0);
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
  const lowPower = reducedMotion || (cores > 0 && cores <= 4) || (memory > 0 && memory <= 4);

  document.documentElement.classList.toggle('xb-low-power', lowPower);

  // Em computadores mais simples, reduz efeitos visuais caros para a GPU/CPU,
  // sem alterar as funções do sistema.
  if (!document.getElementById('xbPerformanceModeStyle')) {
    const style = document.createElement('style');
    style.id = 'xbPerformanceModeStyle';
    style.textContent = `
      html.xb-low-power *,html.xb-low-power *::before,html.xb-low-power *::after{
        animation-duration:.01ms!important;animation-iteration-count:1!important;
        transition-duration:.06s!important;scroll-behavior:auto!important
      }
      html.xb-low-power .brand-orbit,
      html.xb-low-power .xb-cloud-badge.connecting .xb-cloud-dot{animation:none!important}
      html.xb-low-power .login-brand,
      html.xb-low-power .hero,
      html.xb-low-power .card,
      html.xb-low-power .stat,
      html.xb-low-power .courier-card,
      html.xb-low-power .modal-card,
      html.xb-low-power .xb-confirm-card{box-shadow:0 3px 12px rgba(55,26,18,.055)!important}
      html.xb-low-power .xb-confirm-overlay,
      html.xb-low-power .drawer-backdrop{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
      html.xb-low-power .page:not(.active){content-visibility:hidden}
    `;
    document.head.appendChild(style);
  }

  // Vários módulos pedem atualização dos ícones na mesma operação. No modo
  // anterior, o DOM inteiro podia ser percorrido repetidas vezes no mesmo frame.
  // Esta fila consolida todas as chamadas em uma única atualização visual.
  if (typeof refreshIcons === 'function' && !window.__xbRefreshIconsOptimized) {
    window.__xbRefreshIconsOptimized = true;
    const refreshIconsNow = refreshIcons;
    let iconFrame = 0;
    refreshIcons = function xbScheduledIconRefresh() {
      if (iconFrame) return;
      iconFrame = requestAnimationFrame(() => {
        iconFrame = 0;
        if (document.hidden) return;
        refreshIconsNow();
      });
    };
  }

  // renderAll() antigo reconstruía Dashboard, Entregas, Entregadores,
  // Fechamento, Relatórios e Configurações a cada pequena alteração, mesmo que
  // cinco dessas telas estivessem invisíveis. Em notebook fraco isso é o maior
  // custo de CPU. A versão abaixo atualiza somente a tela que está aberta.
  if (typeof renderAll === 'function' && !window.__xbRenderAllOptimized) {
    window.__xbRenderAllOptimized = true;
    let courierSignature = '';

    const currentPage = () => {
      const id = document.querySelector('.page.active')?.id || 'page-dashboard';
      return id.replace(/^page-/, '');
    };

    function updateTodayLabel() {
      const label = document.getElementById('todayLabel');
      if (!label) return;
      const text = new Date().toLocaleDateString('pt-BR', {
        weekday: 'short', day: '2-digit', month: 'short', year: 'numeric'
      });
      if (label.textContent !== text) label.textContent = text;
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

  // Quando a aba fica em segundo plano, nenhum trabalho visual precisa rodar.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && typeof refreshIcons === 'function') refreshIcons();
  });

  window.XBPerformance = Object.freeze({
    lowPower,
    hardwareConcurrency: cores || null,
    deviceMemory: memory || null
  });
})();
