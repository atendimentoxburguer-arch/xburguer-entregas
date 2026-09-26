(() => {
  if (window.__xbAtomicDeliveryCodeInstalled) return;
  window.__xbAtomicDeliveryCodeInstalled = true;

  const config = window.XB_SUPABASE_CONFIG || {};
  if (!config.enabled) return;

  const form = document.getElementById('deliveryForm');
  if (!form) return;

  let submitting = false;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function notify(message, type = 'ok') {
    if (typeof toast === 'function') toast(message, type);
    else console.info(`[X-Burguer] ${message}`);
  }

  async function waitForCloud(timeoutMs = 15000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const cloud = window.XBCloud;
      if (cloud?.configured && cloud?.client) return cloud;
      await sleep(120);
    }
    return null;
  }

  async function createDeliveryAuthoritatively(payload) {
    if (!navigator.onLine) throw new Error('Conecte à internet para cadastrar a entrega com segurança.');

    const cloud = await waitForCloud();
    if (!cloud?.client) throw new Error('Banco online indisponível.');

    const { data: sessionData, error: sessionError } = await cloud.client.auth.getSession();
    if (sessionError) throw sessionError;
    if (!sessionData?.session?.user) throw new Error('AUTH_REQUIRED');

    const { data, error } = await cloud.client.rpc('xb_create_delivery', {
      p_id: payload.id,
      p_client: payload.client,
      p_phone: payload.phone,
      p_address: payload.address,
      p_reference: payload.reference || '',
      p_courier_id: payload.courierId,
      p_order_value: payload.orderValue,
      p_payment: payload.payment,
      p_change_for: payload.changeFor === '' ? null : payload.changeFor,
      p_notes: payload.notes
    });
    if (error) throw error;
    if (!data?.id || !Number(data.code)) throw new Error('O banco não confirmou a nova entrega.');
    return {
      id: data.id,
      code: Number(data.code),
      client: data.client || '',
      phone: data.phone || '',
      address: data.address || '',
      reference: data.reference || '',
      courierId: data.courierId || null,
      fee: Number(data.fee || 0),
      orderValue: Number(data.orderValue || 0),
      payment: data.payment || 'Dinheiro',
      changeFor: data.changeFor === null || data.changeFor === undefined ? '' : Number(data.changeFor),
      notes: data.notes || '',
      status: data.status || 'Aguardando',
      paymentConfirmedAt: data.paymentConfirmedAt || '',
      createdAt: data.createdAt,
      updatedAt: data.updatedAt || data.createdAt,
      businessDate: data.businessDate || ''
    };
  }

  async function waitForDeliveryInCloud(cloud, item, timeoutMs = 7000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      try {
        const sent = await cloud.syncNow?.();
        if (sent !== false && Number(cloud.pendingChanges || 0) === 0) {
          const { data: remote, error } = await cloud.client
            .from('deliveries')
            .select('id,code')
            .eq('user_id', (await cloud.client.auth.getUser()).data?.user?.id || '')
            .eq('id', item.id)
            .maybeSingle();
          if (!error && remote?.id === item.id && Number(remote.code) === Number(item.code)) {
            return true;
          }
        }
      } catch (error) {
        console.warn('[X-Burguer] Conferência da nova entrega:', error);
      }
      await sleep(250);
    }
    return false;
  }

  function resetDeliveryForm(target) {
    target.reset();
    const reference = document.getElementById('deliveryReference');
    const fee = document.getElementById('deliveryFee');
    const value = document.getElementById('deliveryValue');
    if (reference) reference.value = '';
    if (fee) fee.value = Number(db.settings.defaultFee || 0).toFixed(2);
    if (value) value.value = '0';
    if (typeof syncPaymentFields === 'function') syncPaymentFields();
  }

  async function handleSubmit(event) {
    event.preventDefault();
    event.stopImmediatePropagation();

    if (submitting) return;
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const submit = form.querySelector('button[type="submit"]');
    const originalHtml = submit?.innerHTML || '';
    submitting = true;
    if (submit) {
      submit.disabled = true;
      submit.textContent = 'Reservando número...';
    }

    try {
      const payment = document.querySelector('input[name="payment"]:checked')?.value || 'Dinheiro';
      const draft = {
        id: uid('delivery'),
        client: document.getElementById('deliveryClient').value.trim(),
        phone: document.getElementById('deliveryPhone').value.trim(),
        address: document.getElementById('deliveryAddress').value.trim(),
        reference: '',
        courierId: document.getElementById('deliveryCourier').value || null,
        orderValue: Number(document.getElementById('deliveryValue').value || 0),
        payment,
        changeFor: document.getElementById('deliveryChange').value
          ? Number(document.getElementById('deliveryChange').value)
          : '',
        notes: document.getElementById('deliveryNotes').value.trim()
      };

      const item = await createDeliveryAuthoritatively(draft);
      db.settings = db.settings || {};
      if (item.businessDate) db.settings.activeBusinessDate = item.businessDate;
      db.deliveries.push(item);
      db.settings.nextDeliveryCode = Math.max(Number(db.settings.nextDeliveryCode || 1), item.code + 1);
      save();

      window.XBProduction?.clearDraft?.();
      window.dispatchEvent(new CustomEvent('xb:delivery-created', {
        detail: { id: item.id, code: item.code, createdAt: item.createdAt, businessDate: item.businessDate, synced: true }
      }));

      resetDeliveryForm(event.target);
      notify(`Entrega #${String(item.code).padStart(3, '0')} cadastrada e confirmada no banco. Dia comercial: ${String(item.businessDate || '').split('-').reverse().join('/') || 'atual'}.`);
      if (typeof go === 'function') go('deliveries');
    } catch (error) {
      console.error('[X-Burguer] Falha ao reservar número do pedido:', error);
      const message = String(error?.message || '');
      if (message === 'OFFLINE_CODE_RESERVATION') {
        notify('Para cadastrar uma nova entrega, conecte à internet. Isso evita números de pedido duplicados entre aparelhos.', 'error');
      } else if (message === 'AUTH_REQUIRED') {
        notify('Sua sessão expirou. Entre novamente para cadastrar a entrega.', 'error');
      } else if (message === 'CLOUD_NOT_READY') {
        notify('O banco online ainda está conectando. Aguarde alguns segundos e tente novamente.', 'error');
      } else {
        notify('Não foi possível reservar o número do pedido. Confira a conexão e tente novamente.', 'error');
      }
    } finally {
      submitting = false;
      if (submit) {
        submit.disabled = false;
        submit.innerHTML = originalHtml;
        if (typeof refreshIcons === 'function') refreshIcons();
      }
    }
  }

  // Captura antes do listener legado do app-core.js. Em produção, a numeração
  // vem exclusivamente do RPC atômico do Supabase para evitar colisões entre aparelhos.
  form.addEventListener('submit', handleSubmit, true);
})();