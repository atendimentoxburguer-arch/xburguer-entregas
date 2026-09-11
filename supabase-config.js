// X-Burguer Entregas — configuração do Supabase dedicado.
// Somente URL do projeto e chave PUBLICÁVEL entram neste arquivo.
// Nunca coloque service_role, senha do banco ou outro segredo no frontend.
window.XB_SUPABASE_CONFIG = Object.freeze({
  enabled: false,
  projectUrl: '',
  publishableKey: '',
  autoMigrateLocalData: true,
  autoSync: true,
  realtime: true,
  provider: 'supabase'
});
