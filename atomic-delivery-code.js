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

  async function reserveDeliveryCode() {
    if (!navigator.onLine) throw new Error('OFFLINE_CODE_RESERVATION');

    const cloud = await waitForCloud();
    if (!cloud?.client) throw new Error('CLOUD_NOT_READY');

    const { data: sessionData, error: sessionError } = await cloud.client.auth.getSession();
    if (sessionError) throw sessionError;
    if (!sessionData?.session?.user) throw new Error('AUTH_REQUIRED');

    const { data, error } = await cloud.client.rpc('xb_next_delivery_code');
    if (error) throw error;

    const code = Number(data);
    if (!Number.isInteger(code) || code <= 0) throw new Error('INVALID_RESERVED_CODE');
    return code;
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
      const code = await reserveDeliveryCode();
      const now = new Date().toISOString();
      const item = {
        id: uid('delivery'),
        code,
        client: document.getElementById('deliveryClient').value.trim(),
        phone: document.getElementById('deliveryPhone').value.trim(),
        address: document.getElementById('deliveryAddress').value.trim(),
        reference: '',
        courierId: document.getElementById('deliveryCourier').value || null,
        fee: Number(document.getElementById('deliveryFee').value || 0),
        orderValue: Number(document.getElementById('deliveryValue').value || 0),
        payment: document.querySelector('input[name="payment"]:checked')?.value || 'Dinheiro',
        changeFor: document.getElementById('deliveryChange').value
          ? Number(document.getElementById('deliveryChange').value)
          : '',
        notes: document.getElementById('deliveryNotes').value.trim(),
        status: 'Aguardando',
        createdAt: now,
        updatedAt: now,
        paymentConfirmedAt: ''
      };

      db.deliveries.push(item);
      db.settings.nextDeliveryCode = Math.max(Number(db.settings.nextDeliveryCode || 1), code + 1);
      save();

      window.XBProduction?.clearDraft?.();
      window.dispatchEvent(new CustomEvent('xb:delivery-created', {
        detail: { id: item.id, code: item.code, createdAt: item.createdAt }
      }));

      resetDeliveryForm(event.target);
      notify(`Entrega #${String(code).padStart(3, '0')} cadastrada.`);
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
