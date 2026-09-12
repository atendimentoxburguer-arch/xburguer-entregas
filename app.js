(() => {
  const version = '20260912-date1';

  const loadScript = (src, ordered = true) => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = !ordered;
    script.onload = () => resolve(src);
    script.onerror = () => reject(new Error(`Falha ao carregar ${src}`));
    document.body.appendChild(script);
  });

  // Insere todos os scripts imediatamente para que o navegador baixe em paralelo.
  // async=false mantém a ordem de execução, preservando as dependências existentes.
  async function loadOrderedGroup(files, label = 'módulo') {
    const results = await Promise.allSettled(
      files.map(file => loadScript(`./${file}?v=${version}`, true))
    );
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.error(`[X-Burguer] Não foi possível carregar ${label} ${files[index]}:`, result.reason);
      }
    });
    return results.every(result => result.status === 'fulfilled');
  }

  // PWA não bloqueia o carregamento do painel.
  loadScript(`./pwa-app.js?v=${version}`, false).catch(error => {
    console.error('[X-Burguer] Não foi possível ativar o modo aplicativo:', error);
  });

  const waitForIdle = () => new Promise(resolve => {
    const runner = window.XBPerformance?.runWhenIdle;
    if (typeof runner === 'function') {
      runner(() => resolve());
      return;
    }
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => resolve(), { timeout: 1200 });
      return;
    }
    setTimeout(resolve, 80);
  });

  async function startSystem() {
    const coreReady = await loadOrderedGroup([
      'supabase-config.js',
      'app-core.js',
      // Remove imediatamente credenciais e dados de demonstração legados.
      'core-safety.js'
    ], 'núcleo');

    if (!coreReady) {
      console.error('[X-Burguer] Falha crítica ao carregar o núcleo do sistema.');
      return;
    }

    // Recursos indispensáveis entram primeiro. O modo de desempenho é ativado
    // cedo para que os módulos seguintes já inicializem com menos renderizações.
    const essential = [
      'cloud-auth-guard.js',
      'database-prep.js',
      'performance-mode.js',
      'confirm-ui.js',
      'system-production-v2.js',
      'system-update.js',
      'closing-summary.js',
      'system-audit.js',
      // Validação central antes das regras operacionais e da sincronização.
      'system-integrity-v3.js',
      'simple-payment-flow.js',
      'delivery-edit-plus.js',
      'payment-confirmation-pro.js',
      'production-hardening.js',
      'database-cloud-v2.js',
      // Protege e corrige a taxa antes de qualquer cadastro/edição ser persistido.
      'courier-fee-consistency.js',
      'atomic-delivery-code.js',
      'auth-onboarding.js',
      'currency-inputs.js',
      // Calcula automaticamente quanto de troco precisa ir com o entregador.
      'change-calculator.js',
      // Regras finais: pago online não exige conferência e cancelamento mantém taxa.
      'business-rules-v2.js',
      // Mantém os indicadores de Entregas no mesmo período selecionado na tabela.
      'delivery-date-scope.js'
    ];

    await loadOrderedGroup(essential, 'recurso');

    // Painéis gerenciais e históricos são úteis, mas não precisam atrasar login,
    // banco, cadastro de entrega ou conferência de pagamento. São carregados um
    // a um quando o navegador estiver ocioso após a sessão estar pronta.
    const deferred = [
      'ticket-average.js',
      'operations-pro.js',
      // Permite analisar um dia específico sem perder os filtros por período.
      'report-date-filter.js',
      'closing-history.js'
    ];

    let deferredStarted = false;
    async function loadDeferredEnhancements() {
      if (deferredStarted) return;
      deferredStarted = true;

      for (const file of deferred) {
        await waitForIdle();
        try {
          await loadScript(`./${file}?v=${version}`, true);
        } catch (error) {
          console.error(`[X-Burguer] Não foi possível carregar recurso adicional ${file}:`, error);
        }
      }

      if (typeof renderAll === 'function' && !document.hidden) renderAll();
      window.dispatchEvent(new CustomEvent('xb:enhancements-ready'));
    }

    window.addEventListener('xb:cloud-ready', loadDeferredEnhancements, { once: true });

    // Cobre restauração de sessão extremamente rápida, caso o evento tenha sido
    // emitido antes do listener acima ser instalado.
    setTimeout(() => {
      const appVisible = !document.getElementById('appView')?.classList.contains('hidden');
      if (appVisible || window.XBCloud?.state?.connected) loadDeferredEnhancements();
    }, 1600);
  }

  startSystem().catch(error => {
    console.error('[X-Burguer] Falha ao iniciar o sistema:', error);
  });
})();
