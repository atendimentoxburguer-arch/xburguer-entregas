const fs = require('fs');
const assert = require('assert');

function unique(values) {
  return [...new Set(values)];
}

const app = fs.readFileSync('app.js', 'utf8');
const worker = fs.readFileSync('service-worker.js', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');
const pwa = fs.readFileSync('pwa-app.js', 'utf8');
const core = fs.readFileSync('app-core.js', 'utf8');
const production = fs.readFileSync('system-production-v2.js', 'utf8');
const deliveryCreation = fs.readFileSync('atomic-delivery-code.js', 'utf8');
const cloud = fs.readFileSync('database-cloud-v2.js', 'utf8');
const databasePrep = fs.readFileSync('database-prep.js', 'utf8');
const manifest = JSON.parse(fs.readFileSync('manifest.webmanifest', 'utf8'));

const appFilesRaw = [...app.matchAll(/'([^']+\.js)'/g)].map(match => match[1]);
const appFiles = unique(appFilesRaw);
assert(appFiles.length > 10, 'Lista de módulos do app.js parece incompleta');
appFiles.forEach(file => assert(fs.existsSync(file), `Módulo carregado pelo app.js não existe: ${file}`));
assert(appFiles.includes('database-cloud-v2.js'), 'Sincronização em nuvem precisa estar no app.js');
assert(appFiles.includes('metrics-consistency-v4.js'), 'Métricas consistentes precisam estar no app.js');
assert(appFiles.includes('closing-continuity.js'), 'Proteção do fechamento precisa estar no app.js');
assert(appFiles.includes('final-integrity-guards.js'), 'Barreira final de integridade precisa estar no app.js');
assert(appFiles.includes('past-day-guard.js'), 'Pendências de dias anteriores precisam ser sinalizadas');

const metricsPosition = app.indexOf("'metrics-consistency-v4.js'");
const businessRulesPosition = app.indexOf("'business-rules-v2.js'");
assert(metricsPosition >= 0 && businessRulesPosition >= 0 && metricsPosition < businessRulesPosition,
  'Métricas canônicas precisam carregar antes das regras derivadas');

const shellBlock = worker.match(/const APP_SHELL = \[([\s\S]*?)\];/)?.[1] || '';
const shellFilesRaw = [...shellBlock.matchAll(/'\.\/([^']+)'/g)].map(match => match[1]);
const shellFiles = unique(shellFilesRaw);
assert(shellFiles.length > 10, 'APP_SHELL do service worker parece incompleto');
assert.strictEqual(shellFiles.length, shellFilesRaw.length, 'APP_SHELL contém arquivos duplicados');
shellFiles.forEach(file => assert(fs.existsSync(file), `Arquivo do APP_SHELL não existe: ${file}`));

appFiles.forEach(file => {
  assert(shellFiles.includes(file), `Módulo do app.js não está no cache offline: ${file}`);
});

const cacheVersion = worker.match(/pwa-v(\d+)/)?.[1];
assert(cacheVersion, 'Versão do cache PWA não encontrada');

const appVersion = app.match(/const version = '([^']+)'/)?.[1];
const pwaVersion = pwa.match(/const APP_VERSION = '([^']+)'/)?.[1];
const indexAppVersion = index.match(/app\.js\?v=([^"'<>]+)/)?.[1];
const indexStyleVersion = index.match(/styles\.css\?v=([^"'<>]+)/)?.[1];
assert(appVersion, 'Versão do carregador não encontrada');
assert.strictEqual(indexAppVersion, appVersion, 'index.html aponta para versão diferente do app.js');
assert.strictEqual(indexStyleVersion, appVersion, 'index.html aponta para versão diferente dos estilos');
assert.strictEqual(pwaVersion, appVersion, 'PWA usa versão diferente do carregador principal');
const manifestIconVersions = (manifest.icons || []).map(icon => String(icon.src || '').match(/\?v=([^&]+)/)?.[1]).filter(Boolean);
assert(manifestIconVersions.length > 0, 'Manifest deve versionar os ícones');
manifestIconVersions.forEach(version => assert.strictEqual(version, appVersion, 'Manifest usa versão diferente do carregador principal'));

assert(production.includes("rpc('xb_restore_backup'"), 'Restauração precisa usar RPC atômico do banco');
assert(production.includes("rpc('xb_clear_operational_data'"), 'Limpeza precisa usar RPC autoritativo do banco');
assert(cloud.includes("rpc('xb_delete_delivery'"), 'Exclusão de entrega precisa ser autoritativa no banco');
assert(cloud.includes("delivery_tombstones"), 'Sincronização precisa reconhecer tombstones de entregas excluídas');
assert(cloud.includes('deleteDelivery: id => deleteDeliveryAuthoritatively(id)'), 'XBCloud precisa expor exclusão autoritativa');
const closing = fs.readFileSync('closing-continuity.js', 'utf8');
assert(index.includes('id="closingDaySelect"'), 'Fechamento precisa permitir escolher explicitamente o dia');
assert(closing.includes('function selectableClosingDays()'), 'Fechamento precisa manter os dias abertos selecionáveis');
assert(!closing.includes('return open[0] || dateKey(new Date());'), 'Fechamento não pode escolher silenciosamente o dia aberto mais antigo');

assert(!production.includes("Dados apagados neste aparelho. A exclusão será sincronizada"), 'Limpeza offline não pode prometer sincronização posterior');
assert(production.includes('pendingChanges'), 'Operações destrutivas precisam verificar a fila de sincronização');
assert(deliveryCreation.includes('waitForDeliveryInCloud'), 'Nova entrega precisa de confirmação de persistência no banco');
assert(deliveryCreation.includes(".from('deliveries')"), 'Nova entrega precisa ser conferida diretamente no banco');
assert(cloud.includes('localMutationNeedsReconciliation'), 'Pull remoto precisa proteger uma gravação local recente');
assert(cloud.includes('protecao-pos-gravacao'), 'Reconciliação de gravação local precisa ocorrer antes do pull');
assert(cloud.includes('fetchAllRemoteRows'), 'Leitura da nuvem precisa suportar mais de 1.000 registros');
assert(cloud.includes('.range(from, from + PAGE_SIZE - 1)'), 'Leitura paginada precisa usar range por páginas');
assert(cloud.includes("fetchAllRemoteRows('deliveries'"), 'Entregas precisam ser carregadas por paginação');

assert(databasePrep.includes('applyingRemote'), 'Persistência local deve distinguir sincronização remota de alteração local');
const metrics = fs.readFileSync('metrics-consistency-v4.js', 'utf8');
const closingContinuity = fs.readFileSync('closing-continuity.js', 'utf8');
const pastDayGuard = fs.readFileSync('past-day-guard.js', 'utf8');
assert(metrics.includes('openOperationalDayKeys'), 'Métricas precisam conhecer dias ainda abertos');
assert(metrics.includes("range === 'today'"), 'Filtro padrão precisa tratar a continuidade do dia');
assert(closingContinuity.includes('function activeDay()'), 'Fechamento precisa selecionar o dia operacional ainda aberto');
assert(!closingContinuity.includes('recoverPastCompleteDays'), 'O sistema não pode finalizar dias automaticamente');
assert(closingContinuity.includes("rpc('xb_finalize_day_explicit'"), 'Finalização deve exigir ação explícita no novo RPC');
assert(!closingContinuity.includes("rpc('xb_finalize_day',"), 'O fluxo da interface não pode chamar o RPC legado de finalização');
assert(pastDayGuard.includes('pastOpenRows'), 'O alerta precisa reconhecer dias anteriores ainda abertos');
const legacyUpdate = fs.readFileSync('system-update.js', 'utf8');
const legacyHardening = fs.readFileSync('production-hardening.js', 'utf8');
assert(legacyUpdate.includes('if (window.XB_SUPABASE_CONFIG?.enabled) return;'), 'Restauração local deve ser bloqueada quando Supabase está ativo');
assert(!legacyHardening.includes("closest?.('#restoreRecoveryBtn')"), 'production-hardening não pode interceptar a restauração autoritativa');

assert(!core.includes("password: '123456'"), 'Credencial local de demonstração não pode existir no núcleo');
assert(!core.includes("email: 'admin@xburguer.com'"), 'E-mail local de demonstração não pode existir no núcleo');

console.log(`OK: ${appFiles.length} módulos, ${shellFiles.length} arquivos do app shell, versões sincronizadas e PWA v${cacheVersion}.`);
