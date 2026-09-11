(() => {
  if (window.__xbDatabaseCloudInstalled) return;
  window.__xbDatabaseCloudInstalled = true;

  const config = window.XB_SUPABASE_CONFIG || {};
  const LAST_SYNC_KEY = 'xb_cloud_last_sync_v1';
  const DIRTY_KEY = 'xb_cloud_dirty_v1';
  const PRE_MIGRATION_KEY = 'xb_cloud_pre_migration_backup_v1';
  const AUTH_STORAGE_KEY = 'xb_supabase_auth_v1';

  let client = null;
  let currentUser = null;
  let realtimeChannel = null;
  let syncTimer = null;
  let pullTimer = null;
  let suppressCloudPush = false;
  let syncing = false;

  const state = {
    configured: false,
    connected: false,
    syncing: false,
    lastSyncAt: localStorage.getItem(LAST_SYNC_KEY) || '',
    message: 'Aguardando configuração'
  };

  const isConfigured = () => Boolean(
    config.enabled &&
    /^https:\/\//i.test(String(config.projectUrl || '')) &&
    String(config.publishableKey || '').trim()
  );

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const nowIso = () => new Date().toISOString();

  function formatDateTime(value) {
    if (!value) return 'Ainda não sincronizado';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Ainda não sincronizado';
    return date.toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }

  function safeSet(key, value) {
    try { localStorage.setItem(key, value); } catch {}
  }
  function safeGet(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  function safeRemove(key) {
    try { localStorage.removeItem(key); } catch {}
  }

  function ensureCloudRows() {
    const card = document.getElementById('databaseReadinessCard');
    const grid = card?.querySelector('.db-status-grid');
    if (!grid || document.getElementById('cloudConnectionStatus')) return;

    const rows = document.createElement('div');
    rows.innerHTML = `
      <div class="db-status-row"><span>Conexão em nuvem</span><strong id="cloudConnectionStatus">Aguardando conta dedicada</strong></div>
      <div class="db-status-row"><span>Sincronização</span><strong id="cloudSyncMode">Automática</strong></div>
      <div class="db-status-row"><span>Última sincronização</span><strong id="cloudLastSync">Ainda não sincronizado</strong></div>`;
    [...rows.children].forEach(row => grid.appendChild(row));
    updateCloudStatus();
  }

  function updateCloudStatus(message = state.message) {
    state.message = message;
    ensureCloudRows();
    const connection = document.getElementById('cloudConnectionStatus');
    const last = document.getElementById('cloudLastSync');
    const mode = document.getElementById('cloudSyncMode');

    if (connection) {
      connection.textContent = message;
      connection.classList.toggle('db-ready', state.connected);
      connection.classList.toggle('db-local', !state.connected);
    }
    if (last) last.textContent = formatDateTime(state.lastSyncAt);
    if (mode) mode.textContent = config.autoSync === false ? 'Manual' : 'Automática';
  }

  function notify(message, type = 'ok') {
    if (typeof toast === 'function') toast(message, type);
    else console.info(`[X-Burguer] ${message}`);
  }

  async function loadSupabaseLibrary() {
    if (window.supabase?.createClient) return;
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Falha ao carregar Supabase JS'));
      document.head.appendChild(script);
    });
    if (!window.supabase?.createClient) throw new Error('Supabase JS indisponível');
  }

  function localHasMeaningfulData() {
    const base = initialDB();
    const currentCouriers = Array.isArray(db.couriers) ? db.couriers : [];
    const baseCourierSignature = JSON.stringify(base.couriers.map(item => [item.id, item.name, item.phone, Number(item.fee || 0), item.active !== false]));
    const currentCourierSignature = JSON.stringify(currentCouriers.map(item => [item.id, item.name, item.phone, Number(item.fee || 0), item.active !== false]));
    return Boolean(
      db.deliveries?.length ||
      db.closings?.length ||
      currentCourierSignature !== baseCourierSignature ||
      db.settings?.storeName !== base.settings.storeName ||
      Number(db.settings?.defaultFee || 0) !== Number(base.settings.defaultFee || 0)
    );
  }

  function toRemoteSettings(userId) {
    return {
      user_id: userId,
      store_name: db.settings?.storeName || 'X-Burguer Entregas',
      default_fee: Number(db.settings?.defaultFee || 0),
      next_delivery_code: Math.max(1, Number(db.settings?.nextDeliveryCode || 1))
    };
  }

  function toRemoteCouriers(userId) {
    return (db.couriers || []).map(item => ({
      user_id: userId,
      id: item.id,
      name: item.name || '',
      phone: item.phone || '',
      fee: Number(item.fee || 0),
      active: item.active !== false,
      ...(item.createdAt ? { created_at: item.createdAt } : {}),
      ...(item.updatedAt ? { updated_at: item.updatedAt } : {})
    }));
  }

  function toRemoteDeliveries(userId) {
    return (db.deliveries || []).map(item => ({
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
    }));
  }

  function toRemoteClosings(userId) {
    return (db.closings || []).filter(item => item?.date).map(item => ({
      user_id: userId,
      date: item.date,
      closed_at: item.closedAt || null,
      reopened_at: item.reopenedAt || null,
      details_v2: item.detailsV2 || null,
      delivery_snapshot_v1: item.deliverySnapshotV1 || null,
      legacy_payload: item
    }));
  }

  async function deleteMissingRows(table, key, localValues) {
    const { data, error } = await client.from(table).select(key).eq('user_id', currentUser.id);
    if (error) throw error;
    const local = new Set(localValues.map(value => String(value)));
    const missing = (data || []).map(row => row[key]).filter(value => !local.has(String(value)));
    if (!missing.length) return;
    const result = await client.from(table).delete().eq('user_id', currentUser.id).in(key, missing);
    if (result.error) throw result.error;
  }

  async function pushLocalSnapshot(reason = 'auto') {
    if (!currentUser || !client || suppressCloudPush || syncing || config.autoSync === false) return;
    syncing = true;
    state.syncing = true;
    updateCloudStatus('Sincronizando...');

    try {
      const settings = toRemoteSettings(currentUser.id);
      const couriers = toRemoteCouriers(currentUser.id);
      const deliveries = toRemoteDeliveries(currentUser.id);
      const closings = toRemoteClosings(currentUser.id);

      let result = await client.from('app_settings').upsert(settings, { onConflict: 'user_id' });
      if (result.error) throw result.error;

      if (couriers.length) {
        result = await client.from('couriers').upsert(couriers, { onConflict: 'user_id,id' });
        if (result.error) throw result.error;
      }
      if (deliveries.length) {
        result = await client.from('deliveries').upsert(deliveries, { onConflict: 'user_id,id' });
        if (result.error) throw result.error;
      }
      if (closings.length) {
        result = await client.from('daily_closings').upsert(closings, { onConflict: 'user_id,date' });
        if (result.error) throw result.error;
      }

      await deleteMissingRows('couriers', 'id', couriers.map(item => item.id));
      await deleteMissingRows('deliveries', 'id', deliveries.map(item => item.id));
      await deleteMissingRows('daily_closings', 'date', closings.map(item => item.date));

      const syncedAt = nowIso();
      state.connected = true;
      state.lastSyncAt = syncedAt;
      safeSet(LAST_SYNC_KEY, syncedAt);
      safeRemove(DIRTY_KEY);
      updateCloudStatus('Conectado');
      window.dispatchEvent(new CustomEvent('xb:cloud-synced', { detail: { reason, syncedAt } }));
    } catch (error) {
      console.error('[X-Burguer] Falha na sincronização com Supabase:', error);
      state.connected = navigator.onLine;
      updateCloudStatus(navigator.onLine ? 'Falha ao sincronizar' : 'Offline · dados salvos no aparelho');
      safeSet(DIRTY_KEY, nowIso());
    } finally {
      syncing = false;
      state.syncing = false;
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
      deliverySnapshotV1: row.delivery_snapshot_v1 || legacy.deliverySnapshotV1 || null
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
        } : {})
      },
      couriers: (couriersResult.data || []).map(rowToCourier),
      deliveries: (deliveriesResult.data || []).map(rowToDelivery),
      closings: (closingsResult.data || []).map(rowToClosing)
    };

    return {
      hasBusinessData: snapshot.couriers.length > 0 || snapshot.deliveries.length > 0 || snapshot.closings.length > 0,
      snapshot: window.XBDataBridge?.normalize ? window.XBDataBridge.normalize(snapshot) : snapshot
    };
  }

  async function applyRemoteSnapshot(snapshot) {
    suppressCloudPush = true;
    try {
      db = window.XBDataBridge?.normalize ? window.XBDataBridge.normalize(snapshot) : snapshot;
      save();
      if (typeof renderAll === 'function') renderAll();
    } finally {
      suppressCloudPush = false;
    }
  }

  async function pullRemoteSnapshot(reason = 'remote') {
    if (!currentUser || !client || syncing) return;
    try {
      const remote = await fetchRemoteSnapshot();
      if (!remote.hasBusinessData && localHasMeaningfulData()) return;
      await applyRemoteSnapshot(remote.snapshot);
      const syncedAt = nowIso();
      state.connected = true;
      state.lastSyncAt = syncedAt;
      safeSet(LAST_SYNC_KEY, syncedAt);
      safeRemove(DIRTY_KEY);
      updateCloudStatus('Conectado');
      window.dispatchEvent(new CustomEvent('xb:cloud-pulled', { detail: { reason, syncedAt } }));
    } catch (error) {
      console.error('[X-Burguer] Falha ao receber dados do Supabase:', error);
      updateCloudStatus(navigator.onLine ? 'Falha ao receber dados' : 'Offline · usando dados locais');
    }
  }

  function schedulePush(reason = 'save') {
    if (!currentUser || suppressCloudPush || config.autoSync === false) return;
    safeSet(DIRTY_KEY, nowIso());
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => pushLocalSnapshot(reason), 650);
  }

  function schedulePull(reason = 'realtime') {
    if (!currentUser || suppressCloudPush) return;
    clearTimeout(pullTimer);
    pullTimer = setTimeout(() => pullRemoteSnapshot(reason), 800);
  }

  function installSaveBridge() {
    const localSave = save;
    save = function xbCloudAwareSave() {
      localSave();
      if (!suppressCloudPush) schedulePush('save');
    };
  }

  async function firstSync() {
    updateCloudStatus('Verificando banco...');
    const dirty = Boolean(safeGet(DIRTY_KEY));
    const remote = await fetchRemoteSnapshot();

    if (dirty && localHasMeaningfulData()) {
      await pushLocalSnapshot('recuperacao-offline');
      return pullRemoteSnapshot('apos-recuperacao');
    }

    if (!remote.hasBusinessData && localHasMeaningfulData() && config.autoMigrateLocalData !== false) {
      if (!safeGet(PRE_MIGRATION_KEY)) {
        safeSet(PRE_MIGRATION_KEY, JSON.stringify({ savedAt: nowIso(), db }));
      }
      await pushLocalSnapshot('migracao-inicial');
      notify('Dados deste aparelho enviados para o banco online.');
      return;
    }

    if (remote.hasBusinessData) {
      await applyRemoteSnapshot(remote.snapshot);
      const syncedAt = nowIso();
      state.connected = true;
      state.lastSyncAt = syncedAt;
      safeSet(LAST_SYNC_KEY, syncedAt);
      safeRemove(DIRTY_KEY);
      updateCloudStatus('Conectado');
      return;
    }

    await pushLocalSnapshot('inicializacao');
  }

  function subscribeRealtime() {
    if (!config.realtime || !currentUser || !client) return;
    if (realtimeChannel) client.removeChannel(realtimeChannel).catch(() => {});

    realtimeChannel = client
      .channel(`xb-sync-${currentUser.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings', filter: `user_id=eq.${currentUser.id}` }, () => schedulePull('settings'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'couriers', filter: `user_id=eq.${currentUser.id}` }, () => schedulePull('couriers'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deliveries', filter: `user_id=eq.${currentUser.id}` }, () => schedulePull('deliveries'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_closings', filter: `user_id=eq.${currentUser.id}` }, () => schedulePull('closings'))
      .subscribe();
  }

  async function activateSession(user, source = 'session') {
    currentUser = user;
    sessionStorage.setItem(SESSION_KEY, '1');
    state.connected = true;
    updateCloudStatus('Conectado · sincronizando');
    await firstSync();
    subscribeRealtime();
    if (typeof showApp === 'function') showApp();
    window.dispatchEvent(new CustomEvent('xb:cloud-ready', { detail: { userId: user.id, source } }));
  }

  function showLoginOnly() {
    sessionStorage.removeItem(SESSION_KEY);
    document.getElementById('appView')?.classList.add('hidden');
    document.getElementById('loginView')?.classList.remove('hidden');
  }

  function installAuthBridge() {
    const loginForm = document.getElementById('loginForm');
    loginForm?.addEventListener('submit', async event => {
      if (!client) return;
      event.preventDefault();
      event.stopImmediatePropagation();

      const email = document.getElementById('loginEmail')?.value.trim() || '';
      const password = document.getElementById('loginPassword')?.value || '';
      const submit = loginForm.querySelector('button[type="submit"]');
      if (submit) submit.disabled = true;
      updateCloudStatus('Autenticando...');

      try {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (!data.user) throw new Error('Usuário não encontrado');
        if (document.getElementById('rememberLogin')?.checked) localStorage.setItem(LOGIN_EMAIL_KEY, email);
        else localStorage.removeItem(LOGIN_EMAIL_KEY);
        await activateSession(data.user, 'login');
        notify('Login conectado ao banco online.');
      } catch (error) {
        console.error('[X-Burguer] Erro no login Supabase:', error);
        updateCloudStatus('Conectado · login necessário');
        notify('E-mail ou senha incorretos.', 'error');
      } finally {
        if (submit) submit.disabled = false;
      }
    }, true);

    document.getElementById('logoutBtn')?.addEventListener('click', async event => {
      if (!client) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      try { await client.auth.signOut(); } catch {}
      currentUser = null;
      sessionStorage.removeItem(SESSION_KEY);
      location.reload();
    }, true);
  }

  async function boot() {
    state.configured = isConfigured();
    ensureCloudRows();

    if (!state.configured) {
      updateCloudStatus('Aguardando conta Supabase dedicada');
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

    installSaveBridge();
    installAuthBridge();

    window.addEventListener('online', () => {
      updateCloudStatus('Internet restaurada · sincronizando');
      pushLocalSnapshot('online');
    });
    window.addEventListener('offline', () => updateCloudStatus('Offline · dados salvos no aparelho'));

    const { data, error } = await client.auth.getSession();
    if (error) console.warn('[X-Burguer] Sessão Supabase:', error);

    if (data?.session?.user) {
      await activateSession(data.session.user, 'restored-session');
    } else {
      showLoginOnly();
      updateCloudStatus('Conectado · faça login');
    }

    client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        currentUser = null;
        showLoginOnly();
        updateCloudStatus('Conectado · faça login');
      }
    });

    window.XBCloud = {
      state,
      configured: true,
      get client() { return client; },
      syncNow: () => pushLocalSnapshot('manual'),
      pullNow: () => pullRemoteSnapshot('manual')
    };
  }

  boot().catch(error => {
    console.error('[X-Burguer] Não foi possível iniciar o banco online:', error);
    state.connected = false;
    updateCloudStatus('Banco online indisponível · modo local ativo');
    window.XBCloud = { state, configured: isConfigured(), error: String(error?.message || error) };
  });
})();
