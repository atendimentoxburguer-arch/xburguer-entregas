(() => {
  if (window.__xbPwaInstalled) return;
  window.__xbPwaInstalled = true;

  let deferredPrompt = null;
  let installButton = null;

  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

  function ensureHeadMeta() {
    if (!document.querySelector('link[rel="manifest"]')) {
      const manifest = document.createElement('link');
      manifest.rel = 'manifest';
      manifest.href = './manifest.webmanifest?v=20260911-1518';
      document.head.appendChild(manifest);
    }

    const metas = [
      ['mobile-web-app-capable', 'yes'],
      ['apple-mobile-web-app-capable', 'yes'],
      ['apple-mobile-web-app-status-bar-style', 'black-translucent'],
      ['apple-mobile-web-app-title', 'X-Burguer'],
      ['application-name', 'X-Burguer Entregas']
    ];
    metas.forEach(([name, content]) => {
      if (document.querySelector(`meta[name="${name}"]`)) return;
      const meta = document.createElement('meta');
      meta.name = name;
      meta.content = content;
      document.head.appendChild(meta);
    });

    if (!document.querySelector('link[rel="icon"]')) {
      const icon = document.createElement('link');
      icon.rel = 'icon';
      icon.href = './app-icon.svg?v=20260911-1518';
      icon.type = 'image/svg+xml';
      document.head.appendChild(icon);
    }

    if (!document.querySelector('link[rel="apple-touch-icon"]')) {
      const apple = document.createElement('link');
      apple.rel = 'apple-touch-icon';
      apple.href = './assets/xburguer-logo.jpg?v=20260911';
      document.head.appendChild(apple);
    }
  }

  function notify(message) {
    if (typeof window.toast === 'function') {
      window.toast(message);
      return;
    }
    console.info(`[X-Burguer] ${message}`);
  }

  function ensureInstallStyles() {
    if (document.getElementById('xbPwaStyles')) return;
    const style = document.createElement('style');
    style.id = 'xbPwaStyles';
    style.textContent = `
      .xb-install-app{
        position:fixed;right:18px;bottom:18px;z-index:9998;
        display:none;align-items:center;gap:10px;min-height:50px;padding:0 17px;
        border:1px solid rgba(255,255,255,.25);border-radius:16px;
        background:linear-gradient(135deg,#79040b 0%,#a80712 62%,#c91620 100%);
        color:#fff;font:inherit;font-weight:850;font-size:.88rem;letter-spacing:-.01em;
        box-shadow:0 16px 38px rgba(101,4,11,.28);cursor:pointer;
        transition:transform .16s ease,box-shadow .16s ease,opacity .16s ease
      }
      .xb-install-app:hover{transform:translateY(-2px);box-shadow:0 20px 42px rgba(101,4,11,.34)}
      .xb-install-app.show{display:inline-flex}
      .xb-install-app .xb-app-mark{
        width:31px;height:31px;border-radius:10px;display:grid;place-items:center;
        background:rgba(255,255,255,.14);font-weight:900;color:#ffd66a
      }
      .xb-install-app small{display:block;font-size:.68rem;font-weight:700;opacity:.78;line-height:1.15}
      .xb-install-app strong{display:block;line-height:1.2}
      @media(max-width:700px){
        .xb-install-app{right:12px;bottom:12px;min-height:48px;padding:0 14px;border-radius:14px}
      }
      @media(display-mode:standalone){.xb-install-app{display:none!important}}
    `;
    document.head.appendChild(style);
  }

  function ensureInstallButton() {
    if (installButton || isStandalone()) return installButton;
    ensureInstallStyles();
    installButton = document.createElement('button');
    installButton.type = 'button';
    installButton.className = 'xb-install-app';
    installButton.setAttribute('aria-label', 'Instalar aplicativo X-Burguer');
    installButton.innerHTML = `
      <span class="xb-app-mark">XB</span>
      <span><strong>Instalar aplicativo</strong><small>Abrir como app no celular ou computador</small></span>`;
    document.body.appendChild(installButton);

    installButton.addEventListener('click', async () => {
      if (deferredPrompt) {
        installButton.disabled = true;
        try {
          deferredPrompt.prompt();
          await deferredPrompt.userChoice;
        } catch (error) {
          console.warn('[X-Burguer] Instalação não concluída:', error);
        } finally {
          deferredPrompt = null;
          installButton.disabled = false;
          installButton.classList.remove('show');
        }
        return;
      }

      if (isIOS()) {
        const message = 'No iPhone/iPad: toque em Compartilhar e depois em “Adicionar à Tela de Início”.';
        if (typeof window.toast === 'function') window.toast(message);
        else window.alert(message);
        return;
      }

      const message = 'Use a opção “Instalar aplicativo” do menu do navegador.';
      if (typeof window.toast === 'function') window.toast(message);
      else window.alert(message);
    });

    return installButton;
  }

  function showInstallButton() {
    const button = ensureInstallButton();
    if (button && !isStandalone()) button.classList.add('show');
  }

  ensureHeadMeta();

  if (isStandalone()) {
    document.documentElement.classList.add('xb-app-mode');
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredPrompt = event;
    showInstallButton();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installButton?.classList.remove('show');
    notify('Aplicativo X-Burguer instalado com sucesso.');
  });

  if (isIOS() && !isStandalone()) {
    document.addEventListener('DOMContentLoaded', showInstallButton, { once: true });
    if (document.readyState !== 'loading') showInstallButton();
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
      try {
        await navigator.serviceWorker.register('./service-worker.js?v=20260911-1518', { scope: './' });
        if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
      } catch (error) {
        console.error('[X-Burguer] Não foi possível ativar o modo aplicativo:', error);
      }
    }, { once: true });
  }
})();
