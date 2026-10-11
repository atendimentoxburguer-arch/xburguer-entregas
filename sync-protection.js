(() => {
  if (window.__xbSyncProtectionInstalled) return;
  window.__xbSyncProtectionInstalled = true;
  const cache = window.XBLocalCache;
  if (!cache) return;

  function downloadRecovery() {
    const snapshot = typeof db === 'object' ? JSON.parse(JSON.stringify(db)) : {};
    if (snapshot.settings) { delete snapshot.settings.password; delete snapshot.settings.email; }
    const copies = cache.snapshot();
    for (const [key, raw] of Object.entries(copies)) {
      try {
        const copy = JSON.parse(raw);
        const settings = copy?.db?.settings || copy?.settings;
        if (settings) { delete settings.password; delete settings.email; }
        copies[key] = JSON.stringify(copy);
      } catch { /* Preserva também uma cópia inválida para recuperação técnica. */ }
    }
    const blob = new Blob([JSON.stringify({ ...snapshot, backupFormat: 'xburguer-backup-v2',
      backupGeneratedAt: new Date().toISOString(), localRecovery: copies }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `xburguer-recuperacao-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function install() {
    if (!document.getElementById('xbStorageProtectionStyle')) {
      const style = document.createElement('style');
      style.id = 'xbStorageProtectionStyle';
      style.textContent = '.xb-storage-warning{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:9000;width:min(680px,calc(100% - 24px));padding:16px;background:#fff4dd;border:1px solid #e2b969;border-radius:16px;box-shadow:0 8px 30px #0002;color:#684400}.xb-storage-warning[hidden],#xbSafeUpdateBtn[hidden],#xbProtectStorageBtn[hidden],#xbStorageRetry[hidden]{display:none}.xb-storage-warning p{margin:8px 0}.xb-storage-warning .actions{display:flex;gap:8px;flex-wrap:wrap}';
      document.head.appendChild(style);
    }
    if (!document.getElementById('xbStorageWarning')) {
      const banner = document.createElement('div');
      banner.id = 'xbStorageWarning';
      banner.className = 'xb-storage-warning';
      banner.setAttribute('role', 'alert');
      banner.hidden = true;
      banner.innerHTML = '<strong>Gravação local precisa de atenção</strong><p id="xbStorageWarningText"></p><div class="actions"><button id="xbStorageRetry" class="btn btn-light btn-sm" type="button">Tentar gravar novamente</button><button id="xbStorageBackup" class="btn btn-light btn-sm" type="button">Baixar cópia de segurança</button></div>';
      document.body.appendChild(banner);
      banner.querySelector('#xbStorageBackup').addEventListener('click', downloadRecovery);
      banner.querySelector('#xbStorageRetry').addEventListener('click', async event => {
        event.currentTarget.disabled = true;
        try {
          await cache.flush();
          await window.XBCloud?.syncNow?.();
          await window.XBCloud?.pullNow?.();
        } catch (error) { if (typeof toast === 'function') toast(String(error?.message || error), 'error'); }
        finally { event.currentTarget.disabled = false; update(); }
      });
    }
    const grid = document.querySelector('#databaseReadinessCard .db-status-grid');
    if (grid && !document.getElementById('xbLocalWriteStatus')) {
      const rows = document.createElement('div');
      rows.innerHTML = '<div class="db-status-row"><span>Gravação neste aparelho</span><strong id="xbLocalWriteStatus"></strong></div><div class="db-status-row"><span>Espaço do site (estimativa)</span><strong id="xbStorageUsage"></strong></div><div class="db-status-row"><span>Proteção da cópia local</span><strong id="xbStoragePersistence"></strong></div>';
      [...rows.children].forEach(row => grid.appendChild(row));
      const button = document.createElement('button');
      button.className = 'btn btn-light btn-sm';
      button.type = 'button';
      button.id = 'xbProtectStorageBtn';
      button.textContent = 'Proteger cópia local';
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          const granted = await cache.protect();
          if (typeof toast === 'function') toast(granted ? 'Proteção local ativada neste navegador.' : 'O navegador não concedeu proteção permanente. Mantenha seus backups baixados.', granted ? 'ok' : 'error');
        } catch (error) { if (typeof toast === 'function') toast(String(error?.message || error), 'error'); }
        finally { button.disabled = false; update(); }
      });
      document.querySelector('#databaseReadinessCard .db-actions')?.appendChild(button);
    }
    const actions = document.querySelector('#databaseReadinessCard .db-actions');
    if (actions && !document.getElementById('xbLegacyCopiesNotice')) {
      let copies;
      try { copies = JSON.parse(cache.getItem('xb_cache_legacy_conflicts_v1') || '{"entries":[]}').entries; } catch { copies = []; }
      if (copies?.length) {
        const notice = document.createElement('div');
        notice.id = 'xbLegacyCopiesNotice';
        notice.className = 'db-status-row';
        const text = document.createElement('span');
        text.textContent = `${copies.length} cópia(s) antiga(s) preservada(s) neste aparelho para conferência.`;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-light btn-sm';
        button.textContent = 'Baixar cópias locais';
        button.addEventListener('click', downloadRecovery);
        notice.append(text, button);
        document.getElementById('databaseReadinessCard').appendChild(notice);
      }
    }
    if (actions && !document.getElementById('xbSafeUpdateBtn')) {
      const button = document.createElement('button');
      button.id = 'xbSafeUpdateBtn';
      button.type = 'button';
      button.className = 'btn btn-light btn-sm';
      button.textContent = 'Atualizar aplicativo';
      button.addEventListener('click', async () => {
        const editing = ['deliveryAddress', 'deliveryClient', 'deliveryPhone', 'deliveryNotes'].some(id => document.getElementById(id)?.value.trim());
        if (editing) { if (typeof toast === 'function') toast('Conclua ou limpe a nova entrega antes de atualizar o aplicativo.', 'error'); return; }
        button.disabled = true;
        try {
          await cache.flush();
          if (window.XBCloud?.pendingChanges) {
            const sent = await window.XBCloud.syncNow();
            if (!sent || window.XBCloud.pendingChanges) throw new Error('A atualização aguarda o envio das alterações. Tente novamente após sincronizar.');
          }
          location.reload();
        } catch (error) { if (typeof toast === 'function') toast(String(error?.message || error), 'error'); }
        finally { button.disabled = false; }
      });
      actions.appendChild(button);
    }
  }

  function update() {
    install();
    const state = cache.state;
    const write = document.getElementById('xbLocalWriteStatus');
    if (write) {
      write.textContent = state.error ? 'Falha · baixe uma cópia' : (state.pending ? 'Gravando alterações...' : (state.available ? 'Confirmada' : 'Armazenamento limitado'));
      write.classList.toggle('db-ready', !state.error && !state.pending && state.available);
    }
    const usage = document.getElementById('xbStorageUsage');
    const percent = state.quota > 0 && state.usage !== null ? Math.round(state.usage / state.quota * 100) : null;
    if (usage) usage.textContent = percent === null ? 'Não informada pelo navegador' : `${percent}% utilizado`;
    const protection = document.getElementById('xbStoragePersistence');
    if (protection) protection.textContent = state.persistent === true ? 'Protegida pelo navegador' : 'Mantenha backup fora do aparelho';
    const button = document.getElementById('xbProtectStorageBtn');
    if (button) button.hidden = state.persistent === true || !navigator.storage?.persist;
    const updateButton = document.getElementById('xbSafeUpdateBtn');
    if (updateButton) updateButton.hidden = !window.__xbUpdateWaiting;
    const banner = document.getElementById('xbStorageWarning');
    banner.hidden = !state.error && !(percent >= 90);
    document.getElementById('xbStorageRetry').hidden = !state.error;
    document.getElementById('xbStorageWarningText').textContent = state.error
      ? `As novas alterações ainda não tiveram a gravação confirmada. Mantenha o sistema aberto e baixe uma cópia de segurança. O sistema tentará gravar novamente. Motivo: ${state.error}`
      : 'O espaço disponível para o site está próximo do limite. Baixe uma cópia de segurança e libere espaço no aparelho.';
  }

  function guard(event) {
    if (!cache.state.error || !event.target?.closest?.('#appView')) return;
    if (event.type === 'click' && !event.target.closest('button[type="submit"], [data-delivery-action], #closeDayBtn, #reopenDayBtn, #restoreRecoveryBtn')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (typeof toast === 'function') toast('Aguarde a confirmação da gravação local ou baixe uma cópia antes de continuar.', 'error');
  }
  document.addEventListener('submit', guard, true);
  document.addEventListener('click', guard, true);
  ['xb:local-cache-state', 'xb:local-cache-error', 'xb:system-ready', 'xb:cloud-ready', 'xb:update-ready'].forEach(name => window.addEventListener(name, update));
  update();
})();
