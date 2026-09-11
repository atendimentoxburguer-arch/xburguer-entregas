# Banco de dados Supabase — X-Burguer Entregas

O aplicativo já está conectado a um projeto Supabase dedicado da X-Burguer e mantém o armazenamento local apenas como apoio para funcionamento offline e recuperação.

## Estrutura ativa

- `public.app_settings`: configurações gerais e sequência de pedidos;
- `public.couriers`: entregadores;
- `public.deliveries`: entregas e situação do pagamento;
- `public.daily_closings`: fechamentos, resumos e snapshot das entregas;
- RLS habilitado em todas as tabelas;
- Realtime habilitado nas tabelas operacionais;
- função `xb_next_delivery_code()` para geração atômica do número do pedido;
- índices para consultas por data, situação e entregador.

## Sincronização

Depois do login pelo Supabase Auth, o aplicativo:

1. verifica automaticamente os dados no banco;
2. se o banco estiver vazio e houver dados locais, guarda uma cópia de segurança e envia os dados para o Supabase;
3. salva novas alterações automaticamente;
4. recebe alterações de outros aparelhos via Realtime;
5. continua guardando dados locais quando estiver offline e tenta sincronizar quando a internet voltar.

## Primeiro acesso

O login legado local não deve mais ser usado quando a conexão Supabase estiver ativa. Na tela inicial do aplicativo existe o botão **Criar primeiro acesso seguro**. O usuário informa o e-mail e uma senha nova com pelo menos 8 caracteres.

A confirmação de e-mail pode ser exigida pelo Supabase. Depois da confirmação, basta voltar ao aplicativo e entrar normalmente.

## Segurança

O GitHub Pages contém apenas a URL do projeto e uma chave **publishable**. Isso é esperado para aplicações frontend com Supabase, desde que o RLS permaneça ativado.

Nunca colocar no repositório:

- `service_role`;
- senha do banco;
- access token administrativo do Supabase;
- segredos SMTP ou outros tokens privados.

As políticas do banco usam `auth.uid()` por meio de subquery para manter o isolamento por usuário e evitar reavaliação desnecessária por linha.
