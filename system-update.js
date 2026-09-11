(() => {
  if (window.__xbSystemUpdateInstalled) return;
  window.__xbSystemUpdateInstalled = true;

  const DRAFT_KEY = 'xb_entregas_delivery_draft_v1';
  const RECOVERY_KEY = 'xb_entregas_recovery_v1';
  const LAST_BACKUP_KEY = 'xb_entregas_last_backup_v1';

  const safeStorageSet = (key, value) => {
    try { localStorage.setItem(key, value); return true; } catch { return false; }
  };
  const safeStorageGet = key => {
    try { return localStorage.getItem(key); } catch { return null; }
  };
  const safeStorageRemove = key => {
    try { localStorage.removeItem(key); } catch {}
  };

  function formatDateTimeFull(value) {
    if (!value) return 'Ainda não realizado';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Ainda não realizado';
    return date.toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }

  // ---------------------------------------------------------------------------
  // PONTO DE RECUPERAÇÃO LOCAL
  // Mantém uma segunda cópia local sempre que o sistema salva alguma alteração.
  // ---------------------------------------------------------------------------
  function writeRecoverySnapshot(source = 'auto') {
    const payload = { savedAt: new Date().toISOString(), source, db };
    const ok = safeStorageSet(RECOVERY_KEY, JSON.stringify(payload));
    updateProtectionCard();
    return ok;
  }

  const originalSave = save;
  save = function xbEnhancedSave() {
    originalSave();
    writeRecoverySnapshot('auto');
  };

  if (!safeStorageGet(RECOVERY_KEY)) writeRecoverySnapshot('initial');

  async function askConfirmation(options) {
    if (typeof window.xbConfirm === 'function') return window.xbConfirm(options);
    return window.confirm(options?.text || options?.title || 'Confirmar ação?');
  }

  function ensureProtectionCard() {
    if (document.getElementById('dataProtectionCard')) return;
    const target = document.querySelector('#page-settings .settings-grid > .stack:nth-child(2)');
    if (!target) return;

    const card = document.createElement('div');
    card.className = 'card data-protection-card';
    card.id = 'dataProtectionCard';
    card.innerHTML = `
      <div class="card-head">
        <div class="card-title-row">
          <div class="card-title-icon">${icon('shield-check')}</div>
          <div><h3>Proteção dos dados</h3><p>Recuperação local e acompanhamento do backup</p></div>
        </div>
      </div>
      <div class="card-body">
        <div class="protection-status">
          <div class="protection-item"><span>Último ponto local</span><strong id="recoveryStatus">-</strong></div>
          <div class="protection-item"><span>Último backup baixado</span><strong id="backupStatus">-</strong></div>
        </div>
        <div class="protection-actions">
          <button class="btn btn-light btn-sm" type="button" id="createRecoveryBtn">${icon('save')}Criar ponto agora</button>
          <button class="btn btn-light btn-sm" type="button" id="restoreRecoveryBtn">${icon('rotate-ccw')}Restaurar ponto local</button>
        </div>
        <p class="protection-note">${icon('info')}<span>O ponto de recuperação fica neste navegador. Continue baixando backups para manter uma cópia fora do computador.</span></p>
      </div>`;

    const dangerCard = target.querySelector('.danger-card');
    if (dangerCard) target.insertBefore(card, dangerCard);
    else target.appendChild(card);

    document.getElementById('createRecoveryBtn')?.addEventListener('click', () => {
      if (writeRecoverySnapshot('manual')) toast('Ponto de recuperação criado.');
      else toast('Não foi possível criar o ponto de recuperação.', 'error');
    });

    document.getElementById('restoreRecoveryBtn')?.addEventListener('click', async () => {
      const raw = safeStorageGet(RECOVERY_KEY);
      if (!raw) return toast('Nenhum ponto de recuperação disponível.', 'error');
      let snapshot;
      try { snapshot = JSON.parse(raw); } catch { return toast('O ponto de recuperação está inválido.', 'error'); }
      if (!snapshot?.db || !Array.isArray(snapshot.db.deliveries) || !Array.isArray(snapshot.db.couriers)) {
        return toast('O ponto de recuperação está inválido.', 'error');
      }

      const ok = await askConfirmation({
        title: 'Restaurar ponto de recuperação?',
        text: 'Os dados atuais serão substituídos pela última cópia local de segurança.',
        detail: `Cópia criada em ${formatDateTimeFull(snapshot.savedAt)}`,
        warning: 'Se quiser preservar os dados atuais, baixe um backup antes de restaurar.',
        confirmText: 'Restaurar dados',
        cancelText: 'Manter dados atuais',
        icon: 'rotate-ccw',
        kicker: 'RECUPERAÇÃO DE DADOS',
        tone: 'warning'
      });
      if (!ok) return;

      db = snapshot.db;
      originalSave();
      toast('Dados restaurados com sucesso.');
      setTimeout(() => location.reload(), 650);
    });

    updateProtectionCard();
    refreshIcons();
  }

  function updateProtectionCard() {
    const recoveryStatus = document.getElementById('recoveryStatus');
    const backupStatus = document.getElementById('backupStatus');
    if (recoveryStatus) {
      try {
        const snapshot = JSON.parse(safeStorageGet(RECOVERY_KEY) || 'null');
        recoveryStatus.textContent = formatDateTimeFull(snapshot?.savedAt);
      } catch { recoveryStatus.textContent = 'Indisponível'; }
    }
    if (backupStatus) backupStatus.textContent = formatDateTimeFull(safeStorageGet(LAST_BACKUP_KEY));
  }

  document.getElementById('backupBtn')?.addEventListener('click', () => {
    safeStorageSet(LAST_BACKUP_KEY, new Date().toISOString());
    updateProtectionCard();
  });

  ensureProtectionCard();

  // ---------------------------------------------------------------------------
  // RASCUNHO AUTOMÁTICO DA NOVA ENTREGA
  // ---------------------------------------------------------------------------
  const deliveryForm = document.getElementById('deliveryForm');
  let draftTimer = null;

  function draftData() {
    return {
      savedAt: new Date().toISOString(),
      address: document.getElementById('deliveryAddress')?.value || '',
      client: document.getElementById('deliveryClient')?.value || '',
      phone: document.getElementById('deliveryPhone')?.value || '',
      courierId: document.getElementById('deliveryCourier')?.value || '',
      fee: document.getElementById('deliveryFee')?.value || '',
      orderValue: document.getElementById('deliveryValue')?.value || '',
      payment: document.querySelector('input[name="payment"]:checked')?.value || 'Dinheiro',
      changeFor: document.getElementById('deliveryChange')?.value || '',
      notes: document.getElementById('deliveryNotes')?.value || ''
    };
  }

  function hasMeaningfulDraft(draft) {
    return Boolean(
      draft?.address?.trim() || draft?.client?.trim() || draft?.phone?.trim() || draft?.courierId ||
      Number(draft?.orderValue || 0) > 0 || draft?.changeFor || draft?.notes?.trim()
    );
  }

  function setDraftStatus(text, saved = false) {
    const status = document.getElementById('deliveryDraftStatus');
    if (!status) return;
    status.classList.toggle('saved', saved);
    status.innerHTML = `${icon(saved ? 'circle-check' : 'save')}<span>${esc(text)}</span>`;
    refreshIcons();
  }

  function saveDraft() {
    const draft = draftData();
    if (!hasMeaningfulDraft(draft)) {
      safeStorageRemove(DRAFT_KEY);
      setDraftStatus('Rascunho automático ativo');
      return;
    }
    if (safeStorageSet(DRAFT_KEY, JSON.stringify(draft))) {
      setDraftStatus('Rascunho salvo neste navegador', true);
    }
  }

  function scheduleDraftSave() {
    setDraftStatus('Salvando rascunho...');
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 350);
  }

  function restoreDraft() {
    const raw = safeStorageGet(DRAFT_KEY);
    if (!raw) return;
    let draft;
    try { draft = JSON.parse(raw); } catch { safeStorageRemove(DRAFT_KEY); return; }
    if (!hasMeaningfulDraft(draft)) return;

    const savedAt = new Date(draft.savedAt || 0);
    if (!Number.isNaN(savedAt.getTime()) && Date.now() - savedAt.getTime() > 7 * 24 * 60 * 60 * 1000) {
      safeStorageRemove(DRAFT_KEY);
      return;
    }

    const setValue = (id, value) => {
      const element = document.getElementById(id);
      if (element && value !== undefined && value !== null) element.value = value;
    };
    setValue('deliveryAddress', draft.address);
    setValue('deliveryClient', draft.client);
    setValue('deliveryPhone', draft.phone);
    setValue('deliveryCourier', draft.courierId);
    setValue('deliveryFee', draft.fee);
    setValue('deliveryValue', draft.orderValue);
    setValue('deliveryChange', draft.changeFor);
    setValue('deliveryNotes', draft.notes);
    document.querySelectorAll('input[name="payment"]').forEach(input => { input.checked = input.value === draft.payment; });
    syncPaymentFields();
    setDraftStatus('Rascunho recuperado', true);
    toast('Rascunho da entrega recuperado.');
  }

  if (deliveryForm) {
    const actions = deliveryForm.querySelector('.form-actions');
    if (actions && !document.getElementById('deliveryDraftStatus')) {
      const status = document.createElement('span');
      status.className = 'draft-status';
      status.id = 'deliveryDraftStatus';
      status.innerHTML = `${icon('save')}<span>Rascunho automático ativo</span>`;
      actions.appendChild(status);
    }
    deliveryForm.addEventListener('input', scheduleDraftSave, true);
    deliveryForm.addEventListener('change', scheduleDraftSave, true);
    deliveryForm.addEventListener('submit', () => {
      clearTimeout(draftTimer);
      safeStorageRemove(DRAFT_KEY);
      setDraftStatus('Rascunho automático ativo');
    });
    restoreDraft();
  }

  // ---------------------------------------------------------------------------
  // FORMATAÇÃO DE TELEFONES
  // ---------------------------------------------------------------------------
  function formatPhone(value) {
    const digits = String(value || '').replace(/\D/g, '').slice(0, 11);
    if (!digits) return '';
    if (digits.length <= 2) return `(${digits}`;
    if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }

  ['deliveryPhone', 'editDeliveryPhone', 'courierPhone'].forEach(id => {
    const input = document.getElementById(id);
    if (!input) return;
    input.dataset.autoFormat = 'phone';
    input.setAttribute('inputmode', 'tel');
    input.addEventListener('input', () => {
      const formatted = formatPhone(input.value);
      if (input.value !== formatted) input.value = formatted;
    });
  });

  // ---------------------------------------------------------------------------
  // ALERTAS INTELIGENTES NO DASHBOARD
  // ---------------------------------------------------------------------------
  function ensureOpsPulse() {
    let pulse = document.getElementById('opsPulse');
    if (pulse) return pulse;
    const stats = document.getElementById('dashboardStats');
    if (!stats) return null;
    pulse = document.createElement('div');
    pulse.id = 'opsPulse';
    pulse.className = 'ops-pulse';
    stats.insertAdjacentElement('afterend', pulse);
    pulse.addEventListener('click', event => {
      if (!event.target.closest('[data-open-deliveries]')) return;
      go('deliveries');
      const dateFilter = document.getElementById('dateFilter');
      if (dateFilter) dateFilter.value = 'today';
      renderDeliveries();
    });
    return pulse;
  }

  function renderOpsPulse() {
    const pulse = ensureOpsPulse();
    if (!pulse) return;
    const today = todayDeliveries();
    const active = today.filter(item => ['Aguardando', 'Em rota'].includes(item.status));
    const withoutCourier = active.filter(item => !item.courierId);
    const delayed = active.filter(item => Date.now() - new Date(item.createdAt).getTime() >= 30 * 60 * 1000);
    const withChange = active.filter(item => item.payment === 'Dinheiro' && getChangeFor(item));

    const chips = [];
    if (withoutCourier.length) chips.push(`<span class="ops-chip danger">${icon('user-x')} ${withoutCourier.length} sem entregador</span>`);
    if (delayed.length) chips.push(`<span class="ops-chip warn">${icon('clock-alert')} ${delayed.length} há mais de 30 min</span>`);
    if (withChange.length) chips.push(`<span class="ops-chip info">${icon('banknote')} ${withChange.length} com troco</span>`);
    if (!chips.length) chips.push(`<span class="ops-chip good">${icon('circle-check-big')} Operação sem alertas</span>`);

    pulse.innerHTML = `
      <div class="ops-pulse-main">
        <div class="ops-pulse-icon">${icon('radar')}</div>
        <div class="ops-pulse-copy"><strong>Atenção da operação</strong><small>O sistema destaca automaticamente o que merece conferência agora.</small></div>
      </div>
      <div class="ops-pulse-items">${chips.join('')}</div>
      <button class="btn btn-light btn-sm" type="button" data-open-deliveries>${icon('arrow-right')}Ver entregas</button>`;
    refreshIcons();
  }

  const originalRenderDashboard = renderDashboard;
  renderDashboard = function xbEnhancedRenderDashboard() {
    originalRenderDashboard();
    renderOpsPulse();
  };
  renderOpsPulse();

  // Atalhos simples para uso diário: Ctrl/Cmd + K abre a busca de entregas.
  document.addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return;
    if (document.querySelector('.modal.open,.xb-confirm-overlay.open')) return;
    event.preventDefault();
    go('deliveries');
    const search = document.getElementById('deliverySearch');
    if (search) setTimeout(() => search.focus(), 60);
  });

  refreshIcons();
})();
