(() => {
  if (window.XBLocalCache) return;
  const DATABASE = 'xburguer-local-cache-v1';
  const STORE = 'entries';
  const MIGRATED_KEY = '__xb_native_migration_confirmed_v1';
  const LEGACY_COPIES_KEY = 'xb_cache_legacy_conflicts_v1';
  const snapshots = new Map();
  const pending = new Map();
  let database = null;
  let writing = null;
  let activeKeys = [];
  let retryTimer = null;
  let retryDelay = 5000;
  let measuredAt = 0;
  const state = { available: false, blocked: false, error: '', pending: 0, lastSavedAt: '', usage: null, quota: null, persistent: null };
  const managed = key => ['xb_entregas_v3', 'xb_entregas_recovery_v1', 'xb_entregas_previous_state_v1', 'xb_cloud_pre_migration_backup_v1', LEGACY_COPIES_KEY].includes(key)
    || /^(xb_cloud_pre_migration_backup_v2_|xb_cloud_recovery_v1_|xb_cloud_queue_v2_)/.test(key);

  function transaction(mode) {
    try { return database.transaction(STORE, mode, { durability: 'strict' }); }
    catch { return database.transaction(STORE, mode); }
  }

  function readEntries() {
    return new Promise((resolve, reject) => {
      const tx = transaction('readonly');
      const store = tx.objectStore(STORE);
      const keys = store.getAllKeys();
      const values = store.getAll();
      tx.oncomplete = () => resolve(new Map(keys.result.map((key, index) => [key, values.result[index]])));
      tx.onabort = tx.onerror = () => reject(tx.error || new Error('Falha ao ler o cache local.'));
    });
  }

  function writeEntries(entries) {
    return new Promise((resolve, reject) => {
      const tx = transaction('readwrite');
      const store = tx.objectStore(STORE);
      for (const [key, value] of entries) {
        if (value === null) store.delete(key);
        else store.put(value, key);
      }
      tx.oncomplete = resolve;
      tx.onabort = tx.onerror = () => reject(tx.error || new Error('Falha ao gravar o cache local.'));
    });
  }

  function nativeKeys() {
    return Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter(Boolean);
  }

  function changed() {
    state.pending = new Set([...activeKeys, ...pending.keys()]).size;
    window.dispatchEvent(new CustomEvent('xb:local-cache-state', { detail: { ...state } }));
  }

  async function measure(force = false) {
    if (!window.navigator?.storage || (!force && Date.now() - measuredAt < 30000)) return;
    measuredAt = Date.now();
    try {
      const storage = window.navigator.storage;
      const estimate = await storage.estimate?.();
      state.usage = Number.isFinite(estimate?.usage) ? estimate.usage : null;
      state.quota = Number.isFinite(estimate?.quota) ? estimate.quota : null;
      state.persistent = storage.persisted ? await storage.persisted() : null;
      changed();
    } catch { /* A estimativa é informativa; uma falha não impede gravações. */ }
  }

  async function acquireWriter() {
    if (!window.navigator?.locks?.request) return;
    await new Promise((resolve, reject) => {
      window.navigator.locks.request('xburguer-cache-writer-v1', { ifAvailable: true }, lock => {
        if (!lock) { reject(new Error('O sistema já está aberto em outra aba deste navegador. Use a aba aberta ou feche-a e tente novamente.')); return; }
        resolve();
        // O navegador libera o lock ao encerrar a página. Não rouba uma aba ativa.
        return new Promise(() => {});
      }).catch(reject);
    });
  }

  async function initialize() {
    try {
      await acquireWriter();
      database = await new Promise((resolve, reject) => {
        if (!window.indexedDB) return reject(new Error('Armazenamento local ampliado indisponível neste navegador.'));
        const request = window.indexedDB.open(DATABASE, 1);
        let cancelled = false;
        const timer = setTimeout(() => {
          cancelled = true;
          reject(new Error('O armazenamento local demorou para responder. Feche outras abas e tente novamente.'));
        }, 15000);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE);
        request.onsuccess = () => {
          clearTimeout(timer);
          if (cancelled) request.result.close();
          else resolve(request.result);
        };
        request.onerror = () => { clearTimeout(timer); reject(request.error || new Error('Não foi possível abrir o cache local.')); };
        request.onblocked = () => {
          clearTimeout(timer);
          cancelled = true;
          reject(new Error('Feche outras abas do sistema para atualizar o armazenamento local.'));
        };
      });
      database.onversionchange = () => {
        database.close();
        reportFailure(new Error('O armazenamento foi atualizado em outra aba. Aguarde as gravações e reabra o sistema.'));
      };
      const stored = await readEntries();
      const legacy = new Map(nativeKeys().filter(managed).map(key => [key, localStorage.getItem(key)]));
      if (legacy.size) {
        const established = stored.has(MIGRATED_KEY) || stored.has('xb_entregas_v3');
        const migration = new Map();
        const preserved = JSON.parse(stored.get(LEGACY_COPIES_KEY) || '{"entries":[]}');
        if (!Array.isArray(preserved.entries)) throw new Error('As cópias antigas precisam de recuperação.');
        for (const [key, value] of legacy) {
          if (!established) migration.set(key, value);
          else if (stored.get(key) !== value && !preserved.entries.some(item => item.key === key && item.value === value)) {
            preserved.entries.push({ key, value, savedAt: new Date().toISOString() });
          }
        }
        if (preserved.entries.length) migration.set(LEGACY_COPIES_KEY, JSON.stringify(preserved));
        migration.set(MIGRATED_KEY, '1');
        await writeEntries(migration);
        const verified = await readEntries();
        for (const [key, value] of migration) {
          if (verified.get(key) !== value) throw new Error('A cópia do cache local não foi confirmada.');
        }
        // Libera apenas cópias já confirmadas; não toca na autenticação ou em outros sites.
        for (const [key, value] of migration) stored.set(key, value);
      }
      stored.delete(MIGRATED_KEY);
      for (const [key, value] of stored) snapshots.set(key, value);
      state.available = true;
      for (const [key, value] of legacy) {
        try { if (localStorage.getItem(key) === value) localStorage.removeItem(key); } catch {}
      }
    } catch (error) {
      // Não substitui um IndexedDB temporariamente ilegível por uma base vazia.
      state.blocked = Boolean(window.indexedDB) || /outra aba/.test(String(error?.message || error));
      if (state.blocked) state.error = String(error?.message || error);
      console.warn('[X-Burguer] Cache ampliado indisponível; mantendo as cópias antigas:', error);
    }
    changed();
    measure();
    return state.available;
  }

  function reportFailure(error) {
    state.error = String(error?.message || error);
    console.error('[X-Burguer] Falha ao gravar cache local:', error);
    window.dispatchEvent(new CustomEvent('xb:local-cache-error', { detail: { message: state.error } }));
    changed();
    if (pending.size && !retryTimer) {
      retryTimer = setTimeout(() => {
        retryTimer = null;
        startWriting();
      }, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 60000);
    }
  }

  function startWriting() {
    if (writing || !pending.size) return writing;
    writing = (async () => {
      while (pending.size) {
        const batch = new Map(pending);
        pending.clear();
        activeKeys = [...batch.keys()];
        changed();
        try {
          await writeEntries(batch);
          state.error = '';
          state.lastSavedAt = new Date().toISOString();
          retryDelay = 5000;
          clearTimeout(retryTimer);
          retryTimer = null;
        } catch (error) {
          for (const [key, value] of batch) if (!pending.has(key)) pending.set(key, value);
          throw error;
        }
      }
    })().finally(() => { writing = null; activeKeys = []; changed(); measure(); });
    writing.catch(reportFailure);
    return writing;
  }

  const ready = initialize();
  window.XBLocalCache = {
    state, ready,
    getItem(key) {
      key = String(key);
      if (state.available && managed(key)) return snapshots.get(key) ?? null;
      return localStorage.getItem(key);
    },
    setItem(key, value) {
      key = String(key);
      value = String(value);
      if (state.blocked && managed(key)) throw new Error(state.error);
      if (!state.available || !managed(key)) {
        try {
          localStorage.setItem(key, value);
          if (managed(key)) { state.error = ''; state.lastSavedAt = new Date().toISOString(); changed(); }
          return;
        }
        catch (error) { if (managed(key)) reportFailure(error); throw error; }
      }
      if (snapshots.get(key) === value) return;
      snapshots.set(key, value);
      pending.set(key, value);
      changed();
      queueMicrotask(startWriting);
    },
    removeItem(key) {
      key = String(key);
      if (state.blocked && managed(key)) throw new Error(state.error);
      if (!state.available || !managed(key)) return localStorage.removeItem(key);
      if (!snapshots.has(key)) return;
      snapshots.delete(key);
      pending.set(key, null);
      changed();
      queueMicrotask(startWriting);
    },
    get length() { return new Set([...nativeKeys(), ...snapshots.keys()]).size; },
    key(index) { return [...new Set([...nativeKeys(), ...snapshots.keys()])][index] ?? null; },
    async flush() {
      await ready;
      if (state.blocked) throw new Error(state.error);
      while (writing || pending.size) await (writing || startWriting());
      if (state.error) throw new Error(state.error);
    },
    measure: () => measure(true),
    async protect() {
      const granted = await window.navigator?.storage?.persist?.();
      await measure(true);
      return granted === true;
    },
    snapshot() { return Object.fromEntries([...nativeKeys().filter(managed).map(key => [key, localStorage.getItem(key)]), ...snapshots]); }
  };
  window.addEventListener?.('beforeunload', event => {
    if (state.blocked || (!state.pending && !state.error)) return;
    event.preventDefault();
    event.returnValue = '';
  });
})();
