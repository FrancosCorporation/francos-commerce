# Segurança

## Reportar uma vulnerabilidade

Envie relatos pelo recurso privado **Report a vulnerability** na aba **Security** deste repositório no GitHub. Não publique detalhes exploráveis em issues públicas. Inclua passos para reproduzir, impacto e uma forma segura de contato para coordenar a correção.

## Controles implementados

- As rotas de gestão exigem um JWT assinado com HS256 e papel `admin`; o token expira em 12 horas.
- A senha do administrador é armazenada com BCrypt. Não há cadastro público de administradores.
- `JWT_SECRET` é obrigatório e precisa ter pelo menos 32 bytes. Uma instalação nova também precisa de `ADMIN_EMAIL` e `ADMIN_PASSWORD` válidos para semear o primeiro administrador.
- A área administrativa e a API são servidas pela mesma origem. CORS não está habilitado.
- Helmet define os cabeçalhos de segurança e uma política de conteúdo compatível com os arquivos externos da interface.
- Login e checkout têm limites em memória por IP e, quando informado, por e-mail. Esses limites são locais ao processo e reiniciam com o serviço.
- O checkout recalcula os valores no servidor, usa centavos inteiros e atualiza o estoque de forma condicional dentro de uma transação SQLite.
- A interface cria elementos com APIs do DOM e escreve conteúdo dinâmico usando `textContent`.

## Operação

- Gere um `JWT_SECRET` exclusivo por ambiente. Não reutilize o valor de exemplo nem o inclua em commits, imagens ou logs.
- Use HTTPS em produção por meio de um proxy reverso e restrinja o acesso à área administrativa.
- Proteja e faça backup do volume SQLite. Ele contém dados de pedidos e informações pessoais dos clientes.
- A aplicação não integra pagamentos. O estado `pago` é uma ação administrativa de demonstração e não comprova uma transação financeira.
- Os limites de requisição não são compartilhados entre processos. Uma implantação com várias réplicas precisa de um limitador distribuído antes de depender deles contra abuso coordenado.
- Se a aplicação ficar atrás de proxy, mantenha `trust proxy` configurado apenas para os proxies conhecidos antes de depender do endereço IP para rate limiting.

## Escopo conhecido

O checkout não autentica clientes nem oferece consulta individual de pedidos. A listagem administrativa de pedidos contém nome, e-mail e histórico de compra e deve permanecer protegida. Os pedidos de demonstração não devem ser tratados como registros de pagamento ou fulfillment de produção.
