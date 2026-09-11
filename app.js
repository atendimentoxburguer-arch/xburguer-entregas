(() => {
  const version = '20260911-1210';

  const loadScript = src => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Falha ao carregar ${src}`));
    document.body.appendChild(script);
  });

  loadScript(`./app-core.js?v=${version}`)
    .then(() => loadScript(`./confirm-ui.js?v=${version}`))
    .then(() => loadScript(`./system-update.js?v=${version}`))
    .catch(error => {
      console.error('[X-Burguer] Erro ao iniciar o sistema:', error);
    });
})();
