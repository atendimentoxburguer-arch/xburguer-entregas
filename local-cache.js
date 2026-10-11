(() => {
  if (window.XBLocalCache) return;
  const DATABASE = 'xburguer-local-cache-v1';
  const STORE = 'entries';
  const snapshots = new Map();
  const pending = new Map();
  let database = null;
  let writing = null;
  const state = { available: false, error: '' };
  const managed = key => ['xb_entregas_v3', 'xb_entregas_recovery_v1', 'xb_entregas_previous_state_v1', 'xb_cloud_pre_migration_backup_v1'].includes(key)
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

  async function initialize() {
    try {
      database = await new Promise((resolve, reject) => {
        if (!window.indexedDB) return reject(new Error('Armazenamento local ampliado indisponível neste navegador.'));
        const request = window.indexedDB.open(DATABASE, 1);
        let cancelled = false;
        request.onupgradeneeded = () => request.result.createObjectStore(STORE);
        request.onsuccess = () => {
          if (cancelled) request.result.close();
          else resolve(request.result);
        };
        request.onerror = () => reject(request.error || new Error('Não foi possível abrir o cache local.'));
        request.onblocked = () => {
          cancelled = true;
          reject(new Error('Feche outras abas do sistema para atualizar o armazenamento local.'));
        };
      });
      database.onversionchange = () => database.close();
      const stored = await readEntries();
      const legacy = new Map(nativeKeys().filter(managed).map(key => [key, localStorage.getItem(key)]));
      if (legacy.size) {
        await writeEntries(legacy);
        const verified = await readEntries();
        for (const [key, value] of legacy) {
          if (verified.get(key) !== value) throw new Error('A cópia do cache local não foi confirmada.');
        }
        // Libera apenas cópias já confirmadas; não toca na autenticação ou em outros sites.
        for (const [key, value] of legacy) stored.set(key, value);
      }
      for (const [key, value] of stored) snapshots.set(key, value);
      state.available = true;
      for (const [key, value] of legacy) {
        try { if (localStorage.getItem(key) === value) localStorage.removeItem(key); } catch {}
      }
    } catch (error) {
      state.error = String(error?.message || error);
      console.warn('[X-Burguer] Cache ampliado indisponível; mantendo as cópias antigas:', error);
    }
    return state.available;
  }

  function reportFailure(error) {
    state.error = String(error?.message || error);
    console.error('[X-Burguer] Falha ao gravar cache local:', error);
    window.dispatchEvent(new CustomEvent('xb:local-cache-error', { detail: { message: state.error } }));
  }

  function startWriting() {
    if (writing || !pending.size) return writing;
    writing = (async () => {
      while (pending.size) {
        const batch = new Map(pending);
        pending.clear();
        try {
          await writeEntries(batch);
          state.error = '';
        } catch (error) {
          for (const [key, value] of batch) if (!pending.has(key)) pending.set(key, value);
          throw error;
        }
      }
    })().finally(() => { writing = null; });
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
      if (!state.available || !managed(key)) return localStorage.setItem(key, value);
      snapshots.set(key, value);
      pending.set(key, value);
      queueMicrotask(startWriting);
    },
    removeItem(key) {
      key = String(key);
      if (!state.available || !managed(key)) return localStorage.removeItem(key);
      snapshots.delete(key);
      pending.set(key, null);
      queueMicrotask(startWriting);
    },
    get length() { return new Set([...nativeKeys(), ...snapshots.keys()]).size; },
    key(index) { return [...new Set([...nativeKeys(), ...snapshots.keys()])][index] ?? null; },
    async flush() {
      await ready;
      while (writing || pending.size) await (writing || startWriting());
    }
  };
})();
