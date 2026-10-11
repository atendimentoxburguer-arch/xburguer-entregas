(() => {
  if (window.XBCloudTransport) return;
  function createFetch(fetcher, timeoutMs = 30000) {
    return async (input, init = {}) => {
      const controller = new AbortController();
      const originalSignal = init.signal || input?.signal;
      const abort = () => controller.abort(originalSignal?.reason);
      if (originalSignal?.aborted) abort();
      else originalSignal?.addEventListener('abort', abort, { once: true });
      let timer;
      const timeout = new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('O banco demorou para responder. As alterações foram preservadas; a sincronização tentará novamente.'));
        }, timeoutMs);
      });
      try {
        const request = (async () => {
          const response = await fetcher(input, { ...init, signal: controller.signal });
          // A espera inclui a leitura do corpo: cabeçalhos recebidos não confirmam a resposta.
          const body = await response.arrayBuffer();
          return new Response([204, 205, 304].includes(response.status) ? null : body,
            { status: response.status, statusText: response.statusText, headers: response.headers });
        })();
        return await Promise.race([request, timeout]);
      } finally {
        clearTimeout(timer);
        originalSignal?.removeEventListener('abort', abort);
      }
    };
  }
  window.XBCloudTransport = { createFetch, fetch: typeof window.fetch === 'function' ? createFetch(window.fetch.bind(window)) : undefined };
})();
