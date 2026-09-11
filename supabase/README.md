# Banco de dados Supabase — X-Burguer Entregas

O aplicativo está conectado a um projeto Supabase dedicado da X-Burguer. O armazenamento local permanece como apoio de recuperação e cache, enquanto os dados operacionais ficam centralizados no banco online.

## Estrutura ativa

- `public.app_settings`: configurações gerais e sequência de pedidos;
- `public.couriers`: entregadores;
- `public.deliveries`: entregas e situação do pagamento;
- `public.daily_closings`: fechamentos, resumos e snapshot das entregas;
- RLS habilitado em todas as tabelas;
- Realtime habilitado nas tabelas operacionais;
- função `xb_next_delivery_code()` para reserva atômica do número do pedido;
- restrição `unique (user_id, code)` para impedir duplicidade de número por usuário;
- índices para consultas por data, situação e entregador.

## Sincronização

Depois do login pelo Supabase Auth, o aplicativo verifica o banco, mantém a sessão, envia alterações automaticamente e recebe mudanças de outros aparelhos via Realtime.

A criação de uma nova entrega reserva primeiro o número do pedido diretamente no Supabase. Por isso, novos pedidos exigem conexão com a internet no momento do cadastro; isso elimina a possibilidade de dois aparelhos escolherem o mesmo número ao mesmo tempo.

## Acesso em produção

O primeiro acesso já foi concluído. O botão de criação de conta foi removido da tela inicial.

Em qualquer outro aparelho, use o mesmo e-mail e a mesma senha da conta já cadastrada. A área **Configurações > Acesso seguro** pode ser usada para alterar essas credenciais.

## Segurança

O GitHub Pages contém apenas a URL do projeto e uma chave **publishable**. Isso é esperado para aplicações frontend com Supabase, com RLS protegendo os dados.

Nunca colocar no repositório:

- `service_role`;
- senha do banco;
- access token administrativo do Supabase;
- segredos SMTP ou outros tokens privados.

As políticas usam `(select auth.uid())` para isolamento por usuário com melhor execução. O service worker ignora Supabase, autenticação, APIs e CDNs externas, evitando cache indevido de respostas sensíveis.
