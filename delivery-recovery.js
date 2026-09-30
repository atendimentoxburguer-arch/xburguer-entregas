(() => {
  if (window.__xbDeliveryRecoveryInstalled) return;
  window.__xbDeliveryRecoveryInstalled = true;

  const cloud = () => window.XBCloud?.client ? window.XBCloud : null;
  const money = value => {
    const amount = Number(value || 0);
    return (Number.isFinite(amount) ? amount : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };
  const escText = value => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
  const normalize = value => String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');

  let deletedDeliveries = [];
  let searchTerm = '';
  let requestId = 0;
  let previousFocus = null;

  function formatDate(value, includeTime = false) {
    if (!value) return 'Data não informada';
    const raw = String(value);
    const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00` : raw);
    if (Number.isNaN(date.getTime())) return 'Data não informada';
    return new Intl.DateTimeFormat('pt-BR', includeTime
      ? { dateStyle: 'short', timeStyle: 'short' }
      : { dateStyle: 'short' }).format(date);
  }

  function ensureModal() {
    let modal = document.getElementById('deliveryTrashModal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.className = 'modal delivery-trash-modal';
    modal.id = 'deliveryTrashModal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'deliveryTrashTitle');
    modal.innerHTML = `
      <div class="modal-card modal-card-lg delivery-trash-dialog" tabindex="-1">
        <div class="modal-head delivery-trash-head">
          <div class="delivery-trash-title-wrap">
            <span class="delivery-trash-mark" aria-hidden="true"><i data-lucide="archive-restore"></i></span>
            <div>
              <span class="modal-kicker">RECUPERAÇÃO SEGURA</span>
              <h3 id="deliveryTrashTitle">Lixeira de entregas</h3>
              <p>As entregas excluídas ficam guardadas para você restaurá-las quando precisar.</p>
            </div>
          </div>
          <div class="delivery-trash-head-actions">
            <span class="delivery-trash-count" id="deliveryTrashCount" aria-live="polite">Carregando</span>
            <button class="modal-close delivery-trash-close" type="button" data-close="deliveryTrashModal" aria-label="Fechar lixeira"><i data-lucide="x"></i></button>
          </div>
        </div>
        <div class="delivery-trash-toolbar" id="deliveryTrashToolbar" hidden>
          <label class="delivery-trash-search">
            <i data-lucide="search" aria-hidden="true"></i>
            <input id="deliveryTrashSearch" type="search" placeholder="Buscar por pedido, cliente ou endereço" aria-label="Buscar na lixeira">
          </label>
          <span class="delivery-trash-results" id="deliveryTrashResults" role="status"></span>
          <button class="btn btn-light btn-sm delivery-trash-refresh" type="button" data-trash-refresh aria-label="Atualizar lixeira" title="Atualizar"><i data-lucide="refresh-cw"></i><span>Atualizar</span></button>
        </div>
        <div class="modal-body delivery-trash-body" id="deliveryTrashBody" aria-live="polite" aria-busy="false"></div>
      </div>`;

    document.body.appendChild(modal);
    modal.addEventListener('click', event => {
      if (event.target === modal || event.target.closest?.('[data-close="deliveryTrashModal"]')) closeModal();
      if (event.target.closest?.('[data-trash-refresh]')) loadTrash();
      if (event.target.closest?.('#deliveryTrashClearSearch')) {
        searchTerm = '';
        const input = modal.querySelector('#deliveryTrashSearch');
        if (input) {
          input.value = '';
          input.focus();
        }
        renderTrashRows();
      }
    });
    modal.addEventListener('input', event => {
      if (event.target?.id !== 'deliveryTrashSearch') return;
      searchTerm = event.target.value;
      renderTrashRows();
    });
    modal.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeModal();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...modal.querySelectorAll('button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')]
        .filter(element => !element.hidden && element.offsetParent !== null);
      if (!focusable.length) {
        event.preventDefault();
        modal.querySelector('.delivery-trash-dialog')?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    return modal;
  }

  function setCount(text, hasItems = false) {
    const count = document.getElementById('deliveryTrashCount');
    if (!count) return;
    count.textContent = text;
    count.classList.toggle('has-items', hasItems);
  }

  function setState(markup, { count = ' ', busy = false, showToolbar = false } = {}) {
    const modal = document.getElementById('deliveryTrashModal');
    const body = modal?.querySelector('#deliveryTrashBody');
    if (!modal || !body) return;
    body.innerHTML = markup;
    body.setAttribute('aria-busy', String(busy));
    modal.querySelector('#deliveryTrashToolbar').hidden = !showToolbar;
    setCount(count, deletedDeliveries.length > 0);
    if (typeof refreshIcons === 'function') refreshIcons();
  }

  function openModal() {
    const modal = ensureModal();
    if (!modal.classList.contains('open')) {
      previousFocus = document.activeElement;
      modal.classList.add('open');
      document.body.style.overflow = 'hidden';
      requestAnimationFrame(() => modal.querySelector('.delivery-trash-close')?.focus({ preventScroll: true }));
    }
    return modal;
  }

  function closeModal() {
    const modal = document.getElementById('deliveryTrashModal');
    if (!modal) return;
    modal.classList.remove('open');
    if (!document.querySelector('.modal.open')) document.body.style.overflow = '';
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  }

  function renderTrashRows() {
    const modal = document.getElementById('deliveryTrashModal');
    const body = modal?.querySelector('#deliveryTrashBody');
    if (!modal || !body || !deletedDeliveries.length) return;

    const term = normalize(searchTerm.trim());
    const rows = deletedDeliveries.filter(item => {
      const searchable = normalize([
        item.code,
        item.client,
        item.address,
        item.businessDate,
        item.status
      ].join(' '));
      return !term || searchable.includes(term);
    });
    const countText = `${deletedDeliveries.length} ${deletedDeliveries.length === 1 ? 'entrega' : 'entregas'}`;
    setCount(countText, true);
    const results = modal.querySelector('#deliveryTrashResults');
    if (results) results.textContent = `Exibindo ${rows.length} de ${deletedDeliveries.length}`;
    body.setAttribute('aria-busy', 'false');

    if (!rows.length) {
      body.innerHTML = `
        <div class="delivery-trash-state">
          <span class="delivery-trash-state-icon"><i data-lucide="search-x"></i></span>
          <strong>Nenhum pedido encontrado</strong>
          <span>Tente outro termo ou limpe a busca.</span>
          <button class="btn btn-light btn-sm" type="button" id="deliveryTrashClearSearch">Limpar busca</button>
        </div>`;
      if (typeof refreshIcons === 'function') refreshIcons();
      return;
    }

    body.innerHTML = `
      <div class="delivery-trash-list" aria-label="Entregas excluídas">
        ${rows.map(item => {
          const code = String(item.code || '').padStart(3, '0');
          const businessDate = formatDate(item.businessDate);
          return `
            <article class="delivery-trash-row">
              <div class="delivery-trash-info">
                <div class="delivery-trash-row-top">
                  <strong class="delivery-trash-code">#${escText(code)}</strong>
                  <span class="delivery-trash-status"><i data-lucide="archive"></i>Na lixeira</span>
                </div>
                <h4>${escText(item.client || 'Cliente não informado')}</h4>
                <div class="delivery-trash-meta">
                  <span><i data-lucide="map-pin"></i>${escText(item.address || 'Endereço não informado')}</span>
                  <span><i data-lucide="calendar-days"></i>Dia comercial ${escText(businessDate)}</span>
                  <span><i data-lucide="banknote"></i>${escText(money(item.orderValue))}</span>
                </div>
                <small class="delivery-trash-deleted">Excluída em ${escText(formatDate(item.deletedAt, true))}</small>
              </div>
              <button class="btn btn-light btn-sm delivery-trash-restore" type="button" data-restore-trash="${escText(item.id)}" data-restore-code="${escText(code)}" aria-label="Restaurar entrega ${escText(code)}">
                <i data-lucide="rotate-ccw"></i><span>Restaurar entrega</span>
              </button>
            </article>`;
        }).join('')}
      </div>`;
    if (typeof refreshIcons === 'function') refreshIcons();
  }

  async function loadTrash() {
    const box = openModal();
    const currentRequest = ++requestId;
    deletedDeliveries = [];
    const refreshButton = box.querySelector('[data-trash-refresh]');
    if (refreshButton) refreshButton.disabled = true;
    setState(`
      <div class="delivery-trash-state delivery-trash-loading">
        <span class="delivery-trash-spinner" aria-hidden="true"></span>
        <strong>Carregando a lixeira</strong>
        <span>Buscando as entregas excluídas com segurança.</span>
      </div>`, { count: 'Carregando', busy: true });

    const xb = cloud();
    if (!xb) {
      if (refreshButton) refreshButton.disabled = false;
      setState(`
        <div class="delivery-trash-state">
          <span class="delivery-trash-state-icon"><i data-lucide="cloud-off"></i></span>
          <strong>Banco online indisponível</strong>
          <span>Conecte-se ao banco para consultar as entregas excluídas.</span>
          <button class="btn btn-light btn-sm" type="button" data-trash-refresh>Tentar novamente</button>
        </div>`, { count: 'Offline' });
      return;
    }

    try {
      const { data, error } = await xb.client.rpc('xb_list_deleted_deliveries');
      if (currentRequest !== requestId) return;
      if (error) throw error;

      deletedDeliveries = Array.isArray(data) ? data : [];
      if (!deletedDeliveries.length) {
        searchTerm = '';
        const input = box.querySelector('#deliveryTrashSearch');
        if (input) input.value = '';
        setState(`
          <div class="delivery-trash-state">
            <span class="delivery-trash-state-icon"><i data-lucide="archive-x"></i></span>
            <strong>A lixeira está vazia</strong>
            <span>Quando uma entrega for excluída, ela ficará disponível aqui para restauração.</span>
          </div>`, { count: '0 entregas' });
        return;
      }

      const input = box.querySelector('#deliveryTrashSearch');
      if (input) input.value = searchTerm;
      setState('<div class="delivery-trash-list"></div>', {
        count: `${deletedDeliveries.length} ${deletedDeliveries.length === 1 ? 'entrega' : 'entregas'}`,
        showToolbar: true
      });
      renderTrashRows();
    } catch (error) {
      if (currentRequest !== requestId) return;
      setState(`
        <div class="delivery-trash-state">
          <span class="delivery-trash-state-icon"><i data-lucide="triangle-alert"></i></span>
          <strong>Não foi possível carregar a lixeira</strong>
          <span>${escText(error?.message || error || 'Ocorreu um erro inesperado.')}</span>
          <button class="btn btn-light btn-sm" type="button" data-trash-refresh>Tentar novamente</button>
        </div>`, { count: 'Erro' });
    } finally {
      if (currentRequest === requestId && refreshButton) refreshButton.disabled = false;
    }
  }

  document.getElementById('deliveryTrashBtn')?.addEventListener('click', loadTrash);

  document.addEventListener('click', async event => {
    const button = event.target.closest?.('[data-restore-trash]');
    if (!button) return;
    const id = button.dataset.restoreTrash;
    const code = button.dataset.restoreCode || '';
    if (!id || button.disabled) return;
    if (!confirm(`Restaurar a entrega #${code}? Ela voltará para a lista de entregas.`)) return;

    const originalMarkup = button.innerHTML;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.innerHTML = '<span class="delivery-trash-button-spinner" aria-hidden="true"></span><span>Restaurando…</span>';
    try {
      const xb = cloud();
      if (!xb) throw new Error('Banco online indisponível.');
      const { data, error } = await xb.client.rpc('xb_restore_deleted_delivery', { p_id: id });
      if (error) throw error;
      await xb.pullNow?.();
      if (typeof renderAll === 'function') renderAll();
      if (typeof toast === 'function') toast(`Entrega #${String(data?.code || code).padStart(3, '0')} restaurada.`);
      await loadTrash();
    } catch (error) {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.innerHTML = originalMarkup;
      if (typeof refreshIcons === 'function') refreshIcons();
      if (typeof toast === 'function') toast(String(error?.message || 'Não foi possível restaurar a entrega.'), 'error');
    }
  });

  const style = document.createElement('style');
  style.id = 'xbDeliveryRecoveryStyles';
  style.textContent = `
    #deliveryTrashModal{z-index:510}
    #deliveryTrashModal .delivery-trash-dialog{display:flex;flex-direction:column;width:min(780px,100%);max-height:min(88vh,820px);overflow:hidden;border-radius:22px}
    #deliveryTrashModal .delivery-trash-head{min-height:unset;gap:18px;padding:21px 24px;background:linear-gradient(135deg,#fff 0%,#fff9f5 100%);border-bottom:1px solid #eee5df}
    .delivery-trash-title-wrap{display:flex;align-items:center;gap:14px;min-width:0}
    .delivery-trash-mark{width:44px;height:44px;flex:0 0 44px;display:grid;place-items:center;border:1px solid #f0d8d4;border-radius:14px;background:#fff1ef;color:#a20d17}
    .delivery-trash-mark svg{width:21px;height:21px}
    #deliveryTrashModal .delivery-trash-head .modal-kicker{margin-bottom:4px;font-size:10px}
    #deliveryTrashModal .delivery-trash-head h3{margin:0;color:#241c19;font-size:20px;font-weight:800;letter-spacing:-.025em}
    #deliveryTrashModal .delivery-trash-head p{margin:5px 0 0;color:#756c66;font-size:13px;line-height:1.5}
    .delivery-trash-head-actions{display:flex;align-items:center;gap:10px;flex:0 0 auto}
    .delivery-trash-count{display:inline-flex;align-items:center;min-height:30px;padding:0 11px;border:1px solid #e9dfd9;border-radius:999px;background:#fff;color:#746a64;font-size:12px;font-weight:700;white-space:nowrap}
    .delivery-trash-count.has-items{border-color:#f0d6d2;background:#fff1ef;color:#a20d17}
    #deliveryTrashModal .delivery-trash-close{width:36px;height:36px;flex:0 0 36px}
    .delivery-trash-toolbar{display:flex;align-items:center;gap:12px;padding:15px 22px 0;background:#fff}
    .delivery-trash-search{height:42px;min-width:0;flex:1;display:flex;align-items:center;gap:10px;padding:0 12px;border:1px solid #e8e1dc;border-radius:12px;background:#fbfaf9;color:#847a74;transition:border-color .16s ease,box-shadow .16s ease}
    .delivery-trash-search:focus-within{border-color:#bd7b76;box-shadow:0 0 0 3px rgba(162,13,23,.08)}
    .delivery-trash-search svg{width:17px;height:17px;flex:0 0 17px}
    .delivery-trash-search input{width:100%;min-width:0;border:0;outline:0;background:transparent;color:#29211d;font:inherit;font-size:13px}
    .delivery-trash-search input::placeholder{color:#a39a94}
    .delivery-trash-results{color:#827872;font-size:12px;white-space:nowrap}
    .delivery-trash-refresh{height:38px;flex:0 0 auto;gap:7px}
    .delivery-trash-refresh svg{width:15px;height:15px}
    #deliveryTrashModal .delivery-trash-body{min-height:230px;overflow:auto;overscroll-behavior:contain;padding:16px 22px 22px;background:#f8f6f4}
    .delivery-trash-list{display:grid;gap:10px}
    .delivery-trash-row{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:16px 17px;border:1px solid #ebe3dd;border-radius:16px;background:#fff;box-shadow:0 2px 7px rgba(49,31,24,.035);transition:border-color .16s ease,box-shadow .16s ease,transform .16s ease}
    .delivery-trash-row:hover{transform:translateY(-1px);border-color:#dfc9c2;box-shadow:0 7px 19px rgba(49,31,24,.07)}
    .delivery-trash-info{min-width:0;display:grid;gap:7px}
    .delivery-trash-row-top{display:flex;align-items:center;gap:9px}
    .delivery-trash-code{color:#a20d17;font-size:15px;font-weight:800}
    .delivery-trash-status{display:inline-flex;align-items:center;gap:4px;color:#8b625d;font-size:10px;font-weight:700}
    .delivery-trash-status svg{width:12px;height:12px}
    .delivery-trash-row h4{margin:0;overflow-wrap:anywhere;color:#2b211e;font-size:14px;font-weight:750}
    .delivery-trash-meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px 15px;color:#746a64;font-size:12px;line-height:1.45}
    .delivery-trash-meta span{display:inline-flex;align-items:flex-start;gap:5px;min-width:0;overflow-wrap:anywhere}
    .delivery-trash-meta svg{width:14px;height:14px;flex:0 0 14px;margin-top:1px;color:#9a8d86}
    .delivery-trash-deleted{color:#9a9089;font-size:11px;line-height:1.4}
    #deliveryTrashModal .delivery-trash-restore{min-height:40px;flex:0 0 auto;gap:7px;border-color:#eadbd5;background:#fffdfa;color:#554843;white-space:nowrap}
    #deliveryTrashModal .delivery-trash-restore:hover:not(:disabled){border-color:#c68c85;background:#fff4f2;color:#970c15}
    #deliveryTrashModal .delivery-trash-restore svg{width:16px;height:16px}
    #deliveryTrashModal .delivery-trash-restore:disabled{cursor:wait;opacity:.7}
    .delivery-trash-state{min-height:190px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:26px 18px;text-align:center}
    .delivery-trash-state-icon{width:48px;height:48px;display:grid;place-items:center;margin-bottom:4px;border:1px solid #eee1dc;border-radius:16px;background:#fff;color:#a20d17}
    .delivery-trash-state-icon svg{width:22px;height:22px}
    .delivery-trash-state strong{color:#302622;font-size:15px;font-weight:800}
    .delivery-trash-state>span:not(.delivery-trash-state-icon):not(.delivery-trash-spinner){max-width:420px;color:#817771;font-size:13px;line-height:1.55}
    .delivery-trash-state .btn{margin-top:6px}
    .delivery-trash-spinner,.delivery-trash-button-spinner{width:23px;height:23px;border:2px solid #efdbd8;border-top-color:#a20d17;border-radius:50%;animation:delivery-trash-spin .7s linear infinite}
    .delivery-trash-spinner{margin-bottom:8px}
    .delivery-trash-button-spinner{width:15px;height:15px;border-width:2px}
    @keyframes delivery-trash-spin{to{transform:rotate(360deg)}}
    @media(max-width:650px){
      #deliveryTrashModal{padding:10px}
      #deliveryTrashModal .delivery-trash-dialog{max-height:94vh;border-radius:18px}
      #deliveryTrashModal .delivery-trash-head{align-items:flex-start;padding:17px 16px}
      .delivery-trash-title-wrap{align-items:flex-start;gap:10px}
      .delivery-trash-mark{width:38px;height:38px;flex-basis:38px;border-radius:12px}
      #deliveryTrashModal .delivery-trash-head h3{font-size:17px}
      #deliveryTrashModal .delivery-trash-head p{font-size:12px}
      .delivery-trash-head-actions{gap:6px}
      .delivery-trash-count{padding:0 8px;font-size:11px}
      .delivery-trash-toolbar{flex-wrap:wrap;gap:8px;padding:12px 14px 0}
      .delivery-trash-search{flex-basis:calc(100% - 105px)}
      .delivery-trash-results{order:3;flex:1}
      #deliveryTrashModal .delivery-trash-body{min-height:190px;padding:12px 14px 16px}
      .delivery-trash-row{align-items:stretch;flex-direction:column;gap:12px;padding:14px}
      .delivery-trash-row h4{font-size:14px}
      .delivery-trash-meta{gap:6px 11px;font-size:11px}
      #deliveryTrashModal .delivery-trash-restore{width:100%;justify-content:center}
    }
    @media(max-width:390px){
      .delivery-trash-mark{display:none}
      .delivery-trash-title-wrap{gap:0}
      #deliveryTrashModal .delivery-trash-head{padding-inline:13px}
      .delivery-trash-results{font-size:11px}
    }
    @media(prefers-reduced-motion:reduce){.delivery-trash-row,.delivery-trash-spinner,.delivery-trash-button-spinner{animation:none;transition:none}}
  `;
  document.head.appendChild(style);
})();
