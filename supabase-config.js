// X-Burguer Entregas — configuração do Supabase dedicado.
// Somente URL do projeto e chave PUBLICÁVEL entram neste arquivo.
// Nunca coloque service_role, senha do banco ou outro segredo no frontend.
window.XB_SUPABASE_CONFIG = Object.freeze({
  enabled: true,
  projectUrl: 'https://ayouavnqatbgqrxqweyj.supabase.co',
  publishableKey: 'sb_publishable_Z97XrUmKDX4APac2O8BAuA_Jf1Hx2Vh',
  autoMigrateLocalData: true,
  autoSync: true,
  realtime: true,
  provider: 'supabase'
});
