(() => {
  const version = '20260911-1425';

  const loadScript = src => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Falha ao carregar ${src}`));
    document.body.appendChild(script);
  });

  async function startSystem() {
    try {
      await loadScript(`./app-core.js?v=${version}`);
    } catch (error) {
      console.error('[X-Burguer] Falha crítica ao carregar o núcleo do sistema:', error);
      return;
    }

    const complements = [
      'confirm-ui.js',
      'system-update.js',
      'closing-summary.js',
      'ticket-average.js',
      'system-audit.js',
      'simple-payment-flow.js',
      'delivery-edit-plus.js',
      'payment-confirmation-pro.js',
      'operations-pro.js'
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
