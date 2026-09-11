(() => {
  if (window.__xbProductionHardeningInstalled) return;
  window.__xbProductionHardeningInstalled = true;

  const config = window.XB_SUPABASE_CONFIG || {};
  const cloudEnabled = Boolean(config.enabled);
  const DRAFT_KEY = 'xb_entregas_delivery_draft_v1';
  const LAST_BACKUP_KEY = 'xb_entregas_last_backup_v1';
  const SNAPSHOT_KEYS = [
    'xb_entregas_recovery_v1',
    'xb_entregas_previous_state_v1',
    'xb_cloud_pre_migration_backup_v1'
  ];

  const nowIso = () => new Date().toISOString();
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

  function safeRemove(key) {
    try { localStorage.removeItem(key); } catch {}
  }

  function scrubSettingsSecrets(target) {
    if (!cloudEnabled || !target?.settings) return false;
    if (!target.settings.password) return false;
    target.settings.password = '';
    return true;
  }

  function sanitizeStoredSnapshot(key) {
    const raw = safeGet(key);
    if (!raw) return;
    try {
      const payload = JSON.parse(raw);
      const target = payload?.db && typeof payload.db === 'object' ? payload.db : payload;
      if (scrubSettingsSecrets(target)) safeSet(key, JSON.stringify(payload));
    } catch {}
  }

  function removeLegacySampleData() {
    if (!cloudEnabled || !Array.isArray(db?.couriers)) return false;
    if (db.deliveries?.length || db.closings?.length || db.couriers.length !== 3) return false;

    const expected = new Map([
      ['carlos', 'Carlos Oliveira'],
      ['ana', 'Ana Paula'],
      ['bruno', 'Bruno Santos']
    ]);
    const isExactSample = db.couriers.every(item => expected.get(String(item.id)) === String(item.name));
    if (!isExactSample) return false;
    db.couriers = [];
    return true;
  }

  function migrateLegacyStatuses() {
    let changed = false;
    (db?.deliveries || []).forEach(item => {
      if (item.status !== 'Em rota') return;
      item.status = 'Aguardando';
      item.updatedAt = nowIso();
      changed = true;
    });
    return changed;
  }

  function hardenCurrentState() {
    if (!db || typeof db !== 'object') return;
    let changed = false;
    changed = scrubSettingsSecrets(db) || changed;
    changed = removeLegacySampleData() || changed;
    changed = migrateLegacyStatuses() || changed;
    if (changed && typeof save === 'function') save();
  }

  // O sistema em produção nunca libera o painel apenas por uma sessão local antiga.
  // database-cloud-v2.js valida a sessão do Supabase e exibe o painel depois.
  if (cloudEnabled) {
    try { sessionStorage.removeItem(SESSION_KEY); } catch {}
    document.getElementById('appView')?.classList.add('hidden');
    document.getElementById('loginView')?.classList.remove('hidden');
  }

  hardenCurrentState();
  SNAPSHOT_KEYS.forEach(sanitizeStoredSnapshot);

  // Garante que nenhuma senha antiga volte a ser gravada no localStorage por módulos legados.
  if (cloudEnabled && typeof save === 'function' && !window.__xbSecretSafeSaveWrapped) {
    window.__xbSecretSafeSaveWrapped = true;
    const previousSave = save;
    save = function xbSecretSafeSave() {
      scrubSettingsSecrets(db);
      previousSave();
    };
  }

  function updateStaticProductionUi() {
    const statusFilter = document.getElementById('statusFilter');
    if (statusFilter) {
      [...statusFilter.options].forEach(option => {
        if (option.value === 'Em rota' || option.textContent.trim() === 'Em rota') option.remove();
      });
      const pending = [...statusFilter.options].find(option => option.value === 'Aguardando');
      if (pending) pending.textContent = 'Pagamento a conferir';
    }

    const databaseCard = document.getElementById('databaseReadinessCard');
    if (databaseCard) {
      const title = databaseCard.querySelector('.card-head h3');
      const subtitle = databaseCard.querySelector('.card-head p');
      if (title) title.textContent = 'Banco de dados';
      if (subtitle) subtitle.textContent = 'Supabase online com cache local de segurança';
      const firstRow = databaseCard.querySelector('.db-status-row');
      if (firstRow) {
        const label = firstRow.querySelector('span');
        const value = firstRow.querySelector('strong');
        if (label) label.textContent = 'Cache local de segurança';
        if (value) {
          value.textContent = 'Ativo neste aparelho';
          value.classList.remove('db-local');
          value.classList.add('db-ready');
        }
      }
      document.getElementById('databaseExportMigrationBtn')?.remove();
      const note = databaseCard.querySelector('.db-note span');
      if (note) note.textContent = 'Os dados operacionais são sincronizados automaticamente com o Supabase. A cópia local é usada apenas como apoio offline e recuperação.';
    }

    const loginEmail = document.getElementById('loginEmail');
    if (loginEmail && loginEmail.placeholder === 'admin@xburguer.com') {
      loginEmail.placeholder = 'Seu e-mail de acesso';
    }
  }

  updateStaticProductionUi();

  // Backup de produção: nunca exporta senha nem credenciais de autenticação.
  document.getElementById('backupBtn')?.addEventListener('click', event => {
    if (!cloudEnabled) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const backup = window.XBDataBridge?.snapshot
      ? window.XBDataBridge.snapshot()
      : clone(db);
    backup.settings = { ...(backup.settings || {}) };
    delete backup.settings.password;
    delete backup.settings.email;
    backup.backupFormat = 'xburguer-backup-v2';
    backup.backupGeneratedAt = nowIso();

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `xburguer-backup-${dateKey()}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    const savedAt = nowIso();
    safeSet(LAST_BACKUP_KEY, savedAt);
    const backupStatus = document.getElementById('backupStatus');
    if (backupStatus) backupStatus.textContent = new Date(savedAt).toLocaleString('pt-BR');
    notify('Backup seguro gerado sem incluir senha de acesso.');
  }, true);

  // Corrige a restauração do ponto local para que ela passe pelo save() definitivo
  // e, portanto, também seja sincronizada com o Supabase.
  document.addEventListener('click', async event => {
    const button = event.target.closest?.('#restoreRecoveryBtn');
    if (!button || !cloudEnabled) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const raw = safeGet('xb_entregas_recovery_v1');
    if (!raw) return notify('Nenhum ponto de recuperação disponível.', 'error');

    let snapshot;
    try { snapshot = JSON.parse(raw); } catch { return notify('O ponto de recuperação está inválido.', 'error'); }
    if (!snapshot?.db || !Array.isArray(snapshot.db.deliveries) || !Array.isArray(snapshot.db.couriers)) {
      return notify('O ponto de recuperação está inválido.', 'error');
    }

    const normalized = window.XBDataBridge?.normalize
      ? window.XBDataBridge.normalize(snapshot.db)
      : clone(snapshot.db);
    scrubSettingsSecrets(normalized);

    const ok = typeof window.xbConfirm === 'function'
      ? await window.xbConfirm({
          title: 'Restaurar ponto de recuperação?',
          text: 'Os dados atuais serão substituídos pela última cópia local e a alteração será sincronizada com o banco online.',
          detail: snapshot.savedAt ? `Cópia criada em ${new Date(snapshot.savedAt).toLocaleString('pt-BR')}` : '',
          warning: 'Baixe um backup antes se quiser preservar o estado atual.',
          confirmText: 'Restaurar dados',
          cancelText: 'Manter dados atuais',
          icon: 'rotate-ccw',
          kicker: 'RECUPERAÇÃO DE DADOS',
          tone: 'warning'
        })
      : window.confirm('Restaurar o último ponto de recuperação?');
    if (!ok) return;

    db = normalized;
    save();
    notify('Dados restaurados. A sincronização online será atualizada automaticamente.');
    setTimeout(() => location.reload(), 900);
  }, true);

  // Mantém timestamps locais úteis para conciliação entre vários aparelhos.
  document.getElementById('courierForm')?.addEventListener('submit', () => {
    queueMicrotask(() => {
      const id = document.getElementById('courierId')?.value || '';
      const item = id ? courier(id) : db.couriers?.[db.couriers.length - 1];
      if (!item) return;
      const now = nowIso();
      if (!item.createdAt) item.createdAt = now;
      item.updatedAt = now;
      save();
    });
  });

  // Ao reabrir um pedido entregue, limpa a confirmação anterior; ao concluir
  // administrativamente, garante que exista horário de confirmação.
  document.getElementById('deliveryEditForm')?.addEventListener('submit', () => {
    queueMicrotask(() => {
      const id = document.getElementById('editDeliveryId')?.value;
      const item = (db.deliveries || []).find(delivery => delivery.id === id);
      if (!item) return;
      let changed = false;
      if (item.status === 'Entregue' && !item.paymentConfirmedAt) {
        item.paymentConfirmedAt = nowIso();
        changed = true;
      }
      if (item.status !== 'Entregue' && item.paymentConfirmedAt) {
        item.paymentConfirmedAt = '';
        changed = true;
      }
      if (changed) {
        item.updatedAt = nowIso();
        save();
        if (typeof renderAll === 'function') renderAll();
      }
    });
  });

  window.addEventListener('xb:delivery-created', () => {
    safeRemove(DRAFT_KEY);
    const status = document.getElementById('deliveryDraftStatus');
    if (status) status.innerHTML = `${typeof icon === 'function' ? icon('save') : ''}<span>Rascunho automático ativo</span>`;
  });

  window.XBProduction = Object.freeze({
    sanitizeBackup: source => {
      const safe = clone(source);
      if (safe?.settings) {
        delete safe.settings.password;
        delete safe.settings.email;
      }
      return safe;
    },
    clearDraft: () => safeRemove(DRAFT_KEY)
  });
})();
