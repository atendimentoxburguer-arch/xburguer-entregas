(() => {
  if (window.__xbDatabasePrepInstalled) return;
  window.__xbDatabasePrepInstalled = true;

  const SCHEMA_VERSION = 4;
  const PAYMENT_METHODS = ['Dinheiro', 'PIX', 'Cartão', 'Pago online'];
  const VALID_STATUSES = ['Aguardando', 'Entregue', 'Cancelada'];
  const DEVICE_KEY = 'xb_entregas_device_id_v1';

  const finite = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };
  const nonNegative = value => Math.max(0, finite(value, 0));
  const asArray = value => Array.isArray(value) ? value : [];
  const text = value => String(value ?? '').trim();
  const validDate = value => !Number.isNaN(new Date(value).getTime());
  const nowIso = () => new Date().toISOString();
  const clone = value => JSON.parse(JSON.stringify(value));

  function deviceId() {
    try {
      let id = localStorage.getItem(DEVICE_KEY);
      if (!id) {
        id = `device_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
        localStorage.setItem(DEVICE_KEY, id);
      }
      return id;
    } catch {
      return 'device_unknown';
    }
  }

  function normalizeStatus(status) {
    if (status === 'Em rota') return 'Aguardando';
    return VALID_STATUSES.includes(status) ? status : 'Aguardando';
  }

  function normalizeDatabase(source) {
    const input = source && typeof source === 'object' ? source : {};
    const base = initialDB();
    const rawSettings = input.settings && typeof input.settings === 'object' ? input.settings : {};

    const settings = {
      ...base.settings,
      ...rawSettings,
      storeName: text(rawSettings.storeName || base.settings.storeName) || base.settings.storeName,
      defaultFee: nonNegative(rawSettings.defaultFee ?? base.settings.defaultFee),
      dataVersion: Math.max(SCHEMA_VERSION, Math.floor(finite(rawSettings.dataVersion, 0)))
    };

    const courierIds = new Set();
    const couriers = asArray(input.couriers).map((item, index) => {
      const sourceItem = item && typeof item === 'object' ? item : {};
      let id = text(sourceItem.id);
      if (!id || courierIds.has(id)) id = uid(`courier${index + 1}`);
      courierIds.add(id);
      return {
        ...sourceItem,
        id,
        name: text(sourceItem.name) || `Entregador ${index + 1}`,
        phone: text(sourceItem.phone),
        fee: nonNegative(sourceItem.fee),
        active: sourceItem.active !== false,
        createdAt: validDate(sourceItem.createdAt) ? sourceItem.createdAt : undefined,
        updatedAt: validDate(sourceItem.updatedAt) ? sourceItem.updatedAt : undefined
      };
    });

    const rawDeliveries = asArray(input.deliveries);
    const usedIds = new Set();
    const usedCodes = new Set();
    let maxCode = rawDeliveries.reduce((max, item) => Math.max(max, Math.floor(finite(item?.code, 0))), 0);

    const deliveries = rawDeliveries.map((item, index) => {
      const sourceItem = item && typeof item === 'object' ? item : {};
      let id = text(sourceItem.id);
      if (!id || usedIds.has(id)) id = uid(`delivery${index + 1}`);
      usedIds.add(id);

      let code = Math.floor(finite(sourceItem.code, 0));
      if (code <= 0 || usedCodes.has(code)) code = ++maxCode;
      usedCodes.add(code);
      maxCode = Math.max(maxCode, code);

      const createdAt = validDate(sourceItem.createdAt) ? sourceItem.createdAt : nowIso();
      const updatedAt = validDate(sourceItem.updatedAt) ? sourceItem.updatedAt : createdAt;
      const payment = PAYMENT_METHODS.includes(sourceItem.payment) ? sourceItem.payment : 'Dinheiro';
      const courierId = sourceItem.courierId && courierIds.has(String(sourceItem.courierId))
        ? String(sourceItem.courierId)
        : null;
      const rawChange = sourceItem.changeFor === '' || sourceItem.changeFor === null || sourceItem.changeFor === undefined
        ? ''
        : nonNegative(sourceItem.changeFor);

      return {
        ...sourceItem,
        id,
        code,
        client: text(sourceItem.client),
        phone: text(sourceItem.phone),
        address: text(sourceItem.address),
        reference: text(sourceItem.reference),
        courierId,
        fee: nonNegative(sourceItem.fee),
        orderValue: nonNegative(sourceItem.orderValue),
        payment,
        changeFor: payment === 'Dinheiro' ? rawChange : '',
        notes: text(sourceItem.notes),
        status: normalizeStatus(sourceItem.status),
        createdAt,
        updatedAt,
        paymentConfirmedAt: validDate(sourceItem.paymentConfirmedAt) ? sourceItem.paymentConfirmedAt : ''
      };
    });

    const closings = asArray(input.closings)
      .filter(item => item && typeof item === 'object')
      .map(item => ({
        ...item,
        date: text(item.date),
        closedAt: validDate(item.closedAt) ? item.closedAt : item.closedAt || '',
        reopenedAt: validDate(item.reopenedAt) ? item.reopenedAt : item.reopenedAt || ''
      }));

    const configuredNext = Math.floor(finite(settings.nextDeliveryCode, 0));
    settings.nextDeliveryCode = Math.max(maxCode + 1, configuredNext > 0 ? configuredNext : 1);

    return { settings, couriers, deliveries, closings };
  }

  function diagnostics(source = db) {
    const issues = [];
    const warnings = [];
    const snapshot = normalizeDatabase(source);

    const deliveryIds = new Set();
    const codes = new Set();
    snapshot.deliveries.forEach(item => {
      if (deliveryIds.has(item.id)) issues.push(`ID de entrega duplicado: ${item.id}`);
      deliveryIds.add(item.id);
      if (codes.has(item.code)) issues.push(`Número de pedido duplicado: ${item.code}`);
      codes.add(item.code);
      if (!item.address) warnings.push(`Pedido #${item.code} está sem endereço.`);
      if (item.orderValue <= 0) warnings.push(`Pedido #${item.code} está com valor zerado.`);
      if (item.courierId && !snapshot.couriers.some(courierItem => courierItem.id === item.courierId)) {
        issues.push(`Pedido #${item.code} aponta para um entregador inexistente.`);
      }
    });

    const closingDates = new Set();
    snapshot.closings.forEach(item => {
      if (!item.date) warnings.push('Existe um fechamento sem data definida.');
      if (item.date && closingDates.has(item.date)) issues.push(`Existe mais de um fechamento para ${item.date}.`);
      closingDates.add(item.date);
    });

    return {
      ok: issues.length === 0,
      issues,
      warnings,
      counts: {
        deliveries: snapshot.deliveries.length,
        couriers: snapshot.couriers.length,
        closings: snapshot.closings.length
      }
    };
  }

  function toMigrationPackage(source = db) {
    const snapshot = normalizeDatabase(source);
    return {
      format: 'xburguer-supabase-migration-v1',
      generatedAt: nowIso(),
      schemaVersion: SCHEMA_VERSION,
      deviceId: deviceId(),
      settings: {
        store_name: snapshot.settings.storeName,
        default_fee: snapshot.settings.defaultFee,
        next_delivery_code: snapshot.settings.nextDeliveryCode
      },
      couriers: snapshot.couriers.map(item => ({
        id: item.id,
        name: item.name,
        phone: item.phone,
        fee: item.fee,
        active: item.active,
        created_at: item.createdAt || null,
        updated_at: item.updatedAt || null
      })),
      deliveries: snapshot.deliveries.map(item => ({
        id: item.id,
        code: item.code,
        client: item.client,
        phone: item.phone,
        address: item.address,
        reference: item.reference,
        courier_id: item.courierId,
        fee: item.fee,
        order_value: item.orderValue,
        payment: item.payment,
        change_for: item.changeFor === '' ? null : item.changeFor,
        notes: item.notes,
        status: item.status,
        created_at: item.createdAt,
        updated_at: item.updatedAt,
        payment_confirmed_at: item.paymentConfirmedAt || null
      })),
      closings: snapshot.closings.map(item => ({
        date: item.date,
        closed_at: item.closedAt || null,
        reopened_at: item.reopenedAt || null,
        details_v2: item.detailsV2 || null,
        delivery_snapshot_v1: item.deliverySnapshotV1 || null,
        legacy_payload: item
      }))
    };
  }

  function downloadMigrationPackage() {
    const payload = toMigrationPackage();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `xburguer-migracao-banco-${dateKey()}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const saveBeforeDatabasePrep = save;
  save = function xbDatabaseReadySave() {
    db = normalizeDatabase(db);
    db.settings.lastLocalMutationAt = nowIso();
    db.settings.lastMutationDeviceId = deviceId();
    saveBeforeDatabasePrep();
    window.dispatchEvent(new CustomEvent('xb:data-saved', {
      detail: {
        schemaVersion: SCHEMA_VERSION,
        provider: 'local',
        savedAt: db.settings.lastLocalMutationAt,
        deviceId: db.settings.lastMutationDeviceId
      }
    }));
  };

  window.XBDataBridge = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    provider: 'local',
    deviceId: deviceId(),
    normalize: source => normalizeDatabase(source),
    diagnostics: source => diagnostics(source),
    snapshot: () => clone(normalizeDatabase(db)),
    migrationPackage: () => clone(toMigrationPackage(db))
  });

  function ensureDatabaseStyles() {
    if (document.getElementById('xbDatabasePrepStyles')) return;
    const style = document.createElement('style');
    style.id = 'xbDatabasePrepStyles';
    style.textContent = `
      .database-ready-card .db-status-grid{display:grid;gap:10px;margin-bottom:16px}
      .database-ready-card .db-status-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 13px;border:1px solid #e6d8ce;border-radius:13px;background:linear-gradient(135deg,#fffdfb,#f8eee7)}
      .database-ready-card .db-status-row span{color:#6b615b;font-size:.82rem;font-weight:700}
      .database-ready-card .db-status-row strong{font-size:.82rem;text-align:right}
      .database-ready-card .db-ready{color:#14784d!important}
      .database-ready-card .db-local{color:#9a6508!important}
      .database-ready-card .db-actions{display:flex;gap:9px;flex-wrap:wrap}
      .database-ready-card .db-note{display:flex;gap:8px;align-items:flex-start;margin:14px 0 0;color:#756861;font-size:.78rem;line-height:1.5}
      .database-ready-card .db-note svg{width:16px;height:16px;flex:0 0 auto;margin-top:1px}
    `;
    document.head.appendChild(style);
  }

  function ensureDatabaseCard() {
    if (document.getElementById('databaseReadinessCard')) return;
    const target = document.querySelector('#page-settings .settings-grid > .stack:nth-child(2)');
    if (!target) return;

    const report = diagnostics();
    const card = document.createElement('div');
    card.className = 'card database-ready-card';
    card.id = 'databaseReadinessCard';
    card.innerHTML = `
      <div class="card-head">
        <div class="card-title-row">
          <div class="card-title-icon">${icon('database-zap')}</div>
          <div><h3>Banco de dados</h3><p>Estrutura preparada para a próxima etapa no Supabase</p></div>
        </div>
      </div>
      <div class="card-body">
        <div class="db-status-grid">
          <div class="db-status-row"><span>Armazenamento atual</span><strong class="db-local">Local neste aparelho</strong></div>
          <div class="db-status-row"><span>Estrutura dos dados</span><strong class="db-ready">Versão ${SCHEMA_VERSION} · preparada</strong></div>
          <div class="db-status-row"><span>Integridade para migração</span><strong id="databaseIntegrityStatus" class="${report.ok ? 'db-ready' : ''}">${report.ok ? 'Aprovada' : `${report.issues.length} problema(s)`}</strong></div>
        </div>
        <div class="db-actions">
          <button class="btn btn-light btn-sm" type="button" id="databaseCheckBtn">${icon('shield-check')}Verificar dados</button>
          <button class="btn btn-light btn-sm" type="button" id="databaseExportMigrationBtn">${icon('file-down')}Pacote de migração</button>
        </div>
        <p class="db-note">${icon('info')}<span>O login atual continua local por enquanto. E-mail e senha não entram no pacote de migração; no banco definitivo serão substituídos pelo Supabase Auth.</span></p>
      </div>`;

    const dangerCard = target.querySelector('.danger-card');
    if (dangerCard) target.insertBefore(card, dangerCard);
    else target.appendChild(card);

    document.getElementById('databaseCheckBtn')?.addEventListener('click', () => {
      const current = diagnostics();
      const status = document.getElementById('databaseIntegrityStatus');
      if (status) {
        status.classList.toggle('db-ready', current.ok);
        status.textContent = current.ok ? 'Aprovada' : `${current.issues.length} problema(s)`;
      }
      if (!current.ok) {
        toast(`Encontramos ${current.issues.length} problema(s) que precisam de correção antes da migração.`, 'error');
        console.warn('[X-Burguer] Diagnóstico para banco:', current);
        return;
      }
      const detail = current.warnings.length ? ` Há ${current.warnings.length} aviso(s) para revisar.` : '';
      toast(`Dados prontos para migração.${detail}`);
    });

    document.getElementById('databaseExportMigrationBtn')?.addEventListener('click', () => {
      const current = diagnostics();
      if (!current.ok) return toast('Corrija os problemas de integridade antes de gerar o pacote.', 'error');
      downloadMigrationPackage();
      toast('Pacote de migração gerado sem incluir sua senha.');
    });

    refreshIcons();
  }

  const before = JSON.stringify(db);
  db = normalizeDatabase(db);
  if (JSON.stringify(db) !== before) save();

  ensureDatabaseStyles();
  ensureDatabaseCard();
})();
