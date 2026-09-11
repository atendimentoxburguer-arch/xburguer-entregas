(() => {
  if (window.__xbCloudAuthGuardInstalled) return;
  window.__xbCloudAuthGuardInstalled = true;

  const config = window.XB_SUPABASE_CONFIG || {};
  if (!config.enabled) return;

  // Com o banco online ativado, o antigo login local não pode liberar o sistema.
  // Uma sessão válida do Supabase será restaurada automaticamente pelo database-cloud.js.
  try { sessionStorage.removeItem(SESSION_KEY); } catch {}
  document.getElementById('appView')?.classList.add('hidden');
  document.getElementById('loginView')?.classList.remove('hidden');

  document.getElementById('loginForm')?.addEventListener('submit', event => {
    const cloudReady = Boolean(window.XBCloud?.configured && window.XBCloud?.client);
    if (cloudReady) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const message = navigator.onLine
      ? 'Conectando ao banco online. Aguarde um instante e tente novamente.'
      : 'Sem internet. O primeiro login precisa de conexão com o banco online.';
    if (typeof toast === 'function') toast(message, 'error');
    else console.warn(`[X-Burguer] ${message}`);
  }, true);
})();