(() => {
  const version = '20260916-device-sync1';

  // O HTML pode permanecer aberto por dias em outro computador. Atualizamos
  // a folha principal pelo carregador para forçar a mesma versão visual em todos.
  const mainStylesheet = document.querySelector('link[rel="stylesheet"][href*="styles.css"]');
  if (mainStylesheet) {
    const expectedHref = `./styles.css?v=${version}`;
    if (mainStylesheet.getAttribute('href') !== expectedHref) mainStylesheet.setAttribute('href', expectedHref);
  }

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  const loadScript = (src, ordered = true) => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = !ordered;
    script.onload = () => resolve(src);
    script.onerror = () => {
      script.remove();
      reject(new Error(`Falha ao carregar ${src}`));
    };
    document.body.appendChild(script);
  });

  async function loadVersionedFile(file, label = 'módulo') {
    const src = `./${file}?v=${version}`;
    try {
      return await loadScript(src, true);
    } catch (firstError) {
      await sleep(350);
      try {
        return await loadScript(`${src}&retry=1`, true);
      } catch (error) {
        console.error(`[X-Burguer] Não foi possível carregar ${label} ${file}:`, error);
        throw error;
      }
    }
  }

  async function loadOrderedGroup(files, label = 'módulo') {
    for (const file of files) await loadVersionedFile(file, label);
    return true;
  }

  // O PWA não bloqueia o painel, mas recebe a mesma versão do restante da aplicação.
  loadScript(`./pwa-app.js?v=${version}`, false).catch(error => {
    console.error('[X-Burguer] Não foi possível ativar o modo aplicativo:', error);
  });

  async function startSystem() {
    try {
      await loadOrderedGroup([
        'supabase-config.js',
        'app-core.js',
        'core-safety.js'
      ], 'núcleo');
    } catch {
      console.error('[X-Burguer] Falha crítica ao carregar o núcleo do sistema.');
      return;
    }

    const essential = [
      'cloud-auth-guard.js',
      'database-prep.js',
      'performance-mode.js',
      'confirm-ui.js',
      'system-production-v2.js',
      'system-update.js',
      'closing-summary.js',
      'system-audit.js',
      'system-integrity-v3.js',
      'simple-payment-flow.js',
      'delivery-edit-plus.js',
      'payment-confirmation-pro.js',
      'production-hardening.js',
      'database-cloud-v2.js',
      'courier-fee-consistency.js',
      'atomic-delivery-code.js',
      'auth-onboarding.js',
      'currency-inputs.js',
      'change-calculator.js',
      'business-rules-v2.js',
      'delivery-date-scope.js',
      'metrics-consistency-v4.js',
      'closing-continuity.js',
      'final-integrity-guards.js'
    ];

    try {
      await loadOrderedGroup(essential, 'recurso');
    } catch {
      console.error('[X-Burguer] Um recurso essencial não foi carregado. Recarregue a página.');
      return;
    }

    // Antes estes recursos dependiam de um evento + timeout. Em notebooks mais
    // lentos esse evento podia ser perdido, deixando Relatórios e outros painéis
    // incompletos. Agora o conjunto gerencial sempre é carregado em todos aparelhos.
    const management = [
      'ticket-average.js',
      'operations-pro.js',
      'report-date-filter.js',
      'closing-history.js'
    ];

    try {
      await loadOrderedGroup(management, 'recurso gerencial');
    } catch {
      console.error('[X-Burguer] Falha ao completar os recursos gerenciais.');
      return;
    }

    if (typeof renderAll === 'function' && !document.hidden) renderAll();
    window.dispatchEvent(new CustomEvent('xb:enhancements-ready'));
    window.dispatchEvent(new CustomEvent('xb:system-ready', { detail: { version } }));
  }

  startSystem().catch(error => {
    console.error('[X-Burguer] Falha ao iniciar o sistema:', error);
  });
})();
