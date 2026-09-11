# X-Burguer Entregas

Sistema web responsivo e instalável como aplicativo para controle interno de entregas da X-Burguer.

## Funcionalidades

- Login seguro com Supabase Auth
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
- Banco online Supabase com sincronização automática e atualização entre aparelhos
- Armazenamento local mantido como apoio para recuperação e uso das telas já carregadas
- Numeração de pedidos reservada de forma atômica no Supabase para evitar duplicidade entre aparelhos

## Banco de dados

O projeto dedicado do Supabase está conectado ao aplicativo. A aplicação usa somente a URL do projeto e a chave publicável no frontend; nenhuma chave administrativa ou senha do banco é exposta no GitHub Pages.

As tabelas usam Row Level Security (RLS), e as alterações de entregas, entregadores, configurações e fechamentos são sincronizadas automaticamente após o usuário entrar com Supabase Auth.

A criação de uma nova entrega reserva primeiro o número do pedido no banco por meio da função `xb_next_delivery_code()`. Isso evita que dois aparelhos recebam o mesmo número ao cadastrar pedidos ao mesmo tempo. Para manter essa garantia, novos pedidos precisam de conexão com a internet no momento do cadastro.

## Acesso em produção

O cadastro inicial já foi concluído e o botão de criação de primeiro acesso foi removido da tela de login. Em novos aparelhos, basta entrar com o mesmo e-mail e senha já cadastrados no Supabase Auth.

A área **Configurações > Acesso seguro** continua disponível para alterar o e-mail ou a senha da conta existente.

## Segurança

- a senha do usuário é gerenciada pelo Supabase Auth e não é gravada nas tabelas do aplicativo;
- RLS limita os dados ao usuário autenticado;
- o frontend usa apenas a chave publicável;
- a numeração dos pedidos possui restrição única no banco e reserva atômica;
- respostas do Supabase, autenticação, APIs e CDNs externas não são armazenadas pelo service worker;
- nunca adicionar `service_role`, senha do banco ou outros segredos ao repositório.
