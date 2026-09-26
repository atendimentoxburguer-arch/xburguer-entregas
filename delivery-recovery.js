(() => {
  if (window.__xbDeliveryRecoveryInstalled) return;
  window.__xbDeliveryRecoveryInstalled = true;

  const cloud = () => window.XBCloud?.client ? window.XBCloud : null;
  const money = value => Number(value || 0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const escText = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#039;");

  function ensureModal() {
    let modal=document.getElementById('deliveryTrashModal');
    if(modal) return modal;
    modal=document.createElement('div');
    modal.className='modal';
    modal.id='deliveryTrashModal';
    modal.innerHTML=`
      <div class="modal-dialog modal-lg">
        <div class="modal-head">
          <div><span class="modal-kicker">RECUPERAÇÃO</span><h3>Lixeira de entregas</h3><p>Pedidos excluídos ficam preservados no banco para evitar perda acidental.</p></div>
          <button class="icon-btn" type="button" data-close="deliveryTrashModal" aria-label="Fechar"><i data-lucide="x"></i></button>
        </div>
        <div class="modal-body" id="deliveryTrashBody"></div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click',event=>{if(event.target===modal) modal.classList.remove('open');});
    return modal;
  }

  async function loadTrash() {
    const box=ensureModal();
    const body=box.querySelector('#deliveryTrashBody');
    body.innerHTML='<div class="empty"><b>Carregando lixeira...</b></div>';
    box.classList.add('open');
    if(typeof refreshIcons==='function') refreshIcons();

    const xb=cloud();
    if(!xb) {
      body.innerHTML='<div class="empty"><b>Lixeira disponível apenas com o banco online.</b></div>';
      return;
    }

    const {data,error}=await xb.client.rpc('xb_list_deleted_deliveries');
    if(error) {
      body.innerHTML=`<div class="empty"><b>Não foi possível carregar a lixeira.</b><span>${escText(error.message || error)}</span></div>`;
      return;
    }

    const rows=Array.isArray(data)?data:[];
    if(!rows.length) {
      body.innerHTML='<div class="empty"><b>Lixeira vazia</b><span>Nenhuma entrega excluída foi encontrada.</span></div>';
      return;
    }

    body.innerHTML=`
      <div class="delivery-trash-list">
        ${rows.map(item=>`
          <article class="delivery-trash-row">
            <div>
              <strong>#${String(item.code||'').padStart(3,'0')}</strong>
              <span>${escText(item.client || 'Cliente não informado')}</span>
              <small>${escText(item.address || 'Sem endereço')} · ${money(item.orderValue)} · dia comercial ${escText(String(item.businessDate||'').split('-').reverse().join('/'))}</small>
            </div>
            <button class="btn btn-light btn-sm" type="button" data-restore-trash="${escText(item.id)}"><i data-lucide="rotate-ccw"></i>Restaurar</button>
          </article>`).join('')}
      </div>`;
    if(typeof refreshIcons==='function') refreshIcons();
  }

  document.getElementById('deliveryTrashBtn')?.addEventListener('click',loadTrash);

  document.addEventListener('click',async event=>{
    const button=event.target.closest?.('[data-restore-trash]');
    if(!button) return;
    const id=button.dataset.restoreTrash;
    if(!id) return;
    if(!confirm('Restaurar esta entrega?')) return;
    button.disabled=true;
    try {
      const xb=cloud();
      if(!xb) throw new Error('Banco online indisponível.');
      const {data,error}=await xb.client.rpc('xb_restore_deleted_delivery',{p_id:id});
      if(error) throw error;
      await xb.pullNow?.();
      if(typeof renderAll==='function') renderAll();
      if(typeof toast==='function') toast(`Entrega #${String(data?.code||'').padStart(3,'0')} restaurada.`);
      loadTrash();
    } catch(error) {
      button.disabled=false;
      if(typeof toast==='function') toast(String(error?.message||'Não foi possível restaurar a entrega.'),'error');
    }
  });

  const style=document.createElement('style');
  style.id='xbDeliveryRecoveryStyles';
  style.textContent=`
    #deliveryTrashModal .modal-dialog{max-width:760px}
    .delivery-trash-list{display:grid;gap:10px}
    .delivery-trash-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 15px;border:1px solid #eadfd7;border-radius:14px;background:linear-gradient(135deg,#fff,#faf3ed)}
    .delivery-trash-row>div{min-width:0;display:grid;gap:4px}
    .delivery-trash-row strong{color:#8f0710}
    .delivery-trash-row span{font-weight:700;color:#2b211e}
    .delivery-trash-row small{color:#756862;line-height:1.4}
    @media(max-width:650px){.delivery-trash-row{align-items:stretch;flex-direction:column}.delivery-trash-row .btn{width:100%}}
  `;
  document.head.appendChild(style);
})();