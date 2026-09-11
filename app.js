(() => {
  const version = '20260911-db-live1';

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
      // A configuração é carregada antes do núcleo para que a conexão online possa
      // ser ativada automaticamente assim que o projeto Supabase dedicado for ligado.
      await loadScript(`./supabase-config.js?v=${version}`);
      await loadScript(`./app-core.js?v=${version}`);
    } catch (error) {
      console.error('[X-Burguer] Falha crítica ao carregar o núcleo do sistema:', error);
      return;
    }

    const complements = [
      // Impede que o login local antigo libere o sistema quando o Supabase está ativo.
      'cloud-auth-guard.js',
      'database-prep.js',
      'confirm-ui.js',
      'system-update.js',
      'closing-summary.js',
      'ticket-average.js',
      'system-audit.js',
      'simple-payment-flow.js',
      'delivery-edit-plus.js',
      'payment-confirmation-pro.js',
      'operations-pro.js',
      'closing-history.js',
      // Mantido no fim para envolver o save() definitivo, restaurar sessão e sincronizar.
      'database-cloud.js',
      // Primeiro acesso e alteração segura de e-mail/senha pelo Supabase Auth.
      'auth-onboarding.js'
    ];

    for (const file of complements) {
      try {
        await loadScript(`./${file}?v=${version}`);
      } catch (error) {
        // Um complemento com problema não impede os demais recursos de iniciarem.
        console.error(`[X-Burguer] Não foi possível carregar ${file}:`, error);
      }
    }
  }

  startSystem();
})();
