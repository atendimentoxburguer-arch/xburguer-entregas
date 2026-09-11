(() => {
  if (window.__xbAuthOnboardingInstalled) return;
  window.__xbAuthOnboardingInstalled = true;

  const config = window.XB_SUPABASE_CONFIG || {};
  if (!config.enabled) return;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function notify(message, type = 'ok') {
    if (typeof toast === 'function') toast(message, type);
    else console.info(`[X-Burguer] ${message}`);
  }

  async function waitForClient(timeoutMs = 15000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (window.XBCloud?.configured && window.XBCloud?.client) return window.XBCloud.client;
      await sleep(120);
    }
    return null;
  }

  function ensureStyles() {
    if (document.getElementById('xbAuthOnboardingStyles')) return;
    const style = document.createElement('style');
    style.id = 'xbAuthOnboardingStyles';
    style.textContent = `
      .xb-first-access{width:100%;margin-top:10px;min-height:46px;border:1px solid #ead5c7;border-radius:13px;background:linear-gradient(135deg,#fffaf6,#f5e7dc);color:#7b1a20;font:inherit;font-weight:850;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px}
      .xb-first-access:hover{border-color:#d8b7a4;background:linear-gradient(135deg,#fff7f1,#f1dfd2)}
      .xb-first-access:disabled{opacity:.6;cursor:wait}
      .xb-first-access-note{margin:9px 0 0;text-align:center;color:#786a63;font-size:.75rem;line-height:1.45}
      .xb-cloud-access-note{display:flex;gap:8px;align-items:flex-start;margin-top:12px;padding:10px 11px;border-radius:12px;background:#f8eee7;color:#6f625b;font-size:.76rem;line-height:1.45}
      .xb-cloud-access-note svg{width:15px;height:15px;flex:0 0 auto;margin-top:2px}
    `;
    document.head.appendChild(style);
  }

  async function createFirstAccess(client, button) {
    const emailInput = document.getElementById('loginEmail');
    const passwordInput = document.getElementById('loginPassword');
    const email = emailInput?.value.trim() || '';
    const password = passwordInput?.value || '';

    if (!email) {
      emailInput?.focus();
      return notify('Informe o e-mail que será usado para entrar no aplicativo.', 'error');
    }
    if (password.length < 8) {
      passwordInput?.focus();
      return notify('Crie uma senha com pelo menos 8 caracteres.', 'error');
    }
    if (password === '123456') {
      passwordInput?.focus();
      return notify('Escolha uma senha nova e mais segura que a senha antiga do sistema.', 'error');
    }

    button.disabled = true;
    const original = button.innerHTML;
    button.textContent = 'Criando acesso seguro...';

    try {
      const { data, error } = await client.auth.signUp({ email, password });
      if (error) throw error;

      localStorage.setItem(LOGIN_EMAIL_KEY, email);
      const remember = document.getElementById('rememberLogin');
      if (remember) remember.checked = true;

      if (data?.session?.user) {
        // A sessão já foi liberada pelo Supabase. Ao recarregar, database-cloud.js
        // restaura a sessão e faz a migração local automaticamente.
        db.settings.email = email;
        db.settings.password = '';
        save();
        notify('Acesso criado. Conectando ao banco e migrando os dados...');
        setTimeout(() => location.reload(), 700);
        return;
      }

      notify('Acesso criado. Confirme o e-mail enviado pelo Supabase e depois entre normalmente.');
      button.innerHTML = original;
      button.disabled = false;
    } catch (error) {
      console.error('[X-Burguer] Falha ao criar primeiro acesso:', error);
      const message = /already|registered|exists/i.test(String(error?.message || ''))
        ? 'Esse e-mail já possui acesso. Use o botão Entrar no sistema.'
        : 'Não foi possível criar o acesso agora. Confira e-mail, senha e conexão.';
      notify(message, 'error');
      button.innerHTML = original;
      button.disabled = false;
    }
  }

  function ensureFirstAccessButton(client) {
    const form = document.getElementById('loginForm');
    const submit = form?.querySelector('button[type="submit"]');
    if (!form || !submit || document.getElementById('xbFirstAccessBtn')) return;

    ensureStyles();
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'xbFirstAccessBtn';
    button.className = 'xb-first-access';
    button.innerHTML = `${typeof icon === 'function' ? icon('user-plus') : ''}<span>Criar primeiro acesso seguro</span>`;
    submit.insertAdjacentElement('afterend', button);

    const note = document.createElement('p');
    note.className = 'xb-first-access-note';
    note.textContent = 'Use somente na primeira configuração. Depois o acesso fica salvo e a conexão é automática.';
    button.insertAdjacentElement('afterend', note);

    button.addEventListener('click', () => createFirstAccess(client, button));
    if (typeof refreshIcons === 'function') refreshIcons();
  }

  async function syncCredentialFields(client) {
    const email = document.getElementById('settingEmail');
    const password = document.getElementById('settingPassword');
    if (password) {
      password.value = '';
      password.placeholder = 'Nova senha (deixe em branco para manter)';
      password.autocomplete = 'new-password';
    }

    try {
      const { data } = await client.auth.getUser();
      if (email && data?.user?.email) email.value = data.user.email;
    } catch {}

    const card = document.getElementById('credentialsForm');
    const title = card?.querySelector('.card-head h3');
    const subtitle = card?.querySelector('.card-head p');
    if (title) title.textContent = 'Acesso seguro';
    if (subtitle) subtitle.textContent = 'Login protegido pelo Supabase Auth';

    if (card && !card.querySelector('.xb-cloud-access-note')) {
      const body = card.querySelector('.card-body');
      const note = document.createElement('div');
      note.className = 'xb-cloud-access-note';
      note.innerHTML = `${typeof icon === 'function' ? icon('cloud-check') : ''}<span>Alterações de e-mail ou senha passam a valer em todos os aparelhos. Nenhuma senha é salva no banco de dados do aplicativo.</span>`;
      body?.appendChild(note);
      if (typeof refreshIcons === 'function') refreshIcons();
    }
  }

  function installCredentialsBridge(client) {
    const form = document.getElementById('credentialsForm');
    if (!form || form.dataset.cloudAuthBound === '1') return;
    form.dataset.cloudAuthBound = '1';

    form.addEventListener('submit', async event => {
      event.preventDefault();
      event.stopImmediatePropagation();

      const emailInput = document.getElementById('settingEmail');
      const passwordInput = document.getElementById('settingPassword');
      const email = emailInput?.value.trim() || '';
      const password = passwordInput?.value || '';

      try {
        const { data: userData, error: userError } = await client.auth.getUser();
        if (userError) throw userError;
        const user = userData?.user;
        if (!user) return notify('Faça login novamente para alterar o acesso.', 'error');

        const changes = {};
        if (email && email !== user.email) changes.email = email;
        if (password) {
          if (password.length < 8) return notify('A nova senha precisa ter pelo menos 8 caracteres.', 'error');
          if (password === '123456') return notify('Escolha uma senha diferente da senha antiga do sistema.', 'error');
          changes.password = password;
        }
        if (!Object.keys(changes).length) return notify('Nenhuma alteração de acesso foi informada.');

        const submit = form.querySelector('button[type="submit"]');
        if (submit) submit.disabled = true;
        const { data, error } = await client.auth.updateUser(changes);
        if (error) throw error;

        db.settings.email = data?.user?.email || email || user.email || '';
        db.settings.password = '';
        save();
        if (passwordInput) passwordInput.value = '';
        notify(changes.email ? 'Acesso atualizado. Se o Supabase solicitar, confirme o novo e-mail.' : 'Senha atualizada com segurança.');
        await syncCredentialFields(client);
        if (submit) submit.disabled = false;
      } catch (error) {
        console.error('[X-Burguer] Falha ao atualizar credenciais:', error);
        notify('Não foi possível atualizar o acesso.', 'error');
        const submit = form.querySelector('button[type="submit"]');
        if (submit) submit.disabled = false;
      }
    }, true);
  }

  async function start() {
    const client = await waitForClient();
    if (!client) return;

    ensureFirstAccessButton(client);
    installCredentialsBridge(client);
    await syncCredentialFields(client);

    if (typeof renderSettings === 'function' && !window.__xbCloudRenderSettingsWrapped) {
      window.__xbCloudRenderSettingsWrapped = true;
      const previousRenderSettings = renderSettings;
      renderSettings = function xbCloudRenderSettings() {
        previousRenderSettings();
        syncCredentialFields(client);
      };
    }
  }

  start().catch(error => console.error('[X-Burguer] Primeiro acesso Supabase:', error));
})();