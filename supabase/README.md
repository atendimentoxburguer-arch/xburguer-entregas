# Banco de dados — próxima etapa

O sistema continua funcionando com `localStorage`, mas agora possui uma camada de preparação para migração sem quebrar o uso atual.

## O que já está preparado

- estrutura de dados normalizada;
- status antigos `Em rota` convertidos para `Aguardando`;
- IDs e números de pedidos validados;
- pacote de migração sem senha local;
- esquema SQL para Supabase;
- RLS por usuário autenticado;
- função atômica para gerar número de pedido sem duplicar quando houver vários aparelhos;
- fechamentos com resumo e snapshot das entregas preservados em JSONB.

## Ordem segura para continuar

1. Criar ou conectar um projeto Supabase.
2. Executar `supabase/schema.sql` no banco.
3. Criar o primeiro usuário pelo Supabase Auth.
4. Usar somente a URL do projeto e uma **publishable key** no aplicativo. Nunca colocar `service_role` no navegador ou no GitHub Pages.
5. No sistema atual, abrir **Configurações > Banco de dados > Verificar dados**.
6. Gerar o **Pacote de migração** e importar os registros para o usuário autenticado.
7. Ativar a sincronização remota mantendo o armazenamento local apenas como cache/recuperação.
8. Testar criação, edição, conferência de pagamento, fechamento, histórico e relatórios em dois aparelhos antes de considerar a migração concluída.

## Autenticação

O e-mail e a senha atuais do sistema são apenas o login legado local. Eles não devem ser gravados na tabela `app_settings`. Na etapa de conexão, o login será substituído pelo Supabase Auth.

## Regra importante

A aplicação é publicada no GitHub Pages, portanto qualquer chave colocada no JavaScript é pública. Use somente chave publicável/anon com RLS ativado. Nunca use uma chave administrativa no frontend.
