(() => {
  const version = '20260911-prod-audit2';

  const loadScript = src => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Falha ao carregar ${src}`));
    document.body.appendChild(script);
  });

  // Ativa primeiro os recursos de aplicativo instalável/PWA.
  loadScript(`./pwa-app.js?v=${version}`).catch(error => {
    console.error('[X-Burguer] Não foi possível ativar o modo aplicativo:', error);
  });

  async function startSystem() {
    try {
      await loadScript(`./supabase-config.js?v=${version}`);
      await loadScript(`./app-core.js?v=${version}`);
    } catch (error) {
      console.error('[X-Burguer] Falha crítica ao carregar o núcleo do sistema:', error);
      return;
    }

    const complements = [
      'cloud-auth-guard.js',
      'database-prep.js',
      'confirm-ui.js',
      // Contrato de produção: dados, restauração, status de nuvem e ações críticas.
      'system-production-v2.js',
      'system-update.js',
      'closing-summary.js',
      'ticket-average.js',
      'system-audit.js',
      'simple-payment-flow.js',
      'delivery-edit-plus.js',
      'payment-confirmation-pro.js',
      'operations-pro.js',
      'closing-history.js',
      // Corrige fluxos legados, backup, recuperação e dados residuais antes da nuvem.
      'production-hardening.js',
      // Sincronização por registro, fila offline e conciliação segura entre aparelhos.
      'database-cloud-v2.js',
      // Reserva o número do pedido no Supabase antes de cadastrar, evitando colisões.
      'atomic-delivery-code.js',
      // Produção: somente login existente e alteração segura de credenciais.
      'auth-onboarding.js'
    ];

    for (const file of complements) {
      try {
        await loadScript(`./${file}?v=${version}`);
      } catch (error) {
        console.error(`[X-Burguer] Não foi possível carregar ${file}:`, error);
      }
    }
  }

  startSystem();
})();
