(() => {
  if (window.__xbTicketAverageInstalled) return;
  window.__xbTicketAverageInstalled = true;

  function deliveredAverage(items) {
    const done = (items || []).filter(item => item.status === 'Entregue');
    if (!done.length) return 0;
    if (window.XBMetrics?.averageMoney) return window.XBMetrics.averageMoney(done, 'orderValue');
    const cents = done.reduce((sum, item) => sum + Math.round(Number(item.orderValue || 0) * 100), 0);
    return Math.round(cents / done.length) / 100;
  }

  function appendTicketStat(containerId, value, detail) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.insertAdjacentHTML('beforeend', stat('receipt-text', 'purple', money(value), 'Ticket médio', detail));
  }

  const previousRenderDashboard = renderDashboard;
  renderDashboard = function xbRenderDashboardWithAverage() {
    previousRenderDashboard();
    appendTicketStat('dashboardStats', deliveredAverage(todayDeliveries()), 'Hoje');
    refreshIcons();
  };

  const previousRenderClosing = renderClosing;
  renderClosing = function xbRenderClosingWithAverage() {
    previousRenderClosing();
    appendTicketStat('closingStats', deliveredAverage(todayDeliveries()), 'Pedidos entregues');
    refreshIcons();
  };

  // Atualiza imediatamente quando o complemento é carregado depois do núcleo do sistema.
  renderDashboard();
  renderClosing();
})();
