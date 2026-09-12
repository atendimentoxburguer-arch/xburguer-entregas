(() => {
  if (window.__xbCoreSafetyInstalled) return;
  window.__xbCoreSafetyInstalled = true;

  const config = window.XB_SUPABASE_CONFIG || {};
  if (!config.enabled) return;

  const isLegacyDemoCouriers = list => {
    if (!Array.isArray(list) || list.length !== 3) return false;
    const expected = new Map([
      ['carlos', 'Carlos Oliveira'],
      ['ana', 'Ana Paula'],
      ['bruno', 'Bruno Santos']
    ]);
    return list.every(item => expected.get(String(item?.id || '')) === String(item?.name || ''));
  };

  // A base de produção não depende mais de usuário/senha locais nem de entregadores
  // de demonstração. Mantemos a função para compatibilidade com módulos legados,
  // porém devolvendo apenas uma estrutura vazia e segura.
  if (typeof initialDB === 'function' && !initialDB.__xbSafeInitialDB) {
    const legacyInitialDB = initialDB;
    const safeInitialDB = function xbSafeInitialDB() {
      const base = legacyInitialDB();
      base.settings = {
        ...(base.settings || {}),
        storeName: base.settings?.storeName || 'X-Burguer Entregas',
        defaultFee: Number(base.settings?.defaultFee || 6),
        email: '',
        password: ''
      };
      base.couriers = [];
      base.deliveries = [];
      base.closings = [];
      return base;
    };
    safeInitialDB.__xbSafeInitialDB = true;
    initialDB = safeInitialDB;
  }

  let changed = false;
  if (db?.settings) {
    if (db.settings.password) {
      db.settings.password = '';
      changed = true;
    }
    // O e-mail de autenticação vem do Supabase Auth; não deve funcionar como
    // credencial local alternativa.
    if (db.settings.email) {
      db.settings.email = '';
      changed = true;
    }
  }

  if (!db?.deliveries?.length && !db?.closings?.length && isLegacyDemoCouriers(db?.couriers)) {
    db.couriers = [];
    changed = true;
  }

  // Elimina qualquer sessão local antiga antes de o guardião de autenticação
  // assumir o controle. Isso evita até mesmo um breve acesso usando cache antigo.
  try { sessionStorage.removeItem(SESSION_KEY); } catch {}
  document.getElementById('appView')?.classList.add('hidden');
  document.getElementById('loginView')?.classList.remove('hidden');

  if (changed) {
    try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch {}
  }
})();
