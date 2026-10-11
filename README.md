# FrancosCommerce

Loja demonstrativa em Node.js, Express e SQLite. Ela reúne uma vitrine pública, carrinho, checkout de demonstração e uma área administrativa para produtos e pedidos.

O checkout cria o pedido e reserva o estoque, mas **não cobra o cliente**. Não há integração com Stripe ou outro gateway de pagamento.

## Requisitos

- Node.js 22.5 ou mais recente (`node:sqlite` é usado pelo domínio)
- npm
- Docker e Docker Compose, caso prefira executar em contêiner

## Executar localmente

```bash
cp .env.example .env
```

Preencha `JWT_SECRET` com um valor aleatório de pelo menos 32 bytes e configure `ADMIN_EMAIL` e `ADMIN_PASSWORD`. A senha inicial deve ter de 12 a 128 caracteres. Por exemplo, gere o segredo com:

```bash
openssl rand -hex 32
```

Instale as dependências e inicie carregando o arquivo de ambiente:

```bash
npm ci
node --env-file=.env server.js
```

A loja fica em <http://localhost:3200>. O primeiro início cria o administrador a partir das variáveis de ambiente. Depois que houver uma conta administrativa no banco, `ADMIN_EMAIL` e `ADMIN_PASSWORD` podem ser removidas do ambiente. `JWT_SECRET` continua obrigatório em todos os inícios.

## Executar com Docker Compose

```bash
cp .env.example .env
```

Defina `JWT_SECRET`, `ADMIN_EMAIL` e `ADMIN_PASSWORD` em `.env` e execute:

```bash
docker compose up --build
```

O serviço publica a porta apenas em `127.0.0.1` por padrão. O banco fica no volume persistente `dados`. Para acesso externo, use um proxy reverso com TLS e controles de acesso adequados.

## Experiência da loja

- `Área da loja` abre o login administrativo.
- A vitrine, o carrinho e o checkout são públicos.
- O painel administrativo permite criar, editar e remover produtos, consultar indicadores e atualizar o estado dos pedidos.
- Pedidos seguem `criado → pago → enviado → entregue`; pedidos `criado` ou `pago` também podem ser cancelados.
- Remover um produto o oculta do catálogo e mantém os dados necessários ao histórico dos pedidos.
- Valores monetários são armazenados em centavos inteiros. O cliente envia apenas identificadores e quantidades; o servidor consulta preços e estoque no banco.

## API

| Método e caminho | Acesso | Uso |
|---|---|---|
| `GET /api/produtos` | Público | Listar produtos ativos |
| `POST /api/checkout` | Público | Criar pedido e reservar estoque |
| `POST /api/admin/login` | Público, com limite de tentativas | Entrar na área administrativa |
| `POST /api/produtos` | Administrador | Criar produto |
| `PATCH /api/produtos/:id` | Administrador | Editar produto |
| `DELETE /api/produtos/:id` | Administrador | Ocultar produto |
| `GET /api/pedidos` | Administrador | Consultar pedidos |
| `POST /api/pedidos/:id/:acao` | Administrador | Atualizar estado do pedido |
| `GET /api/metricas` | Administrador | Consultar contagens e receita registrada |

As rotas administrativas exigem `Authorization: Bearer <token>`. O token expira após 12 horas. O checkout aceita de 1 a 50 itens, quantidades inteiras, nome e e-mail válidos; há limites de tentativas por IP e e-mail.

O painel e a API usam a mesma origem. CORS não é habilitado. A receita registrada exclui pedidos cancelados e representa os pedidos no banco, não pagamentos efetivamente processados.

## Dados locais

`COMMERCE_DB` define o caminho do SQLite; por padrão, o arquivo é `francos-commerce.db`. Arquivos de banco, segredos e `.env` ficam fora do Git. Faça cópias de segurança do banco antes de atualizações importantes. A aplicação migra os valores monetários legados para centavos durante a inicialização e interrompe o início se encontrar valores inválidos.

## Desenvolvimento

```bash
npm test
```

O comando acima executa a suíte existente do domínio. A autenticação e as rotas HTTP não têm cobertura automatizada neste momento.

## Segurança

Consulte [SECURITY.md](SECURITY.md) para os controles existentes, limites conhecidos e instruções de relato privado.

## Licença

MIT. Consulte [LICENSE](LICENSE).
