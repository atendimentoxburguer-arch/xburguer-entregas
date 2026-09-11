(() => {
  if (window.__xbSystemProductionV2Installed) return;
  window.__xbSystemProductionV2Installed = true;

  const config = window.XB_SUPABASE_CONFIG || {};
  const cloudEnabled = Boolean(config.enabled);
  const RECOVERY_KEY = 'xb_entregas_recovery_v1';
  const PREVIOUS_KEY = 'xb_entregas_previous_state_v1';
  const SNAPSHOT_KEYS = [RECOVERY_KEY, PREVIOUS_KEY, 'xb_cloud_pre_migration_backup_v1'];

  const clone = value => JSON.parse(JSON.stringify(value));

  function notify(message, type = 'ok') {
    if (typeof toast === 'function') toast(message, type);
    else console.info(`[X-Burguer] ${message}`);
  }

  function safeGet(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  function safeSet(key, value) {
    try { localStorage.setItem(key, value); return true; } catch { return false; }
  }

  function scrubSecrets(target) {
    if (!target?.settings) return target;
    target.settings.password = '';
    target.settings.email = '';
    return target;
  }

  function normalizeProductionData(source) {
    const normalized = window.XBDataBridge?.normalize
      ? window.XBDataBridge.normalize(source)
      : clone(source || {});

    scrubSecrets(normalized);
    (normalized.deliveries || []).forEach(item => {
      if (item.status === 'Em rota') item.status = 'Aguardando';
      if (item.status !== 'Entregue') item.paymentConfirmedAt = '';
    });

    const sample = new Map([
      ['carlos', 'Carlos Oliveira'],
      ['ana', 'Ana Paula'],
      ['bruno', 'Bruno Santos']
    ]);
    const isExactSample = Array.isArray(normalized.couriers) &&
      normalized.couriers.length === 3 &&
      normalized.couriers.every(item => sample.get(String(item.id)) === String(item.name));
    if (isExactSample && !(normalized.deliveries || []).length && !(normalized.closings || []).length) {
      normalized.couriers = [];
    }

    return normalized;
  }

  function hardenCurrentData() {
    if (!cloudEnabled || !window.XBDataBridge || !db) return;
    const before = JSON.stringify(db);
    const normalized = normalizeProductionData(db);
    if (JSON.stringify(normalized) === before) return;
    db = normalized;
    save();
  }

  function sanitizeStoredSnapshots() {
    if (!cloudEnabled) return;
    SNAPSHOT_KEYS.forEach(key => {
      const raw = safeGet(key);
      if (!raw) return;
      try {
        const payload = JSON.parse(raw);
        if (payload?.db) payload.db = normalizeProductionData(payload.db);
        else if (payload && typeof payload === 'object') Object.assign(payload, normalizeProductionData(payload));
        safeSet(key, JSON.stringify(payload));
      } catch {}
    });
  }

  async function ask(options) {
    if (typeof window.xbConfirm === 'function') return window.xbConfirm(options);
    return window.confirm(options?.text || options?.title || 'Confirmar ação?');
  }

  function updateStaticUi() {
    const loginEmail = document.getElementById('loginEmail');
    if (loginEmail) loginEmail.placeholder = 'Seu e-mail de acesso';

    const status = document.getElementById('statusFilter');
    if (status) {
      [...status.options].forEach(option => {
        if (option.value === 'Em rota' || option.textContent.trim() === 'Em rota') option.remove();
      });
      const pending = [...status.options].find(option => option.value === 'Aguardando');
      if (pending) pending.textContent = 'Pagamento a conferir';
    }

    const credentialsPassword = document.getElementById('settingPassword');
    if (credentialsPassword) {
      credentialsPassword.value = '';
      credentialsPassword.autocomplete = 'new-password';
      credentialsPassword.placeholder = 'Nova senha (opcional)';
    }
  }

  function installSyncBadge() {
    const topRight = document.querySelector('.top-right');
    if (!topRight || document.getElementById('xbCloudBadge')) return;

    const badge = document.createElement('div');
    badge.id = 'xbCloudBadge';
    badge.className = 'xb-cloud-badge connecting';
    badge.setAttribute('role', 'status');
    badge.setAttribute('aria-live', 'polite');
    badge.innerHTML = '<span class="xb-cloud-dot"></span><span class="xb-cloud-label">Conectando banco...</span>';
    topRight.insertBefore(badge, topRight.firstChild);
  }

  function cloudVisualState() {
    const cloud = window.XBCloud;
    const state = cloud?.state || {};
    const pending = Number(cloud?.pendingChanges ?? state.pending ?? 0);

    if (!navigator.onLine) {
      return {
        klass: pending ? 'offline pending' : 'offline',
        text: pending ? `Offline · ${pending} pendente${pending === 1 ? '' : 's'}` : 'Offline · cache local'
      };
    }
    if (!cloud?.configured || !cloud?.client) return { klass: 'connecting', text: 'Conectando banco...' };
    if (state.syncing || /sincronizando/i.test(String(state.message || ''))) {
      return { klass: 'syncing', text: pending ? `Sincronizando · ${pending}` : 'Sincronizando...' };
    }
    if (pending) return { klass: 'pending', text: `${pending} alteração${pending === 1 ? '' : 'ões'} pendente${pending === 1 ? '' : 's'}` };
    if (state.connected) return { klass: 'online', text: 'Banco online' };
    return { klass: 'connecting', text: state.message || 'Verificando banco...' };
  }

  function updateSyncUi() {
    installSyncBadge();
    const badge = document.getElementById('xbCloudBadge');
    const visual = cloudVisualState();
    if (badge) {
      const nextClass = `xb-cloud-badge ${visual.klass}`;
      if (badge.className !== nextClass) badge.className = nextClass;
      const label = badge.querySelector('.xb-cloud-label');
      if (label && label.textContent !== visual.text) label.textContent = visual.text;
      const nextTitle = window.XBCloud?.state?.lastSyncAt
        ? `Última sincronização: ${new Date(window.XBCloud.state.lastSyncAt).toLocaleString('pt-BR')}`
        : visual.text;
      if (badge.title !== nextTitle) badge.title = nextTitle;
    }

    const submit = document.querySelector('#deliveryForm button[type="submit"]');
    if (submit) {
      const offline = !navigator.onLine;
      if (submit.disabled !== offline) submit.disabled = offline;
      const nextTitle = offline
        ? 'Conecte à internet para reservar com segurança o número do pedido.'
        : '';
      if (submit.title !== nextTitle) submit.title = nextTitle;
    }
  }

  function installSyncButton() {
    const actions = document.querySelector('#databaseReadinessCard .db-actions');
    if (!actions || document.getElementById('databaseSyncNowBtn')) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-light btn-sm';
    button.id = 'databaseSyncNowBtn';
    button.innerHTML = `${typeof icon === 'function' ? icon('refresh-cw') : ''}Sincronizar agora`;
    actions.prepend(button);

    button.addEventListener('click', async () => {
      if (!navigator.onLine) return notify('Sem internet. As alterações continuam guardadas neste aparelho.', 'error');
      const cloud = window.XBCloud;
      if (!cloud?.client) return notify('O banco ainda está conectando. Tente novamente em alguns segundos.', 'error');
      button.disabled = true;
      try {
        await cloud.syncNow?.();
        await cloud.pullNow?.();
        updateSyncUi();
        notify('Sincronização concluída.');
      } catch (error) {
        console.error('[X-Burguer] Sincronização manual:', error);
        notify('Não foi possível concluir a sincronização agora.', 'error');
      } finally {
        button.disabled = false;
      }
    });
  }

  function installStyles() {
    if (document.getElementById('xbSystemProductionV2Style')) return;
    const style = document.createElement('style');
    style.id = 'xbSystemProductionV2Style';
    style.textContent = `
      .xb-cloud-badge{display:inline-flex;align-items:center;gap:7px;min-height:34px;padding:0 10px;border:1px solid #e1d4cb;border-radius:999px;background:linear-gradient(135deg,#fffaf6,#f4e9e2);color:#685c55;font-size:.73rem;font-weight:800;white-space:nowrap}
      .xb-cloud-dot{width:8px;height:8px;border-radius:50%;background:#a59a94;box-shadow:0 0 0 3px rgba(165,154,148,.12)}
      .xb-cloud-badge.online{border-color:#c8e7d6;background:linear-gradient(135deg,#f1fbf5,#e7f6ed);color:#146d47}.xb-cloud-badge.online .xb-cloud-dot{background:#1a9b62;box-shadow:0 0 0 3px rgba(26,155,98,.12)}
      .xb-cloud-badge.syncing,.xb-cloud-badge.pending{border-color:#edd8a7;background:linear-gradient(135deg,#fff9e9,#fff1ca);color:#88600e}.xb-cloud-badge.syncing .xb-cloud-dot,.xb-cloud-badge.pending .xb-cloud-dot{background:#d99415;box-shadow:0 0 0 3px rgba(217,148,21,.13)}
      .xb-cloud-badge.offline{border-color:#ebc9cc;background:linear-gradient(135deg,#fff5f5,#fbe8e9);color:#9b2029}.xb-cloud-badge.offline .xb-cloud-dot{background:#c92a35;box-shadow:0 0 0 3px rgba(201,42,53,.12)}
      .xb-cloud-badge.connecting .xb-cloud-dot{animation:xbCloudPulse 1.2s ease-in-out infinite}
      @keyframes xbCloudPulse{0%,100%{opacity:.45;transform:scale(.8)}50%{opacity:1;transform:scale(1.12)}}
      @media(max-width:760px){.xb-cloud-badge{padding:0 8px}.xb-cloud-label{display:none}.xb-cloud-badge{width:34px;justify-content:center}}
    `;
    document.head.appendChild(style);
  }

  function installSecureBackupRestore() {
    const input = document.getElementById('backupFile');
    if (!input || input.dataset.productionRestoreBound === '1') return;
    input.dataset.productionRestoreBound = '1';

    input.addEventListener('change', async event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const file = event.target.files?.[0];
      if (!file) return;

      try {
        const imported = JSON.parse(await file.text());
        if (!imported || !Array.isArray(imported.deliveries) || !Array.isArray(imported.couriers)) {
          throw new Error('Formato inválido');
        }
        const normalized = normalizeProductionData(imported);
        const ok = await ask({
          title: 'Restaurar este backup?',
          text: 'Os dados operacionais atuais serão substituídos pelo conteúdo verificado do arquivo.',
          detail: `${normalized.deliveries.length} entrega${normalized.deliveries.length === 1 ? '' : 's'} • ${normalized.couriers.length} entregador${normalized.couriers.length === 1 ? '' : 'es'} • ${normalized.closings.length} fechamento${normalized.closings.length === 1 ? '' : 's'}`,
          warning: 'Credenciais antigas do arquivo serão ignoradas. A restauração será sincronizada com o Supabase.',
          confirmText: 'Restaurar backup',
          cancelText: 'Cancelar',
          icon: 'database-backup',
          kicker: 'RESTAURAÇÃO VERIFICADA',
          tone: 'warning'
        });
        if (!ok) return;
        db = normalized;
        save();
        await window.XBCloud?.syncNow?.();
        notify('Backup restaurado e enviado para o banco online.');
        setTimeout(() => location.reload(), 900);
      } catch (error) {
        console.error('[X-Burguer] Backup rejeitado:', error);
        notify('O arquivo selecionado não é um backup válido do sistema.', 'error');
      } finally {
        event.target.value = '';
      }
    }, true);
  }

  function installDestructiveGuards() {
    document.getElementById('clearDataBtn')?.addEventListener('click', async event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const ok = await ask({
        title: 'Excluir entregas e fechamentos?',
        text: 'Todas as entregas e todos os fechamentos serão apagados do sistema e do banco online.',
        detail: `${db.deliveries?.length || 0} entrega${db.deliveries?.length === 1 ? '' : 's'} • ${db.closings?.length || 0} fechamento${db.closings?.length === 1 ? '' : 's'}`,
        warning: 'Essa ação é permanente. Baixe um backup antes se precisar preservar esses dados.',
        confirmText: 'Excluir definitivamente',
        cancelText: 'Cancelar',
        icon: 'trash-2',
        kicker: 'LIMPEZA DE DADOS',
        tone: 'danger'
      });
      if (!ok) return;
      db.deliveries = [];
      db.closings = [];
      save();
      if (typeof renderAll === 'function') renderAll();
      if (navigator.onLine) await window.XBCloud?.syncNow?.();
      notify(navigator.onLine ? 'Dados apagados e sincronizados.' : 'Dados apagados neste aparelho. A exclusão será sincronizada quando a internet voltar.');
    }, true);

    document.addEventListener('click', async event => {
      const undo = event.target.closest?.('#undoLastChangeBtn');
      const recovery = event.target.closest?.('#restoreRecoveryBtn');
      if (!undo && !recovery) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const key = undo ? PREVIOUS_KEY : RECOVERY_KEY;
      let payload;
      try { payload = JSON.parse(safeGet(key) || 'null'); } catch {}
      if (!payload?.db) return notify('Não existe uma cópia válida para restaurar.', 'error');

      const normalized = normalizeProductionData(payload.db);
      const ok = await ask({
        title: undo ? 'Desfazer a última alteração?' : 'Restaurar ponto de recuperação?',
        text: 'O estado atual será substituído pela cópia local selecionada.',
        detail: payload.savedAt ? `Cópia de ${new Date(payload.savedAt).toLocaleString('pt-BR')}` : '',
        warning: 'A alteração também será sincronizada com o banco online.',
        confirmText: 'Restaurar dados',
        cancelText: 'Manter estado atual',
        icon: 'rotate-ccw',
        kicker: 'RECUPERAÇÃO SEGURA',
        tone: 'warning'
      });
      if (!ok) return;

      db = normalized;
      save();
      if (typeof renderAll === 'function') renderAll();
      if (navigator.onLine) await window.XBCloud?.syncNow?.();
      notify('Dados restaurados com segurança.');
    }, true);
  }

  hardenCurrentData();
  sanitizeStoredSnapshots();
  updateStaticUi();
  installStyles();
  installSyncBadge();
  installSecureBackupRestore();
  installDestructiveGuards();
  installSyncButton();
  updateSyncUi();

  ['online', 'offline', 'xb:cloud-ready', 'xb:cloud-synced', 'xb:cloud-pulled'].forEach(name => {
    window.addEventListener(name, updateSyncUi);
  });

  // O estado do banco já é atualizado por eventos. Esta checagem é apenas de
  // segurança e roda com baixa frequência, evitando trabalho contínuo de DOM.
  setInterval(() => {
    if (!document.hidden) updateSyncUi();
  }, 6000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) updateSyncUi();
  });
})();
