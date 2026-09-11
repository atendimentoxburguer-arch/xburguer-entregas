(() => {
  if (window.__xbCurrencyInputsInstalled) return;
  window.__xbCurrencyInputsInstalled = true;

  const SELECTOR = '.money-input input';

  function parseCurrency(value) {
    let text = String(value ?? '').trim().replace(/\s+/g, '').replace(/^R\$/i, '');
    if (!text) return null;
    text = text.replace(/[^0-9.,]/g, '');
    if (!text) return null;

    const comma = text.lastIndexOf(',');
    const dot = text.lastIndexOf('.');

    if (comma >= 0 && dot >= 0) {
      if (comma > dot) text = text.replace(/\./g, '').replace(',', '.');
      else text = text.replace(/,/g, '');
    } else if (comma >= 0) {
      text = text.replace(/\./g, '').replace(',', '.');
    } else if ((text.match(/\./g) || []).length > 1) {
      const parts = text.split('.');
      const decimal = parts.pop();
      text = `${parts.join('')}.${decimal}`;
    }

    const number = Number(text);
    return Number.isFinite(number) ? Math.max(0, number) : null;
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function formatInput(input) {
    if (!input || document.activeElement === input) return;
    const raw = String(input.value ?? '').trim();
    if (!raw) return;
    const value = parseCurrency(raw);
    if (value === null) return;
    input.value = formatNumber(value);
  }

  function normalizeInput(input) {
    if (!input) return;
    const raw = String(input.value ?? '').trim();
    if (!raw) return;
    const value = parseCurrency(raw);
    input.value = value === null ? '' : value.toFixed(2);
  }

  function prepareInput(input) {
    if (!input || input.dataset.xbCurrency === '1') return;
    input.dataset.xbCurrency = '1';
    input.type = 'text';
    input.inputMode = 'decimal';
    input.autocomplete = 'off';

    input.addEventListener('focus', () => {
      const value = parseCurrency(input.value);
      if (value === null) return;
      input.value = value.toFixed(2).replace('.', ',');
      requestAnimationFrame(() => input.select());
    });

    input.addEventListener('input', () => {
      let value = input.value.replace(/[^0-9.,]/g, '');
      const separators = [...value].reduce((list, char, index) => {
        if (char === ',' || char === '.') list.push(index);
        return list;
      }, []);
      if (separators.length > 1) {
        const last = separators[separators.length - 1];
        value = [...value].filter((char, index) => (char !== ',' && char !== '.') || index === last).join('');
      }
      if (input.value !== value) input.value = value;
    });

    input.addEventListener('blur', () => formatInput(input));
    formatInput(input);
  }

  function prepareAll(root = document) {
    root.querySelectorAll?.(SELECTOR).forEach(prepareInput);
  }

  function formatAll(root = document) {
    prepareAll(root);
    root.querySelectorAll?.(SELECTOR).forEach(formatInput);
  }

  // Antes de qualquer handler de formulário, converte "32,00" para "32.00".
  // Assim o código existente continua usando Number(...) sem perder centavos.
  document.addEventListener('submit', event => {
    event.target?.querySelectorAll?.(SELECTOR).forEach(normalizeInput);
  }, true);

  // Valores definidos por outros campos (ex.: taxa do entregador) recebem a
  // apresentação brasileira assim que a alteração termina.
  document.addEventListener('change', event => {
    if (event.target?.matches?.(SELECTOR)) return;
    requestAnimationFrame(() => formatAll());
  });

  // Algumas telas preenchem valores programaticamente ao abrir modais.
  ['openDeliveryEditor', 'openCourier', 'renderSettings', 'renderAll'].forEach(name => {
    const original = window[name];
    if (typeof original !== 'function') return;
    window[name] = function xbCurrencyAwareFunction(...args) {
      const result = original.apply(this, args);
      requestAnimationFrame(() => formatAll());
      return result;
    };
  });

  prepareAll();
  requestAnimationFrame(() => formatAll());

  window.XBCurrency = Object.freeze({
    parse: parseCurrency,
    format: formatNumber,
    refresh: () => formatAll(),
    normalize: normalizeInput
  });
})();
