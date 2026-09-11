(() => {
  if (window.__xbSystemAuditInstalled) return;
  window.__xbSystemAuditInstalled = true;

  const AUDIT_VERSION = 1;
  const PREVIOUS_STATE_KEY = 'xb_entregas_previous_state_v1';
  const PAYMENT_METHODS = ['Dinheiro', 'PIX', 'Cartão', 'Pago online'];
  const DELIVERY_STATUSES = ['Aguardando', 'Em rota', 'Entregue', 'Cancelada'];

  const safeGet = key => {
    try { return localStorage.getItem(key); } catch { return null; }
  };
  const safeSet = (key, value) => {
    try { localStorage.setItem(key, value); return true; } catch { return false; }
  };
  const finiteNumber = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };
  const nonNegative = value => Math.max(0, finiteNumber(value, 0));
  const asArray = value => Array.isArray(value) ? value : [];

  function normalizeDatabase(input) {
    const base = initialDB();
    const source = input && typeof input === 'object' ? input : {};
    const settings = { ...base.settings, ...(source.settings || {}) };
    settings.defaultFee = nonNegative(settings.defaultFee);
    settings.storeName = String(settings.storeName || base.settings.storeName).trim() || base.settings.storeName;
    settings.email = String(settings.email || base.settings.email).trim() || base.settings.email;
    settings.password = String(settings.password || base.settings.password);
    settings.dataVersion = Math.max(AUDIT_VERSION, finiteNumber(settings.dataVersion, 0));

    const courierIds = new Set();
    const couriers = asArray(source.couriers).map((item, index) => {
      const data = item && typeof item === 'object' ? item : {};
      let id = String(data.id || '').trim();
      if (!id || courierIds.has(id)) id = uid(`courier${index + 1}`);
      courierIds.add(id);
      return {
        id,
        name: String(data.name || `Entregador ${index + 1}`).trim() || `Entregador ${index + 1}`,
        phone: String(data.phone || '').trim(),
        fee: nonNegative(data.fee),
        active: data.active !== false
      };
    });

    const rawDeliveries = asArray(source.deliveries);
    const validCodes = rawDeliveries
      .map(item => Math.floor(finiteNumber(item?.code, 0)))
      .filter(code => code > 0);
    let maxCode = validCodes.length ? Math.max(...validCodes) : 0;
    const usedCodes = new Set();
    const deliveryIds = new Set();

    const deliveries = rawDeliveries.map((item, index) => {
      const data = item && typeof item === 'object' ? item : {};
      let id = String(data.id || '').trim();
      if (!id || deliveryIds.has(id)) id = uid(`delivery${index + 1}`);
      deliveryIds.add(id);

      let code = Math.floor(finiteNumber(data.code, 0));
      if (code <= 0 || usedCodes.has(code)) code = ++maxCode;
      usedCodes.add(code);
      maxCode = Math.max(maxCode, code);

      const createdAt = !Number.isNaN(new Date(data.createdAt).getTime()) ? data.createdAt : new Date().toISOString();
      const updatedAt = !Number.isNaN(new Date(data.updatedAt).getTime()) ? data.updatedAt : createdAt;
      const payment = PAYMENT_METHODS.includes(data.payment) ? data.payment : 'Dinheiro';
      const status = DELIVERY_STATUSES.includes(data.status) ? data.status : 'Aguardando';
      const courierId = data.courierId && courierIds.has(String(data.courierId)) ? String(data.courierId) : null;
      const rawChange = data.changeFor === '' || data.changeFor === null || data.changeFor === undefined ? '' : nonNegative(data.changeFor);

      return {
        ...data,
        id,
        code,
        client: String(data.client || '').trim(),
        phone: String(data.phone || '').trim(),
        address: String(data.address || '').trim(),
        reference: String(data.reference || '').trim(),
        courierId,
        fee: nonNegative(data.fee),
        orderValue: nonNegative(data.orderValue),
        payment,
        changeFor: payment === 'Dinheiro' ? rawChange : '',
        notes: String(data.notes || '').trim(),
        status,
        createdAt,
        updatedAt
      };
    });

    const closings = asArray(source.closings)
      .filter(item => item && typeof item === 'object')
      .map(item => ({ ...item }));

    const nextFromSettings = Math.floor(finiteNumber(settings.nextDeliveryCode, 0));
    settings.nextDeliveryCode = Math.max(maxCode + 1, nextFromSettings > 0 ? nextFromSettings : 1);

    return { settings, couriers, deliveries, closings };
  }

  // Mantém o estado anterior antes de cada gravação, permitindo desfazer uma alteração acidental.
  const saveBeforeAudit = save;
  save = function xbAuditedSave() {
    try {
      const previousRaw = safeGet(DB_KEY);
      const currentRaw = JSON.stringify(db);
      if (previousRaw && previousRaw !== currentRaw) {
        let previousDb = null;
        try { previousDb = JSON.parse(previousRaw); } catch {}
        if (previousDb) {
          safeSet(PREVIOUS_STATE_KEY, JSON.stringify({
            savedAt: new Date().toISOString(),
            db: previousDb
          }));
        }
      }
      saveBeforeAudit();
      updateAuditCard();
    } catch (error) {
      console.error('[X-Burguer] Falha ao salvar dados:', error);
      toast('Não foi possível salvar os dados. Faça um backup e tente novamente.', 'error');
      throw error;
    }
  };

  // Sequência de pedidos não volta para trás quando uma entrega é excluída.
  nextCode = function xbStableNextCode() {
    const currentMax = db.deliveries.reduce((max, item) => Math.max(max, Math.floor(finiteNumber(item.code, 0))), 0);
    const configured = Math.floor(finiteNumber(db.settings?.nextDeliveryCode, 0));
    const code = Math.max(currentMax + 1, configured > 0 ? configured : 1);
    db.settings.nextDeliveryCode = code + 1;
    return code;
  };

  function runDataAudit() {
    const before = JSON.stringify(db);
    const normalized = normalizeDatabase(db);
    const after = JSON.stringify(normalized);
    db = normalized;
    if (before !== after) {
      save();
      console.info('[X-Burguer] Dados normalizados durante a revisão do sistema.');
    }
  }

  function invalidate(element, message) {
    if (element) {
      element.classList.add('xb-invalid-field');
      element.focus();
      setTimeout(() => element.classList.remove('xb-invalid-field'), 1800);
    }
    toast(message, 'error');
    return false;
  }

  function validateDeliveryForm(editing = false) {
    const prefix = editing ? 'editDelivery' : 'delivery';
    const address = document.getElementById(`${prefix}Address`);
    const value = document.getElementById(`${prefix}Value`);
    const fee = document.getElementById(`${prefix}Fee`);
    const change = document.getElementById(`${prefix}Change`);
    const payment = editing
      ? document.getElementById('editDeliveryPayment')?.value
      : document.querySelector('input[name="payment"]:checked')?.value;

    if (!address?.value.trim()) return invalidate(address, 'Informe o endereço da entrega.');
    if (finiteNumber(value?.value, 0) <= 0) return invalidate(value, 'Informe um valor de pedido maior que zero.');
    if (finiteNumber(fee?.value, 0) < 0) return invalidate(fee, 'A taxa de entrega não pode ser negativa.');

    if (payment === 'Dinheiro' && change?.value !== '') {
      const orderValue = finiteNumber(value?.value, 0);
      const changeFor = finiteNumber(change.value, 0);
      if (changeFor < orderValue) {
        return invalidate(change, `O valor para troco deve ser igual ou maior que ${money(orderValue)}.`);
      }
    }
    return true;
  }

  document.getElementById('deliveryForm')?.addEventListener('submit', event => {
    if (validateDeliveryForm(false)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  document.getElementById('deliveryEditForm')?.addEventListener('submit', event => {
    if (validateDeliveryForm(true)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  // Uma entrega só pode sair para rota/concluir quando houver entregador definido.
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-delivery-action="advance"]');
    if (!button) return;
    const item = db.deliveries.find(delivery => delivery.id === button.dataset.id);
    if (!item || item.courierId) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    toast('Selecione um entregador antes de avançar o status da entrega.', 'error');
  }, true);

  async function ask(options) {
    if (typeof window.xbConfirm === 'function') return window.xbConfirm(options);
    return window.confirm(options?.text || options?.title || 'Confirmar ação?');
  }

  // Restauração de backup revisada: normaliza o arquivo antes de substituir os dados atuais.
  const backupFile = document.getElementById('backupFile');
  backupFile?.addEventListener('change', async event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const imported = JSON.parse(await file.text());
      if (!imported || !Array.isArray(imported.deliveries) || !Array.isArray(imported.couriers)) {
        throw new Error('Formato de backup inválido');
      }
      const normalized = normalizeDatabase(imported);
      const ok = await ask({
        title: 'Restaurar este backup?',
        text: 'Os dados atuais serão substituídos pelo conteúdo do arquivo selecionado.',
        detail: `${normalized.deliveries.length} entrega${normalized.deliveries.length === 1 ? '' : 's'} • ${normalized.couriers.length} entregador${normalized.couriers.length === 1 ? '' : 'es'} • ${normalized.closings.length} fechamento${normalized.closings.length === 1 ? '' : 's'}`,
        warning: 'O sistema fará uma cópia do estado atual antes de restaurar o arquivo.',
        confirmText: 'Restaurar backup',
        cancelText: 'Cancelar',
        icon: 'database-backup',
        kicker: 'RESTAURAÇÃO SEGURA',
        tone: 'warning'
      });
      if (!ok) return;
      db = normalized;
      save();
      toast('Backup restaurado e verificado.');
      setTimeout(() => location.reload(), 650);
    } catch (error) {
      console.error('[X-Burguer] Backup inválido:', error);
      toast('O arquivo selecionado não é um backup válido do sistema.', 'error');
    } finally {
      event.target.value = '';
    }
  }, true);

  function formatSnapshotDate(value) {
    if (!value) return 'Ainda não disponível';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Ainda não disponível';
    return date.toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }

  function ensureAuditCard() {
    const protection = document.getElementById('dataProtectionCard');
    const body = protection?.querySelector('.card-body');
    if (!body || document.getElementById('auditIntegrityRow')) return;

    const status = body.querySelector('.protection-status');
    if (status) {
      const row = document.createElement('div');
      row.className = 'protection-item audit-integrity-row';
      row.id = 'auditIntegrityRow';
      row.innerHTML = '<span>Integridade do sistema</span><strong id="auditIntegrityStatus">Verificada</strong>';
      status.appendChild(row);

      const previous = document.createElement('div');
      previous.className = 'protection-item';
      previous.innerHTML = '<span>Estado anterior</span><strong id="previousStateStatus">Ainda não disponível</strong>';
      status.appendChild(previous);
    }

    const actions = body.querySelector('.protection-actions');
    if (actions) {
      const undo = document.createElement('button');
      undo.className = 'btn btn-light btn-sm';
      undo.type = 'button';
      undo.id = 'undoLastChangeBtn';
      undo.innerHTML = `${icon('undo-2')}Desfazer última alteração`;
      actions.appendChild(undo);
      undo.addEventListener('click', restorePreviousState);
    }
    updateAuditCard();
    refreshIcons();
  }

  function updateAuditCard() {
    const status = document.getElementById('auditIntegrityStatus');
    if (status) status.textContent = 'Verificada';
    const previousStatus = document.getElementById('previousStateStatus');
    if (previousStatus) {
      try {
        const snapshot = JSON.parse(safeGet(PREVIOUS_STATE_KEY) || 'null');
        previousStatus.textContent = formatSnapshotDate(snapshot?.savedAt);
      } catch {
        previousStatus.textContent = 'Indisponível';
      }
    }
  }

  async function restorePreviousState() {
    let snapshot;
    try { snapshot = JSON.parse(safeGet(PREVIOUS_STATE_KEY) || 'null'); } catch {}
    if (!snapshot?.db) return toast('Ainda não existe uma alteração anterior para restaurar.', 'error');
    const normalized = normalizeDatabase(snapshot.db);
    const ok = await ask({
      title: 'Desfazer a última alteração?',
      text: 'O sistema voltará ao estado salvo imediatamente antes da última gravação.',
      detail: `Estado anterior de ${formatSnapshotDate(snapshot.savedAt)}`,
      warning: 'O estado atual também ficará guardado, permitindo desfazer novamente se necessário.',
      confirmText: 'Restaurar estado anterior',
      cancelText: 'Manter estado atual',
      icon: 'undo-2',
      kicker: 'RECUPERAÇÃO RÁPIDA',
      tone: 'warning'
    });
    if (!ok) return;
    db = normalized;
    save();
    toast('Estado anterior restaurado.');
    setTimeout(() => location.reload(), 650);
  }

  // Quando o dia está fechado, o ticket médio usa o snapshot salvo no fechamento.
  const renderClosingBeforeAudit = renderClosing;
  renderClosing = function xbAuditedRenderClosing() {
    renderClosingBeforeAudit();
    const closing = db.closings.find(item => item.date === dateKey());
    const details = closing?.detailsV2;
    if (!details) return;
    const count = finiteNumber(details.totalDeliveries, 0);
    const total = finiteNumber(details.totalOrderValue, 0);
    const average = count > 0 ? total / count : 0;
    const cards = [...document.querySelectorAll('#closingStats .stat')];
    const ticket = cards.find(card => card.querySelector('.stat-label')?.textContent.trim() === 'Ticket médio');
    const value = ticket?.querySelector('.stat-value');
    if (value) value.textContent = money(average);
  };

  // Pequenos estilos de validação e indicador da revisão.
  if (!document.getElementById('xbSystemAuditStyle')) {
    const style = document.createElement('style');
    style.id = 'xbSystemAuditStyle';
    style.textContent = `
      .xb-invalid-field{border-color:#c91620!important;box-shadow:0 0 0 4px rgba(201,22,32,.11)!important;background:#fff8f8!important}
      .audit-integrity-row strong{color:#14784d!important}
      #undoLastChangeBtn svg{width:15px;height:15px}
    `;
    document.head.appendChild(style);
  }

  runDataAudit();
  ensureAuditCard();
  updateAuditCard();
  renderAll();
  refreshIcons();
})();
