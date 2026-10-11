(() => {
  const version = '20261011-sync-resilience-v6';
  window.XB_APP_VERSION = version;

  // O HTML pode permanecer aberto por dias em outro computador. Atualizamos
  // a folha principal pelo carregador para forçar a mesma versão visual em todos.
  const mainStylesheet = document.querySelector('link[rel="stylesheet"][href*="styles.css"]');
  if (mainStylesheet) {
    const expectedHref = `./styles.css?v=${version}`;
    if (mainStylesheet.getAttribute('href') !== expectedHref) mainStylesheet.setAttribute('href', expectedHref);
  }

  // Também registra a versão atual do service worker diretamente pelo carregador.
  // Assim um notebook com um PWA antigo não depende do cache anterior para se atualizar.
  if ('serviceWorker' in navigator) {
    window.__xbLoaderRegisteredServiceWorker = true;
    const reloadKey = `xb_sw_reload_${version}`;
    let reloadingForWorker = false;
    navigator.serviceWorker.addEventListener('controllerchange', async () => {
      if (reloadingForWorker || sessionStorage.getItem(reloadKey) === '1') return;
      reloadingForWorker = true;
      try {
        // Não recarrega um formulário em uso nem descarta gravações sem confirmação.
        await window.XBLocalCache?.flush();
        if (window.__xbSystemHasStarted) {
          window.__xbUpdateWaiting = true;
          window.dispatchEvent(new CustomEvent('xb:update-ready'));
          return;
        }
        sessionStorage.setItem(reloadKey, '1');
        location.reload();
      } catch (error) {
        console.warn('[X-Burguer] Atualização aguardando gravação local:', error);
      } finally { reloadingForWorker = false; }
    });
    navigator.serviceWorker.register(`./service-worker.js?v=${version}`, {
      scope: './',
      updateViaCache: 'none'
    }).then(registration => registration.update().catch(() => {})).catch(error => {
      console.warn('[X-Burguer] Atualização do cache indisponível:', error);
    });
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
    for (const file of files) {
      await loadVersionedFile(file, label);
      if (file === 'app-core.js' && window.__xbCoreLoadFailure) throw new Error(window.__xbCoreLoadFailure);
    }
    return true;
  }

  // O PWA não bloqueia o painel, mas recebe a mesma versão do restante da aplicação.
  loadScript(`./pwa-app.js?v=${version}`, false).catch(error => {
    console.error('[X-Burguer] Não foi possível ativar o modo aplicativo:', error);
  });

  async function startSystem() {
    try {
      await loadVersionedFile('local-cache.js', 'armazenamento local');
      await window.XBLocalCache.ready;
      if (window.XBLocalCache.state.blocked) throw new Error(window.XBLocalCache.state.error);
      window.__xbSystemHasStarted = true;
      await loadOrderedGroup([
        'supabase-config.js',
        'app-core.js',
        'core-safety.js'
      ], 'núcleo');
    } catch (error) {
      console.error('[X-Burguer] Falha crítica ao carregar o núcleo do sistema.');
      const notice = document.createElement('div');
      notice.setAttribute('role', 'alert');
      notice.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#fff8f3;display:grid;place-content:center;padding:24px;text-align:center';
      const title = document.createElement('h2');
      title.textContent = 'Não foi possível abrir os dados com segurança';
      const detail = document.createElement('p');
      detail.textContent = String(error?.message || 'Verifique a conexão e tente novamente.');
      const retry = document.createElement('button');
      retry.className = 'btn btn-primary';
      retry.textContent = 'Tentar novamente';
      retry.addEventListener('click', () => location.reload());
      notice.append(title, detail, retry);
      document.body.appendChild(notice);
      return;
    }

    const essential = [
      'cloud-auth-guard.js',
      'sync-protection.js',
      'database-prep.js',
      // Carrega a fonte canônica de datas, períodos e dinheiro antes das regras derivadas.
      'metrics-consistency-v4.js',
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
      'cloud-transport.js',
      'database-cloud-v2.js',
      'courier-fee-consistency.js',
      'atomic-delivery-code.js',
      'delivery-recovery.js',
      'auth-onboarding.js',
      'currency-inputs.js',
      'change-calculator.js',
      'business-rules-v2.js',
      'delivery-date-scope.js',
      'closing-continuity.js',
      'final-integrity-guards.js',
      // Nunca deixa um dia anterior com pedido pendente passar despercebido.
      'past-day-guard.js'
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
