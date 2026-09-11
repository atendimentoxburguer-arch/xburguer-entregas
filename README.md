# X-Burguer Entregas

Sistema web responsivo e instalável como aplicativo para controle interno de entregas da X-Burguer.

## Funcionalidades

- Login local temporário
- Dashboard gerencial
- Cadastro e edição completa de entregas
- Conferência de pagamento
- Cadastro e gestão de entregadores
- Fechamento diário detalhado
- Histórico das entregas por fechamento
- Relatórios, ticket médio e ranking
- Exportação CSV
- Backup e restauração em JSON
- PWA instalável em celular e computador
- Persistência local com camada preparada para migração ao Supabase

## Preparação para banco de dados

A aplicação continua funcionando normalmente com `localStorage`, mas agora inclui `database-prep.js`, diagnóstico de integridade, pacote de migração e um esquema inicial seguro em `supabase/schema.sql`.

A próxima etapa é conectar um projeto Supabase, ativar Supabase Auth, executar o esquema e migrar os dados atuais. Consulte `supabase/README.md`.

## Acesso legado atual

- E-mail: `admin@xburguer.com`
- Senha: `123456`

> Esse acesso é temporário e será substituído pelo Supabase Auth. A senha local não deve ser migrada para o banco de dados.
