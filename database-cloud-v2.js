(() => {
  if (window.__xbDatabaseCloudV2Installed) return;
  window.__xbDatabaseCloudV2Installed = true;

  const config = window.XB_SUPABASE_CONFIG || {};
  const LAST_SYNC_KEY = 'xb_cloud_last_sync_v2';
  const LEGACY_DIRTY_KEY = 'xb_cloud_dirty_v1';
  const AUTH_STORAGE_KEY = 'xb_supabase_auth_v1';
  const VALIDATED_USER_KEY = 'xb_cloud_validated_user_v1';
  const QUEUE_PREFIX = 'xb_cloud_queue_v2_';
  const PRE_MIGRATION_PREFIX = 'xb_cloud_pre_migration_backup_v2_';

  let client = null;
  let currentUser = null;
  let realtimeChannel = null;
  let syncTimer = null;
  let pullTimer = null;
  let suppressCloudPush = false;
  let syncing = false;
  let syncRequested = false;
  let trackedSnapshot = null;
  let queue = emptyQueue();

  const state = {
    configured: false,
    connected: false,
    syncing: false,
    lastSyncAt: safeGet(LAST_SYNC_KEY) || '',
    message: 'Aguardando configuração',
    pending: 0,
    lastError: ''
  };

  const nowIso = () => new Date().toISOString();
  const clone = value => JSON.parse(JSON.stringify(value));
  const isConfigured = () => Boolean(
    config.enabled &&
    /^https:\/\//i.test(String(config.projectUrl || '')) &&
    String(config.publishableKey || '').trim()
  );

  function safeGet(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  function safeSet(key, value) {
    try { localStorage.setItem(key, value); return true; } catch { return false; }
  }

  function safeRemove(key) {
    try { localStorage.removeItem(key); } catch {}
  }

  function formatDateTime(value) {
    if (!value) return 'Ainda não sincronizado';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Ainda não sincronizado';
    return date.toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }

  function notify(message, type = 'ok') {
    if (typeof toast === 'function') toast(message, type);
    else console.info(`[X-Burguer] ${message}`);
  }

  function emptyQueue() {
    return {
      settingsRev: '',
      upserts: { couriers: {}, deliveries: {}, closings: {} },
      deletes: { couriers: {}, deliveries: {}, closings: {} },
      updatedAt: ''
    };
  }

  function queueKey(userId = currentUser?.id) {
    return userId ? `${QUEUE_PREFIX}${userId}` : '';
  }

  function preMigrationKey(userId = currentUser?.id) {
    return userId ? `${PRE_MIGRATION_PREFIX}${userId}` : '';
  }

  function loadQueue(userId) {
    const key = queueKey(userId);
    if (!key) return emptyQueue();
    try {
      const parsed = JSON.parse(safeGet(key) || 'null');
      if (!parsed || typeof parsed !== 'object') return emptyQueue();
      return {
        settingsRev: String(parsed.settingsRev || ''),
        upserts: {
          couriers: { ...(parsed.upserts?.couriers || {}) },
          deliveries: { ...(parsed.upserts?.deliveries || {}) },
          closings: { ...(parsed.upserts?.closings || {}) }
        },
        deletes: {
          couriers: { ...(parsed.deletes?.couriers || {}) },
          deliveries: { ...(parsed.deletes?.deliveries || {}) },
          closings: { ...(parsed.deletes?.closings || {}) }
        },
        updatedAt: String(parsed.updatedAt || '')
      };
    } catch {
      return emptyQueue();
    }
  }

  function pendingCount(source = queue) {
    return (source.settingsRev ? 1 : 0) +
      Object.values(source.upserts || {}).reduce((total, group) => total + Object.keys(group || {}).length, 0) +
      Object.values(source.deletes || {}).reduce((total, group) => total + Object.keys(group || {}).length, 0);
  }

  function hasPending(source = queue) {
    return pendingCount(source) > 0;
  }

  function persistQueue() {
    if (!currentUser) return;
    const key = queueKey();
    if (!key) return;
    queue.updatedAt = nowIso();
    state.pending = pendingCount(queue);
    if (state.pending) safeSet(key, JSON.stringify(queue));
    else safeRemove(key);
    updateCloudStatus();
  }

  function ensureCloudRows() {
    const card = document.getElementById('databaseReadinessCard');
    const grid = card?.querySelector('.db-status-grid');
    if (!grid || document.getElementById('cloudConnectionStatus')) return;

    const rows = document.createElement('div');
    rows.innerHTML = `
      <div class="db-status-row"><span>Conexão em nuvem</span><strong id="cloudConnectionStatus">Conectando...</strong></div>
      <div class="db-status-row"><span>Sincronização</span><strong id="cloudSyncMode">Automática</strong></div>
      <div class="db-status-row"><span>Última sincronização</span><strong id="cloudLastSync">Ainda não sincronizado</strong></div>`;
    [...rows.children].forEach(row => grid.appendChild(row));
  }

  function updateCloudStatus(message = state.message) {
    state.message = message || state.message;
    state.pending = pendingCount(queue);
    ensureCloudRows();
    const connection = document.getElementById('cloudConnectionStatus');
    const last = document.getElementById('cloudLastSync');
    const mode = document.getElementById('cloudSyncMode');

    if (connection) {
      connection.textContent = state.message;
      connection.classList.toggle('db-ready', state.connected);
      connection.classList.toggle('db-local', !state.connected);
    }
    if (last) last.textContent = formatDateTime(state.lastSyncAt);
    if (mode) {
      const base = config.autoSync === false ? 'Manual' : 'Automática';
      mode.textContent = state.pending ? `${base} · ${state.pending} pendente${state.pending === 1 ? '' : 's'}` : base;
    }
  }

  async function loadExternalScript(src) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => {
        script.remove();
        reject(new Error(`Falha ao carregar ${src}`));
      };
      document.head.appendChild(script);
    });
  }

  async function loadSupabaseLibrary() {
    if (window.supabase?.createClient) return;
    const sources = [
      'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
      'https://unpkg.com/@supabase/supabase-js@2'
    ];
    let lastError = null;
    for (const src of sources) {
      try {
        await loadExternalScript(src);
        if (window.supabase?.createClient) return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('Supabase JS indisponível');
  }

  function localHasMeaningfulData() {
    const base = initialDB();
    return Boolean(
      db.deliveries?.length ||
      db.closings?.length ||
      db.couriers?.length ||
      db.settings?.storeName !== base.settings.storeName ||
      Number(db.settings?.defaultFee || 0) !== Number(base.settings.defaultFee || 0)
    );
  }

  function mapBy(items, key) {
    const result = {};
    (items || []).forEach(item => {
      const value = item?.[key];
      if (value === undefined || value === null || value === '') return;
      result[String(value)] = clone(item);
    });
    return result;
  }

  function snapshotForDiff() {
    return {
      settings: {
        storeName: String(db.settings?.storeName || 'X-Burguer Entregas'),
        defaultFee: Number(db.settings?.defaultFee || 0)
      },
      couriers: mapBy(db.couriers, 'id'),
      deliveries: mapBy(db.deliveries, 'id'),
      closings: mapBy(db.closings, 'date')
    };
  }

  function sameValue(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function markQueue(type, key, mode, revision = nowIso()) {
    const opposite = mode === 'upserts' ? 'deletes' : 'upserts';
    queue[mode][type][String(key)] = revision;
    delete queue[opposite][type][String(key)];
  }

  function queueDiff(previous, next) {
    if (!currentUser) return;
    const revision = nowIso();
    if (!sameValue(previous?.settings, next.settings)) queue.settingsRev = revision;

    ['couriers', 'deliveries', 'closings'].forEach(type => {
      const before = previous?.[type] || {};
      const after = next[type] || {};
      Object.keys(after).forEach(key => {
        if (!(key in before) || !sameValue(before[key], after[key])) markQueue(type, key, 'upserts', revision);
      });
      Object.keys(before).forEach(key => {
        if (!(key in after)) markQueue(type, key, 'deletes', revision);
      });
    });
    persistQueue();
  }

  function queueFullLocalSnapshot() {
    if (!currentUser) return;
    const revision = nowIso();
    queue.settingsRev = revision;
    (db.couriers || []).forEach(item => markQueue('couriers', item.id, 'upserts', revision));
    (db.deliveries || []).forEach(item => markQueue('deliveries', item.id, 'upserts', revision));
    (db.closings || []).filter(item => item?.date).forEach(item => markQueue('closings', item.date, 'upserts', revision));
    persistQueue();
  }

  function currentRecord(type, key) {
    if (type === 'couriers') return (db.couriers || []).find(item => String(item.id) === String(key));
    if (type === 'deliveries') return (db.deliveries || []).find(item => String(item.id) === String(key));
    if (type === 'closings') return (db.closings || []).find(item => String(item.date) === String(key));
    return null;
  }

  function toRemoteCourier(userId, item) {
    return {
      user_id: userId,
      id: item.id,
      name: item.name || '',
      phone: item.phone || '',
      fee: Number(item.fee || 0),
      active: item.active !== false,
      ...(item.createdAt ? { created_at: item.createdAt } : {}),
      ...(item.updatedAt ? { updated_at: item.updatedAt } : {})
    };
  }

  function toRemoteDelivery(userId, item) {
    return {
      user_id: userId,
      id: item.id,
      code: Number(item.code || 0),
      client: item.client || '',
      phone: item.phone || '',
      address: item.address || '',
      reference: item.reference || '',
      courier_id: item.courierId || null,
      fee: Number(item.fee || 0),
      order_value: Number(item.orderValue || 0),
      payment: item.payment || 'Dinheiro',
      change_for: item.changeFor === '' || item.changeFor === null || item.changeFor === undefined ? null : Number(item.changeFor || 0),
      notes: item.notes || '',
      status: item.status === 'Em rota' ? 'Aguardando' : (item.status || 'Aguardando'),
      payment_confirmed_at: item.paymentConfirmedAt || null,
      created_at: item.createdAt || nowIso(),
      updated_at: item.updatedAt || item.createdAt || nowIso()
    };
  }

  function toRemoteClosing(userId, item) {
    return {
      user_id: userId,
      date: item.date,
      closed_at: item.closedAt || null,
      reopened_at: item.reopenedAt || null,
      details_v2: item.detailsV2 || null,
      delivery_snapshot_v1: item.deliverySnapshotV1 || null,
      legacy_payload: item
    };
  }

  function toRemote(type, item) {
    if (type === 'couriers') return toRemoteCourier(currentUser.id, item);
    if (type === 'deliveries') return toRemoteDelivery(currentUser.id, item);
    if (type === 'closings') return toRemoteClosing(currentUser.id, item);
    return null;
  }

  async function syncSettings(revision) {
    if (!revision || queue.settingsRev !== revision) return;
    const payload = {
      store_name: db.settings?.storeName || 'X-Burguer Entregas',
      default_fee: Number(db.settings?.defaultFee || 0)
    };

    let result = await client
      .from('app_settings')
      .update(payload)
      .eq('user_id', currentUser.id)
      .select('user_id');
    if (result.error) throw result.error;

    if (!result.data?.length) {
      const localMax = (db.deliveries || []).reduce((max, item) => Math.max(max, Number(item.code || 0)), 0);
      const nextCode = Math.max(localMax + 1, Number(db.settings?.nextDeliveryCode || 1), 1);
      result = await client.from('app_settings').insert({
        user_id: currentUser.id,
        ...payload,
        next_delivery_code: nextCode
      });
      if (result.error && String(result.error.code || '') !== '23505') throw result.error;
      if (result.error?.code === '23505') {
        const retry = await client.from('app_settings').update(payload).eq('user_id', currentUser.id);
        if (retry.error) throw retry.error;
      }
    }

    if (queue.settingsRev === revision) queue.settingsRev = '';
    persistQueue();
  }

  function activeBatchKeys(batch, mode, type) {
    return Object.entries(batch?.[mode]?.[type] || {})
      .filter(([key, revision]) => queue?.[mode]?.[type]?.[key] === revision)
      .map(([key]) => key);
  }

  function clearBatchEntries(batch, mode, type, keys) {
    keys.forEach(key => {
      const revision = batch?.[mode]?.[type]?.[key];
      if (revision && queue?.[mode]?.[type]?.[key] === revision) delete queue[mode][type][key];
    });
    persistQueue();
  }

  async function syncUpserts(batch, type) {
    const keys = activeBatchKeys(batch, 'upserts', type);
    if (!keys.length) return;

    const rows = [];
    const actualKeys = [];
    keys.forEach(key => {
      const item = currentRecord(type, key);
      if (!item) {
        if (queue.upserts[type][key] === batch.upserts[type][key]) {
          delete queue.upserts[type][key];
          markQueue(type, key, 'deletes');
        }
        return;
      }
      rows.push(toRemote(type, item));
      actualKeys.push(key);
    });
    persistQueue();
    if (!rows.length) return;

    const onConflict = type === 'closings' ? 'user_id,date' : 'user_id,id';
    const table = type === 'closings' ? 'daily_closings' : type;
    const result = await client.from(table).upsert(rows, { onConflict });
    if (result.error) throw result.error;
    clearBatchEntries(batch, 'upserts', type, actualKeys);
  }

  async function syncDeletes(batch, type) {
    const keys = activeBatchKeys(batch, 'deletes', type);
    if (!keys.length) return;
    const table = type === 'closings' ? 'daily_closings' : type;
    const column = type === 'closings' ? 'date' : 'id';
    const result = await client.from(table).delete().eq('user_id', currentUser.id).in(column, keys);
    if (result.error) throw result.error;
    clearBatchEntries(batch, 'deletes', type, keys);
  }

  async function pushPendingChanges(reason = 'auto') {
    if (!currentUser || !client || suppressCloudPush || config.autoSync === false) return false;
    if (!navigator.onLine) {
      updateCloudStatus('Offline · alterações guardadas no aparelho');
      return false;
    }
    if (syncing) {
      syncRequested = true;
      return false;
    }
    if (!hasPending(queue)) {
      state.connected = true;
      updateCloudStatus('Conectado');
      return true;
    }

    syncing = true;
    state.syncing = true;
    state.lastError = '';
    updateCloudStatus('Sincronizando...');
    const batch = clone(queue);

    try {
      await syncSettings(batch.settingsRev);
      await syncUpserts(batch, 'couriers');
      await syncUpserts(batch, 'deliveries');
      await syncUpserts(batch, 'closings');
      await syncDeletes(batch, 'deliveries');
      await syncDeletes(batch, 'closings');
      await syncDeletes(batch, 'couriers');

      const syncedAt = nowIso();
      state.connected = true;
      state.lastSyncAt = syncedAt;
      safeSet(LAST_SYNC_KEY, syncedAt);
      if (!hasPending(queue)) safeRemove(LEGACY_DIRTY_KEY);
      updateCloudStatus(hasPending(queue) ? 'Conectado · finalizando sincronização' : 'Conectado');
      window.dispatchEvent(new CustomEvent('xb:cloud-synced', { detail: { reason, syncedAt, pending: pendingCount(queue) } }));
      schedulePull('apos-envio');
      return true;
    } catch (error) {
      state.connected = false;
      state.lastError = String(error?.message || error);
      console.error('[X-Burguer] Falha na sincronização com Supabase:', error);
      updateCloudStatus(navigator.onLine ? 'Falha ao sincronizar · alterações preservadas' : 'Offline · alterações guardadas no aparelho');
      return false;
    } finally {
      syncing = false;
      state.syncing = false;
      const shouldContinue = syncRequested || hasPending(queue);
      syncRequested = false;
      if (shouldContinue && navigator.onLine) {
        clearTimeout(syncTimer);
        syncTimer = setTimeout(() => pushPendingChanges('fila'), 250);
      }
    }
  }

  function rowToCourier(row) {
    return {
      id: row.id,
      name: row.name || '',
      phone: row.phone || '',
      fee: Number(row.fee || 0),
      active: row.active !== false,
      createdAt: row.created_at || undefined,
      updatedAt: row.updated_at || undefined
    };
  }

  function rowToDelivery(row) {
    return {
      id: row.id,
      code: Number(row.code || 0),
      client: row.client || '',
      phone: row.phone || '',
      address: row.address || '',
      reference: row.reference || '',
      courierId: row.courier_id || null,
      fee: Number(row.fee || 0),
      orderValue: Number(row.order_value || 0),
      payment: row.payment || 'Dinheiro',
      changeFor: row.change_for === null || row.change_for === undefined ? '' : Number(row.change_for),
      notes: row.notes || '',
      status: row.status || 'Aguardando',
      paymentConfirmedAt: row.payment_confirmed_at || '',
      createdAt: row.created_at,
      updatedAt: row.updated_at || row.created_at
    };
  }

  function rowToClosing(row) {
    const legacy = row.legacy_payload && typeof row.legacy_payload === 'object' ? row.legacy_payload : {};
    return {
      ...legacy,
      date: row.date,
      closedAt: row.closed_at || legacy.closedAt || '',
      reopenedAt: row.reopened_at || legacy.reopenedAt || '',
      detailsV2: row.details_v2 || legacy.detailsV2 || null,
      deliverySnapshotV1: row.delivery_snapshot_v1 || legacy.deliverySnapshotV1 || null,
      updatedAt: row.updated_at || legacy.updatedAt || row.closed_at || ''
    };
  }

  async function fetchRemoteSnapshot() {
    const [settingsResult, couriersResult, deliveriesResult, closingsResult] = await Promise.all([
      client.from('app_settings').select('*').eq('user_id', currentUser.id).maybeSingle(),
      client.from('couriers').select('*').eq('user_id', currentUser.id).order('name'),
      client.from('deliveries').select('*').eq('user_id', currentUser.id).order('created_at'),
      client.from('daily_closings').select('*').eq('user_id', currentUser.id).order('date')
    ]);

    const firstError = [settingsResult, couriersResult, deliveriesResult, closingsResult].find(result => result.error)?.error;
    if (firstError) throw firstError;

    const settingsRow = settingsResult.data;
    const snapshot = {
      settings: {
        ...db.settings,
        ...(settingsRow ? {
          storeName: settingsRow.store_name,
          defaultFee: Number(settingsRow.default_fee || 0),
          nextDeliveryCode: Number(settingsRow.next_delivery_code || 1)
        } : {}),
        password: ''
      },
      couriers: (couriersResult.data || []).map(rowToCourier),
      deliveries: (deliveriesResult.data || []).map(rowToDelivery),
      closings: (closingsResult.data || []).map(rowToClosing)
    };

    return {
      hasRemoteState: Boolean(settingsRow || snapshot.couriers.length || snapshot.deliveries.length || snapshot.closings.length),
      hasBusinessData: Boolean(snapshot.couriers.length || snapshot.deliveries.length || snapshot.closings.length),
      settingsUpdatedAt: settingsRow?.updated_at || '',
      snapshot: window.XBDataBridge?.normalize ? window.XBDataBridge.normalize(snapshot) : snapshot
    };
  }

  async function applyRemoteSnapshot(snapshot) {
    suppressCloudPush = true;
    window.__xbApplyingRemoteSnapshot = true;
    try {
      db = window.XBDataBridge?.normalize ? window.XBDataBridge.normalize(snapshot) : snapshot;
      if (db.settings) db.settings.password = '';
      save();
      if (typeof renderAll === 'function') renderAll();
      trackedSnapshot = snapshotForDiff();
    } finally {
      suppressCloudPush = false;
      window.__xbApplyingRemoteSnapshot = false;
    }
  }

  function recordTime(item, fallback = 0) {
    const candidates = [item?.updatedAt, item?.createdAt, item?.closedAt];
    for (const value of candidates) {
      const time = new Date(value || 0).getTime();
      if (Number.isFinite(time) && time > 0) return time;
    }
    return fallback;
  }

  function recordSignature(type, item) {
    if (!item) return '';
    if (type === 'couriers') return JSON.stringify({ id: item.id, name: item.name, phone: item.phone, fee: Number(item.fee || 0), active: item.active !== false });
    if (type === 'deliveries') return JSON.stringify({
      id: item.id, code: Number(item.code || 0), client: item.client || '', phone: item.phone || '', address: item.address || '', reference: item.reference || '',
      courierId: item.courierId || null, fee: Number(item.fee || 0), orderValue: Number(item.orderValue || 0), payment: item.payment || '', changeFor: item.changeFor ?? '',
      notes: item.notes || '', status: item.status || '', paymentConfirmedAt: item.paymentConfirmedAt || ''
    });
    const copy = clone(item);
    delete copy.updatedAt;
    return JSON.stringify(copy);
  }

  function queueLegacyReconciliation(remote) {
    if (!currentUser) return;
    const revision = nowIso();
    const localFallback = new Date(db.settings?.lastLocalMutationAt || 0).getTime() || 0;
    const remoteMaps = {
      couriers: mapBy(remote.couriers, 'id'),
      deliveries: mapBy(remote.deliveries, 'id'),
      closings: mapBy(remote.closings, 'date')
    };
    const localMaps = {
      couriers: mapBy(db.couriers, 'id'),
      deliveries: mapBy(db.deliveries, 'id'),
      closings: mapBy(db.closings, 'date')
    };

    ['couriers', 'deliveries', 'closings'].forEach(type => {
      Object.entries(localMaps[type]).forEach(([key, localItem]) => {
        const remoteItem = remoteMaps[type][key];
        if (!remoteItem) {
          markQueue(type, key, 'upserts', revision);
          return;
        }
        if (recordSignature(type, localItem) === recordSignature(type, remoteItem)) return;
        const localTime = recordTime(localItem, localFallback);
        const remoteTime = recordTime(remoteItem, 0);
        if (localTime >= remoteTime && localTime > 0) markQueue(type, key, 'upserts', revision);
      });
    });

    persistQueue();
  }

  async function pullRemoteSnapshot(reason = 'remote') {
    if (!currentUser || !client || !navigator.onLine) return false;
    if (syncing) {
      schedulePull(reason);
      return false;
    }
    if (hasPending(queue)) {
      const sent = await pushPendingChanges('antes-de-receber');
      if (!sent || hasPending(queue)) return false;
    }

    try {
      const remote = await fetchRemoteSnapshot();
      if (!remote.hasRemoteState && localHasMeaningfulData()) return false;
      await applyRemoteSnapshot(remote.snapshot);
      const syncedAt = nowIso();
      state.connected = true;
      state.lastSyncAt = syncedAt;
      state.lastError = '';
      safeSet(LAST_SYNC_KEY, syncedAt);
      updateCloudStatus('Conectado');
      window.dispatchEvent(new CustomEvent('xb:cloud-pulled', { detail: { reason, syncedAt } }));
      return true;
    } catch (error) {
      state.connected = false;
      state.lastError = String(error?.message || error);
      console.error('[X-Burguer] Falha ao receber dados do Supabase:', error);
      updateCloudStatus(navigator.onLine ? 'Falha ao receber dados · usando cache local' : 'Offline · usando dados locais');
      return false;
    }
  }

  function schedulePush(reason = 'save') {
    if (!currentUser || suppressCloudPush || config.autoSync === false) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => pushPendingChanges(reason), 500);
  }

  function schedulePull(reason = 'realtime') {
    if (!currentUser || suppressCloudPush || !navigator.onLine) return;
    clearTimeout(pullTimer);
    pullTimer = setTimeout(() => pullRemoteSnapshot(reason), 650);
  }

  function installSaveBridge() {
    if (window.__xbCloudV2SaveWrapped) return;
    window.__xbCloudV2SaveWrapped = true;
    const localSave = save;
    trackedSnapshot = snapshotForDiff();

    save = function xbCloudV2AwareSave() {
      const before = trackedSnapshot || snapshotForDiff();
      localSave();
      const after = snapshotForDiff();
      if (!suppressCloudPush && currentUser) {
        queueDiff(before, after);
        schedulePush('save');
      }
      trackedSnapshot = after;
    };
  }

  async function firstSync() {
    updateCloudStatus('Verificando banco...');
    const remote = await fetchRemoteSnapshot();

    if (hasPending(queue)) {
      await pushPendingChanges('recuperacao-offline');
      if (hasPending(queue)) throw new Error('Existem alterações locais aguardando sincronização');
      const refreshed = await fetchRemoteSnapshot();
      await applyRemoteSnapshot(refreshed.snapshot);
      return;
    }

    const legacyDirty = Boolean(safeGet(LEGACY_DIRTY_KEY));
    if (legacyDirty && localHasMeaningfulData()) {
      queueLegacyReconciliation(remote.snapshot);
      if (hasPending(queue)) {
        await pushPendingChanges('transicao-sincronizacao-v2');
        if (hasPending(queue)) throw new Error('Não foi possível concluir a conciliação local');
      }
      safeRemove(LEGACY_DIRTY_KEY);
      const refreshed = await fetchRemoteSnapshot();
      await applyRemoteSnapshot(refreshed.snapshot);
      return;
    }

    if (!remote.hasBusinessData && localHasMeaningfulData() && config.autoMigrateLocalData !== false) {
      const backupKey = preMigrationKey();
      if (backupKey && !safeGet(backupKey)) {
        const safeDb = clone(db);
        if (safeDb.settings) safeDb.settings.password = '';
        safeSet(backupKey, JSON.stringify({ savedAt: nowIso(), db: safeDb }));
      }
      queueFullLocalSnapshot();
      await pushPendingChanges('migracao-inicial');
      if (hasPending(queue)) throw new Error('Migração inicial incompleta');
      const refreshed = await fetchRemoteSnapshot();
      await applyRemoteSnapshot(refreshed.snapshot);
      notify('Dados deste aparelho enviados para o banco online.');
      return;
    }

    if (remote.hasRemoteState) {
      await applyRemoteSnapshot(remote.snapshot);
      return;
    }

    queue.settingsRev = nowIso();
    persistQueue();
    await pushPendingChanges('inicializacao');
    const initialized = await fetchRemoteSnapshot();
    await applyRemoteSnapshot(initialized.snapshot);
  }

  function subscribeRealtime() {
    if (!config.realtime || !currentUser || !client || !navigator.onLine) return;
    if (realtimeChannel) client.removeChannel(realtimeChannel).catch(() => {});

    realtimeChannel = client
      .channel(`xb-sync-v2-${currentUser.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings', filter: `user_id=eq.${currentUser.id}` }, () => schedulePull('settings'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'couriers', filter: `user_id=eq.${currentUser.id}` }, () => schedulePull('couriers'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deliveries', filter: `user_id=eq.${currentUser.id}` }, () => schedulePull('deliveries'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_closings', filter: `user_id=eq.${currentUser.id}` }, () => schedulePull('closings'))
      .subscribe();
  }

  function canUseOfflineSession(user) {
    return Boolean(user?.id && safeGet(VALIDATED_USER_KEY) === user.id);
  }

  async function activateSession(user, source = 'session') {
    currentUser = user;
    queue = loadQueue(user.id);
    trackedSnapshot = snapshotForDiff();
    try { sessionStorage.setItem(SESSION_KEY, '1'); } catch {}
    persistQueue();

    if (!navigator.onLine) {
      if (!canUseOfflineSession(user)) {
        showLoginOnly();
        updateCloudStatus('Offline · conecte à internet para validar o acesso');
        return false;
      }
      state.connected = false;
      updateCloudStatus('Offline · usando dados locais');
      if (typeof showApp === 'function') showApp();
      window.dispatchEvent(new CustomEvent('xb:cloud-ready', { detail: { userId: user.id, source, offline: true } }));
      return true;
    }

    updateCloudStatus('Conectado · sincronizando');
    try {
      await firstSync();
      safeSet(VALIDATED_USER_KEY, user.id);
      state.connected = true;
      updateCloudStatus('Conectado');
      subscribeRealtime();
      if (typeof showApp === 'function') showApp();
      window.dispatchEvent(new CustomEvent('xb:cloud-ready', { detail: { userId: user.id, source, offline: false } }));
      return true;
    } catch (error) {
      console.error('[X-Burguer] Falha ao ativar sessão online:', error);
      if (canUseOfflineSession(user)) {
        state.connected = false;
        state.lastError = String(error?.message || error);
        updateCloudStatus('Banco temporariamente indisponível · usando cache local');
        if (typeof showApp === 'function') showApp();
        return true;
      }
      throw error;
    }
  }

  function showLoginOnly() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch {}
    document.getElementById('appView')?.classList.add('hidden');
    document.getElementById('loginView')?.classList.remove('hidden');
  }

  function installAuthBridge() {
    const loginForm = document.getElementById('loginForm');
    loginForm?.addEventListener('submit', async event => {
      if (!client) return;
      event.preventDefault();
      event.stopImmediatePropagation();

      if (!navigator.onLine) {
        notify('Conecte à internet para entrar no sistema.', 'error');
        return;
      }

      const email = document.getElementById('loginEmail')?.value.trim() || '';
      const password = document.getElementById('loginPassword')?.value || '';
      const submit = loginForm.querySelector('button[type="submit"]');
      if (submit) submit.disabled = true;
      updateCloudStatus('Autenticando...');

      try {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (!data.user) throw new Error('Usuário não encontrado');
        if (document.getElementById('rememberLogin')?.checked) safeSet(LOGIN_EMAIL_KEY, email);
        else safeRemove(LOGIN_EMAIL_KEY);
        const activated = await activateSession(data.user, 'login');
        if (activated) notify('Login conectado ao banco online.');
      } catch (error) {
        console.error('[X-Burguer] Erro no login Supabase:', error);
        updateCloudStatus('Conectado · login necessário');
        const message = /email.*confirm/i.test(String(error?.message || ''))
          ? 'Confirme seu e-mail antes de entrar.'
          : 'E-mail ou senha incorretos.';
        notify(message, 'error');
      } finally {
        if (submit) submit.disabled = false;
      }
    }, true);

    document.getElementById('logoutBtn')?.addEventListener('click', async event => {
      if (!client) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      try {
        if (realtimeChannel) await client.removeChannel(realtimeChannel);
      } catch {}
      try { await client.auth.signOut(); } catch {}
      safeRemove(AUTH_STORAGE_KEY);
      currentUser = null;
      queue = emptyQueue();
      try { sessionStorage.removeItem(SESSION_KEY); } catch {}
      location.reload();
    }, true);
  }

  async function recoverOnline() {
    if (!client) return;
    updateCloudStatus('Internet restaurada · sincronizando');
    const { data } = await client.auth.getSession();
    const user = data?.session?.user;
    if (!user) {
      currentUser = null;
      showLoginOnly();
      updateCloudStatus('Conectado · faça login');
      return;
    }
    if (!currentUser || currentUser.id !== user.id) {
      await activateSession(user, 'online-restored');
      return;
    }
    await pushPendingChanges('online');
    await pullRemoteSnapshot('online');
    subscribeRealtime();
    safeSet(VALIDATED_USER_KEY, user.id);
  }

  async function boot() {
    state.configured = isConfigured();
    ensureCloudRows();

    if (!state.configured) {
      updateCloudStatus('Aguardando configuração do Supabase');
      window.XBCloud = { state, configured: false };
      return;
    }

    updateCloudStatus('Conectando...');
    await loadSupabaseLibrary();
    client = window.supabase.createClient(config.projectUrl, config.publishableKey, {
      auth: {
        storageKey: AUTH_STORAGE_KEY,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });

    window.XBCloud = {
      state,
      configured: true,
      get client() { return client; },
      syncNow: () => pushPendingChanges('manual'),
      pullNow: () => pullRemoteSnapshot('manual'),
      get pendingChanges() { return pendingCount(queue); }
    };

    installSaveBridge();
    installAuthBridge();

    window.addEventListener('online', () => recoverOnline().catch(error => {
      console.error('[X-Burguer] Falha ao recuperar conexão:', error);
      updateCloudStatus('Falha ao reconectar · alterações preservadas');
    }));
    window.addEventListener('offline', () => {
      state.connected = false;
      updateCloudStatus(hasPending(queue) ? 'Offline · alterações guardadas no aparelho' : 'Offline · usando dados locais');
    });

    client.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_OUT') {
        currentUser = null;
        queue = emptyQueue();
        showLoginOnly();
        updateCloudStatus('Conectado · faça login');
      }
    });

    const { data, error } = await client.auth.getSession();
    if (error) console.warn('[X-Burguer] Sessão Supabase:', error);
    if (data?.session?.user) {
      await activateSession(data.session.user, 'restored-session');
    } else {
      showLoginOnly();
      updateCloudStatus('Conectado · faça login');
    }
  }

  boot().catch(error => {
    console.error('[X-Burguer] Não foi possível iniciar o banco online:', error);
    state.connected = false;
    state.lastError = String(error?.message || error);
    showLoginOnly();
    updateCloudStatus('Banco online indisponível · tente novamente');
    window.XBCloud = window.XBCloud || { state, configured: isConfigured(), error: state.lastError };
  });
})();
