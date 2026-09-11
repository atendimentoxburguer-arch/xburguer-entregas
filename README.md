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
- Armazenamento local mantido como apoio para uso offline e recuperação

## Banco de dados

O projeto dedicado do Supabase já está conectado ao aplicativo. A aplicação usa somente a URL do projeto e a chave publicável no frontend; nenhuma chave administrativa ou senha do banco é exposta no GitHub Pages.

As tabelas usam Row Level Security (RLS), e as alterações de entregas, entregadores, configurações e fechamentos são sincronizadas automaticamente após o usuário entrar com Supabase Auth.

Na primeira autenticação, se o banco ainda estiver vazio e houver dados locais neste aparelho, o sistema faz a migração inicial automaticamente e guarda uma cópia local antes do envio.

## Primeiro acesso

Na tela de login, informe o e-mail que será usado no sistema e crie uma senha nova com pelo menos 8 caracteres. Use o botão **Criar primeiro acesso seguro** apenas uma vez.

Em projetos Supabase hospedados, a confirmação de e-mail pode ser solicitada. Depois de confirmar, volte ao aplicativo e faça login normalmente. A sessão fica salva e as próximas conexões acontecem automaticamente.

## Segurança

- a senha antiga `123456` não é aceita como nova senha;
- a senha do usuário é gerenciada pelo Supabase Auth e não é gravada nas tabelas do aplicativo;
- RLS limita os dados ao usuário autenticado;
- o frontend usa apenas a chave publicável;
- nunca adicionar `service_role`, senha do banco ou outros segredos ao repositório.
