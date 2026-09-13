const fs = require('fs');
const assert = require('assert');

function unique(values) {
  return [...new Set(values)];
}

const app = fs.readFileSync('app.js', 'utf8');
const worker = fs.readFileSync('service-worker.js', 'utf8');

const appFiles = unique([...app.matchAll(/'([^']+\.js)'/g)].map(match => match[1]));
assert(appFiles.length > 10, 'Lista de módulos do app.js parece incompleta');
appFiles.forEach(file => assert(fs.existsSync(file), `Módulo carregado pelo app.js não existe: ${file}`));
assert(appFiles.includes('database-cloud-v2.js'), 'Sincronização em nuvem precisa estar no app.js');
assert(appFiles.includes('metrics-consistency-v4.js'), 'Métricas consistentes precisam estar no app.js');
assert(appFiles.includes('closing-continuity.js'), 'Proteção do fechamento precisa estar no app.js');
assert(appFiles.includes('final-integrity-guards.js'), 'Barreira final de integridade precisa estar no app.js');

const shellFiles = unique([...worker.matchAll(/'\.\/([^']+)'/g)].map(match => match[1]));
assert(shellFiles.length > 10, 'APP_SHELL do service worker parece incompleto');
shellFiles.forEach(file => assert(fs.existsSync(file), `Arquivo do APP_SHELL não existe: ${file}`));

appFiles.forEach(file => {
  assert(shellFiles.includes(file), `Módulo do app.js não está no cache offline: ${file}`);
});

const cacheVersion = worker.match(/pwa-v(\d+)/)?.[1];
assert(cacheVersion, 'Versão do cache PWA não encontrada');

console.log(`OK: ${appFiles.length} módulos e ${shellFiles.length} arquivos do app shell conferidos (PWA v${cacheVersion}).`);
