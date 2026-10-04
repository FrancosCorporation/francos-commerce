# MELHORIAS — francos-commerce

> **Gerado por análise de código em 2026-10-02** · Stack: Node 22 (Express + `node:sqlite`), **sem** JWT/BCrypt
> Branch `main` · base `6bb837e` (M1: vitrine + carrinho + checkout com rollback + máquina de estados, 6/6 testes) · 366 LOC · **1 suite** · CI presente
>
> **Este arquivo é um plano de execução.** Cada item tem ID, `arquivo:linha`, mudança exata,
> critério de aceite e comando de verificação.

---

## 0. Como usar este documento

1. Execute na ordem **P0 → P1 → P2 → P3**, respeitando as ondas da §8.
2. Ao terminar um item: marque `- [x]`, rode o **Verificação**, comite `fix(<ID>): descrição`.
3. **Não reescreva o checkout.** A transação com rollback (`loja.js:56-81`) e a máquina de estados
   (`loja.js:86`) estão corretas — o defeito é de **autorização e de concorrência**, não de lógica.
4. **Não "adicione" autenticação de cliente no checkout** como se fosse o problema: o problema é
   que **o painel admin não tem porta nenhuma** (`SEC-01`). O checkout público é correto.
5. **Idioma:** português; commits em inglês com `fix:`/`feat:`/`docs:`.

---

## 1. Diagnóstico executivo

E-commerce minimalista: catálogo de produtos, carrinho → checkout com transação e máquina de estados
do pedido (`criado → pago → enviado → entregue`, com `cancelado` como saída). 4 arquivos de código,
6 testes, CI.

**O que está bem (não reaça):**

| Item | Evidência |
|---|---|
| Allowlist de campos no `editarProduto`/`atualizar` (sem mass assignment nem SQL injection) | `loja.js:37-40` (`permitidos` filtra antes de montar o SET) |
| Transação com rollback no checkout | `loja.js:56,76,79-80` |
| Estoque validado **antes** de decrementar | `loja.js:65` |
| Preço calculado no **servidor**, a partir do banco | `loja.js:66` (`total += p.preco * qtd`) — o cliente não manda preço |
| Máquina de estados explícita e validada | `loja.js:86-91` |
| CHECK constraint no status | `loja.js:14-15` |
| Métrica de receita exclui cancelado | `loja.js:107` |
| Path traversal bloqueado + `NODE_ENV` para não ouvir em teste | `server.js:47,63` |

**O que está quebrado:**

1. **Nenhuma autenticação em lugar nenhum.** Não há `jwt`, `bcrypt` nem middleware no
   `package.json` (`francos-commerce/package.json:10` — só `express`). Isso significa que
   `POST/PATCH/DELETE /api/produtos`, `GET /api/pedidos` e `POST /api/pedidos/:id/:acao` são
   **públicos**: qualquer pessoa renomeia/apaga produto, lê todos os pedidos (com e-mail do cliente)
   e cancela/entrega pedido alheio.
2. **Race condition de estoque**: `estoque < qtd` (SELECT) e `estoque = estoque - ?` (UPDATE) são
   separados — duas compras simultâneas do último item **vendem duas**.
3. **Valor monetário em `REAL`** (float): `total` e `preco` são `REAL`, com risco clássico de erro
   de arredondamento em dinheiro.

---

## 2. Tabela de prioridades

| ID | Título | Sev | Arquivo | Depende de |
|---|---|---|---|---|
| SEC-01 | Painel admin sem autenticação (CRUD, pedidos, métricas) | **P0** | `server.js:31-39` | SEC-05 |
| SEC-02 | Qualquer um cancela/entrega pedido alheio | **P0** | `server.js:38` | SEC-05 |
| SEC-03 | `GET /api/pedidos` vaza e-mail de todos os clientes | **P0** | `server.js:37` | SEC-05 |
| SEC-04 | Preço/estoque editáveis sem auth (preço pode virar negativo) | **P0** | `server.js:32` · `loja.js:29` | SEC-05 |
| SEC-05 | Sem qualquer auth (falta JWT/BCrypt no projeto) | **P0** | `package.json:10` | — |
| SEC-06 | Checkout público sem rate limit | **P1** | `server.js:36` | — |
| SEC-07 | Sem validação de e-mail/telefone no checkout | **P1** | `loja.js:52-55` | — |
| BUG-01 | Race condition de estoque (oversell) | **P1** | `src/loja.js:65,74` | — |
| BUG-02 | `editarProduto` aceita `preco` negativo/NaN (valida só na criação) | **P1** | `loja.js:36-42` | — |
| BUG-03 | `editarProduto` de produto inexistente retorna `null` em 200 | **P2** | `loja.js:39-41` | — |
| BUG-04 | Dinheiro em `REAL` (float) | **P1** | `loja.js:9,14,20` | — |
| BUG-05 | `apagarProduto` não verifica item em pedido (órfão) | **P2** | `loja.js:43-48` | — |
| IMP-01 | Sem `CORS` — painel e API só na mesma origem | **P2** | `server.js:13-14` | — |
| IMP-02 | Sem `helmet`/headers de segurança | **P2** | `server.js:13-14` | — |
| IMP-03 | `checkout` aceita quantidade fracionária (`2.5`) | **P1** | `loja.js:63-64` | — |
| TEST-01 | Testes cobrem o núcleo, não as rotas nem auth | **P1** | `test/loja-test.mjs` | SEC-05 |
| TEST-02 | Sem teste de concorrência de estoque | **P2** | novo `test/` | BUG-01 |
| DEVOPS-01 | `francos-commerce.db` commitado no repo | **P1** | `francos-commerce.db` | — |
| DEVOPS-02 | Sem `.env.example` | **P3** | *(ausente)* | — |
| DOC-01 | README não diz que o painel é público | **P2** | `README.md` (63 linhas) | SEC-01 |
| DOC-02 | Falta `SECURITY.md` | **P3** | *(ausente)* | — |

**Placar: 5 P0 · 8 P1 · 6 P2 · 2 P3 = 21 itens.**

---

## 3. Segurança
### SEC-05 · Sem qualquer auth (falta JWT/BCrypt no projeto) · [P0]

- **Arquivo:** `package.json:10` · `server.js:29-39`
- **Evidência:** `dependencies` tem **apenas** `express`. Não há `jsonwebtoken`, `bcryptjs`,
  nem middleware `auth` no `server.js` — todas as rotas de escrita e leitura administrativa são
  públicas.
- **Impacto:** é a raiz de `SEC-01`..`SEC-04`. Sem porta de entrada, todo o painel administrativo
  (produtos, pedidos, métricas) está aberto a qualquer pessoa com a URL. Em e-commerce, isso é
 损失的 diretos: alteração de preço, cancelamento de pedido, e vazamento de e-mails de clientes.
- **Mudança:** (1) adicionar `jsonwebtoken` + `bcryptjs` (mesmas libs de `agendaflow-saas` e
  `kanbanex` — padrão da casa); (2) `src/auth.js` com `registrar`, `login`, `exigirToken` e
  `exigirAdmin` (adaptando os 44 linhas de `kanbanex/src/auth.js`, incluindo o `throw` no segredo);
  (3) tabela `admins (id, email, senha_hash)` semeada com `ADMIN_EMAIL`/`ADMIN_PASSWORD` do env
  (mesmo padrão de `base_fundation`); (4) aplicar `exigirAdmin` nas rotas marcadas na §2.
- **Aceite:** todas as rotas admin exigem token **e** papel `admin`; sem token → `401`.
- **Verificação:**
  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3200/api/pedidos   # 401
  curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3200/api/produtos  # 200 (vitrine publica)
  ```

### SEC-01 · Painel admin sem autenticação (CRUD, pedidos, métricas) · [P0]

- **Arquivo:** `server.js:31,32,33,37,39`
- **Evidência:** `POST /api/produtos`, `PATCH /api/produtos/:id`, `DELETE /api/produtos/:id`,
  `GET /api/pedidos` e `GET /api/metricas` — nenhuma tem middleware. Só `GET /api/produtos`
  (linha 30, vitrine) **deve** ser pública.
- **Impacto:** qualquer `curl` cria/apaga produto. `apagarProduto` (`loja.js:43`) é **hard delete**:
  apagar produto com item em pedido deixa `itens_pedido` órfão (ver `BUG-05`) e quebra o relatório.
- **Mudança:** (requer `SEC-05`) aplicar `exigirAdmin` nas 5 rotas. Manter `GET /api/produtos` e
  `POST /api/checkout` públicas por desenho.
- **Aceite:** `POST /api/produtos` sem token → `401`; com token de cliente (não admin) → `403`.
- **Verificação:**
  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3200/api/produtos \
    -H 'Content-Type: application/json' -d '{"nome":"x","preco":1,"estoque":1}'   # 401
  ```

### SEC-02 · Qualquer um cancela/entrega pedido alheio · [P0]

- **Arquivo:** `server.js:38` (`POST /api/pedidos/:id/:acao`)
- **Evidência:** rota pública que chama `loja.transicionar` (`loja.js:85`). A máquina de estados
  valida **a transição**, mas não **quem** faz.
- **Impacto:** um atacante cancela pedidos legítimos (`criado → cancelado`) ou marca como
  `entregue` sem enviar — quebra fulfillment e, se houver cobrança, gera reembolso indevido. O
  `id` tem 10 chars (`loja.js:69`), o que torna a enumeração trivial.
- **Mudança:** (requer `SEC-05`) `exigirAdmin` na rota; registrar **quem** fez a transição
  (coluna `alterado_por`/`alterado_em` em `pedidos`) — o estado atual é anônimo.
- **Aceite:** sem token admin → `401`; transição registra autor e data.
- **Verificação:**
  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3200/api/pedidos/$ID/cancelado \
    -H "Authorization: Bearer $TOKEN_ADMIN"    # 200 e com autor registrado
  ```

### SEC-03 · `GET /api/pedidos` vaza e-mail de todos os clientes · [P0]

- **Arquivo:** `server.js:37` · `loja.js:102`
- **Evidência:** `listarPedidos()` devolve `SELECT * FROM pedidos` — inclui `cliente_email`,
  `cliente_nome`, `total`, `criado_em`. Rota pública.
- **Impacto:** vazamento em massa de PII (nome + e-mail + histórico de compra) de todos os
  clientes. Em LGPD, isso é passivo regulatório, não só técnico. Sem auth, é um `curl`.
- **Mudança:** (requer `SEC-05`) `exigirAdmin` na rota; e para o cliente, criar
  `GET /api/pedidos/:id` com **token de acesso do próprio pedido** (o cliente recebe o `id` no
  checkout e valida e-mail, ou um token opaco) — nunca listagem global.
- **Aceite:** sem token → `401`; cliente comum não vê pedidos alheios.
- **Verificação:**
  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3200/api/pedidos    # 401
  curl -s http://localhost:3200/api/pedidos -H "Authorization: Bearer $T" | jq '.[0].cliente_email'  # vazio/403
  ```

### SEC-04 · Preço/estoque editáveis sem auth · [P0]

- **Arquivo:** `server.js:32` · `loja.js:36-42`
- **Evidência:** `PATCH /api/produtos/:id` público; `editarProduto` aceita `preco` e `estoque` na
  allowlist (`loja.js:37`) **sem revalidar** (o `preco <= 0` só existe em `criarProduto`, linha 29 —
  ver `BUG-02`).
- **Impacto:** combined com `BUG-02`, um atacante envia `{"preco": -100}` e a loja passa a vender com
  total negativo — prejuízo direto, ou `{"preco": 0}` para lavar pedido. E `{"estoque": 999999}`
  cria estoque fantasma que bloqueia venda real.
- **Mudança:** (requer `SEC-05`) `exigirAdmin` na rota; e **validar no `editarProduto`** os mesmos
  limites da criação (ver `BUG-02`).
- **Aceite:** `PATCH` sem token → `401`; `PATCH {"preco":-1}` → `400`.
- **Verificação:**
  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' -X PATCH http://localhost:3200/api/produtos/$ID \
    -H 'Content-Type: application/json' -d '{"preco":-1}'   # 401 (sem token) / 400 (com token)
  ```

### SEC-06 · Checkout público sem rate limit · [P1]

- **Arquivo:** `server.js:36`
- **Evidência:** rota pública (por desenho) sem limite. Cada chamada faz transação com SELECT+INSERT
  por item.
- **Impacto:** flood de pedidos falsos (enche `pedidos`, polui métricas) e, com o `BUG-01`, pode
 Provocar oversell artificial. DoS de recurso (CPU/IO por requisição).
- **Mudança:** rate limit por IP (ex.: 20/10 min) + por `clienteEmail`; limite de itens por pedido;
  confirmar e-mail do cliente antes de criar o pedido (status `pendente` → `criado`).
- **Aceite:** 21º checkout na hora → `429`.
- **Verificação:**
  ```bash
  for i in $(seq 1 22); do
    curl -s -o /dev/null -w "%{http_code} " -X POST http://localhost:3200/api/checkout \
      -H 'Content-Type: application/json' \
      -d '{"clienteEmail":"a@a.com","clienteNome":"A","itens":[{"produtoId":"x","quantidade":1}]}'
  done; echo
  ```

### SEC-07 · Sem validação de e-mail/telefone no checkout · [P1]

- **Arquivo:** `src/loja.js:52-55`
- **Evidência:** valida apenas presença: `if (!clienteEmail || !clienteNome || ...)`. Não valida
  formato de e-mail nem de itens.
- **Impacto:** pedido com `clienteEmail: "abc"` é gravado e não pode ser notificado/entregue — pedido
  perdido. E-mail inválido também quebra a futura confirmação (`SEC-06`).
- **Mudança:** validar formato de e-mail (regex mínimo) e `itens.length` máximo (ex.: 50); devolver
  `400` com mensagem.
- **Aceite:** `clienteEmail: "abc"` → `400`.
- **Verificação:**
  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3200/api/checkout \
    -H 'Content-Type: application/json' -d '{"clienteEmail":"abc","clienteNome":"A","itens":[{"produtoId":"x","quantidade":1}]}'  # 400
  ```
---

## 4. Bugs e defeitos funcionais

### BUG-01 · Race condition de estoque (oversell) · [P1]

- **Arquivo:** `src/loja.js:65` (SELECT) e `:74` (UPDATE)
- **Evidência:** dentro da transação, valida `if (p.estoque < qtd)` na linha 65 e só depois executa
  `UPDATE produtos SET estoque = estoque - ? WHERE id = ?` (linha 74) — **sem `AND estoque >= q`**.
  A transação serializa escritas, mas o SELECT já foi lido antes.
- **Impacto:** duas compras simultâneas do último item passam as duas no SELECT (ambas veem
  estoque=1) e ambas decrementam → estoque vai a **-1** e duas unidades são vendidas. Venda acima do
  estoque = prejuízo direto.
- **Mudança:** (1) UPDATE condicional: `UPDATE produtos SET estoque = estoque - ? WHERE id = ? AND estoque >= ?`
  e checar `changes === 1` (senão rollback com `estoque`); (2) alternativa mais forte (recomendada
  para produto mais movimentado): `UPDATE ... RETURNING`; (3) nunca decidir estoque fora do UPDATE.
- **Aceite:** 20 checkouts simultâneos do item com estoque=1 → exatamente 1 sucesso.
- **Verificação:**
  ```bash
  node --test test/concorrencia-estoque-test.mjs   # apos TEST-02
  ```

### BUG-04 · Dinheiro em `REAL` (float) · [P1]

- **Arquivo:** `src/loja.js:9` (`preco REAL`), `:14` (`total REAL`), `:20` (`preco_unit REAL`)
- **Evidência:** todos os valores monetários em `REAL` (SQLite = `double`). O `total` é soma de
  produtos flutuantes (`loja.js:66`).
- **Impacto:** erro clássico de ponto flutuante em dinheiro — `0.1 + 0.2 = 0.30000000000000004`.
  Em e-commerce, o total exibido diverge do cobrado, e divergência de centavos é motivo de
  contestação/reembolso. Além disso, `REAL` não garante 2 casas.
- **Mudança:** (1) guardar centavos como `INTEGER` (`preco_centavos`, `total_centavos`), nunca float;
  (2) formatar só na exibição (`(centavos/100).toFixed(2)`); (3) migração dos dados existentes
  (`ROUND(preco*100)`); (4) CHECK `>= 0` e escala.
- **Aceite:** total de 0,10 + 0,20 = 30 centavos exatos, sem `0.30000000000000004`.
- **Verificação:**
  ```bash
  node -e "console.log(0.1+0.2)"   # 0.30000000000000004 — por isso usamos centavos
  grep -n 'REAL' src/loja.js     # deve sumir apos a migracao
  ```

### BUG-02 · `editarProduto` aceita `preco` negativo/NaN · [P1]

- **Arquivo:** `src/loja.js:36-42`
- **Evidência:** `criarProduto` valida `preco <= 0` (linha 29), mas `editarProduto` **não** revalida
  — só filtra os nomes de campo (linhas 37-38) e faz `UPDATE` direto (linha 40).
- **Impacto:** (com o `SEC-04` aberto) qualquer um manda `{"preco": -100}` e cria venda com total
  negativo — prejuízo financeiro. Mesmo depois do `SEC-04`, é validação que falta na camada de
  domínio, não só na rota.
- **Mudança:** revalidar dentro de `editarProduto`, com as mesmas regras da criação (`preco > 0`
  finito, `estoque >= 0` inteiro); e adicionar `CHECK (preco > 0)` no schema.
- **Aceite:** `PATCH {"preco": -1}` → `400` mesmo com token admin.
- **Verificação:**
  ```bash
  curl -s -X PATCH http://localhost:3200/api/produtos/$ID -H "Authorization: Bearer $T" \
    -H 'Content-Type: application/json' -d '{"preco":-1}' | jq .erro.codigo   # produto/dados
  ```

### IMP-03 · `checkout` aceita quantidade fracionária · [P1]

- **Arquivo:** `src/loja.js:63-64`
- **Evidência:** `const qtd = Number(it.quantidade); if (!(qtd >= 1)) throw ...` — aceita `2.5`
  (passa em `>= 1`) e `NaN`? Não: `NaN >= 1` é falso, então NaN é barrado. Mas fracionário passa.
- **Impacto:** `quantidade: 2.5` gera estoque fracionário (`estoque = estoque - 2.5` deixa `.5`) e
  pedido impossível de entregar. Integridade de pedido.
- **Mudança:** exigir inteiro: `Number.isInteger(qtd) && qtd >= 1` e teto (ex.: 999).
- **Aceite:** `quantidade: 2.5` → `400`.
- **Verificação:**
  ```bash
  # checkout com quantidade 2.5 -> 400 dados
  ```

### BUG-03 · `editarProduto` de produto inexistente retorna `null` em 200 · [P2]

- **Arquivo:** `src/loja.js:36-41`
- **Evidência:** se `mudancas` não tiver campo permitido, retorna `this.obterProduto(id)` (linha 39)
  — que devolve `null` sem erro. E se tiver, faz `UPDATE` (que não casa nada) e devolve `null`,
  tudo com **200**.
- **Impacto:** cliente (e futuro front) recebe `200` com corpo `null` ao tentar editar produto
  inexistente — impossível distinguir "não existe" de "não mudou nada". Bug de API clássico.
- **Mudança:** se `obterProduto(id)` for `null` → `throw 404` (como `apagarProduto` faz, linha 45).
- **Aceite:** `PATCH /api/produtos/inexistente` → `404`.
- **Verificação:**
  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' -X PATCH http://localhost:3200/api/produtos/naoexiste \
    -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{"nome":"x"}'   # 404
  ```

### BUG-05 · `apagarProduto` não verifica item em pedido (órfão) · [P2]

- **Arquivo:** `src/loja.js:43-48`
- **Evidência:** `DELETE FROM produtos WHERE id = ?` sem checar `itens_pedido`.
- **Impacto:** apagar produto já vendido deixa `itens_pedido` com `produto_id` apontando para nada —
  o relatório de "qual produto mais vende" (futuro) quebra, e o pedido existente não mostra o nome
  (o nome está denormalizado em `itens_pedido.nome`, o que atenua — mas o FK lógico quebra).
- **Mudança:** (1) `DELETE` só se não houver item em pedido (ou marcar `ativo=0` — soft delete,
  melhor para e-commerce); (2) se soft delete, `GET /api/produtos` filtra `ativo=1`.
- **Aceite:** apagar produto com histórico é recusado ou apenas oculta da vitrine.
- **Verificação:**
  ```bash
  # apagar produto com pedido -> 409 ou 200 com ativo=0, nunca orfao
  ```

---

## 5. Qualidade: testes, arquitetura e observabilidade

### TEST-01 · Testes cobrem o núcleo, não as rotas nem auth · [P1]

- **Arquivo:** `test/loja-test.mjs` (77 linhas)
- **Evidência:** 6 testes cobrem CRUD, checkout e máquina de estados — **nenhum** sobe o `server` e
  chama rota. Como hoje não há auth, não há o que testar nessa frente.
- **Impacto:** os 5 P0 vivem no `server.js` (rotas sem middleware), que **não tem nenhum teste**. O
  núcleo está bem testado; a superfície HTTP não.
- **Mudança:** após `SEC-05`, testes de integração (`node --test` + `fetch` contra `server`): CRUD
  de produto sem token → 401; transicionar pedido sem token → 401; `GET /api/pedidos` sem token →
  401; vitrine pública → 200; checkout público → 201.
- **Aceite:** `npm test` inclui os 5 casos de rota e falha se um middleware for removido.
- **Verificação:**
  ```bash
  npm test 2>&1 | tail -3   # 11/11 (6 + 5)
  ```

### TEST-02 · Sem teste de concorrência de estoque · [P2]

- **Arquivo:** novo `test/concorrencia-estoque-test.mjs`
- **Evidência:** o `BUG-01` não tem cobertura; o teste atual chama `checkout` sequencialmente.
- **Impacto:** a correção do `BUG-01` (UPDATE condicional) não tem como ser provada.
- **Mudança:** criar produto com estoque=1; disparar N `checkout` **concorrentes**; assert: 1sucesso
  + (N-1) `409 estoque`, e estoque final = 0 (nunca negativo).
- **Aceite:** teste passa com o UPDATE condicional e falha sem ele (estoque negativo).
- **Verificação:**
  ```bash
  node --test test/concorrencia-estoque-test.mjs
  ```

### IMP-01 · Sem `CORS` — painel e API só na mesma origem · [P2]

- **Arquivo:** `server.js:13-14`
- **Evidência:** nenhum `cors`, nenhum middleware além de `express.json()`.
- **Impacto:** seguro **por acidente** — o painel em `public/` é servido pelo mesmo servidor, então
  não cross-origin. Se um dia o painel subir em domínio próprio (ou app mobile), quebra, e a
  "solução" costumeira é `cors({origin: true})` aberto.
- **Mudança:** se e quando houver front separado, CORS com allowlist explícita via env (nunca
  `origin: true`); documentar que hoje é same-origin por desenho.
- **Aceite:** (quando houver) origem fora da allowlist não recebe header CORS.
- **Verificação:**
  ```bash
  curl -sI -X OPTIONS http://localhost:3200/api/produtos -H 'Origin: https://evil.example' \
    -H 'Access-Control-Request-Method: GET' -D - | grep -i 'access-control-allow-origin'
  # hoje: nenhum header (same-origin por desenho)
  ```

### IMP-02 · Sem `helmet`/headers de segurança · [P2]

- **Arquivo:** `server.js:13-14`
- **Evidência:** nenhum `helmet`; painel serve HTML estático.
- **Impacto:** sem `X-Content-Type-Options`, `X-Frame-Options` (o painel poderia ser *frameado* →
  clickjacking em ação admin), `Strict-Transport-Security`. Baixo custo, fecha classe de ataque.
- **Mudança:** `helmet` como primeiro middleware (`app.use(helmet())`), alinhando com `site_corp/server`.
- **Aceite:** respostas trazem `x-content-type-options: nosniff` e `x-frame-options`.
- **Verificação:**
  ```bash
  curl -sI http://localhost:3200/ | grep -iE 'x-frame-options|x-content-type-options'
  ```

---

## 6. DevOps / Infra

### DEVOPS-01 · `francos-commerce.db` commitado no repo · [P1]

- **Arquivo:** `francos-commerce.db` (na raiz, trackeado)
- **Evidência:** `git ls-files | grep '\\.db$'` lista o arquivo; `.gitignore` (5 linhas) não o cobre.
  `server.js:11` usa `COMMERCE_DB || 'francos-commerce.db'`.
- **Impacto:** **dados de cliente versionados** (e-mail, nome, histórico de pedido) — o mesmo LGPD do
  `SEC-03`, agora também no histórico do git. Cada `pull` pode sobrescrever o banco de dev.
- **Mudança:** `git rm --cached francos-commerce.db`; `*.db` no `.gitignore`; dev usa arquivo local.
- **Aceite:** nenhum `.db` no índice; testes verdes.
- **Verificação:**
  ```bash
  git ls-files | grep -c '\\.db$'   # 0
  npm test 2>&1 | tail -2
  ```

### DEVOPS-02 · Sem `.env.example` · [P3]

- **Arquivo:** *(ausente)* `.env.example` · `server.js:10-11`
- **Evidência:** lê `PORT` e `COMMERCE_DB`; após `SEC-05`, também `JWT_SECRET` e `ADMIN_*`.
- **Impacto:** baixo hoje; evita adivinhação depois do `SEC-05`.
- **Mudança:** `.env.example` com `PORT`, `COMMERCE_DB`, `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`.
- **Aceite:** exemplo versionado cobre todas as `process.env.*`.
- **Verificação:** `diff` entre `process.env.*` do código e as chaves do exemplo.

---

## 7. Documentação

### DOC-01 · README não diz que o painel é público · [P2]

- **Arquivo:** `README.md` (63 linhas)
- **Evidência:** o README descreve vitrine + checkout + painel, mas não avisa que **o painel está sem
  autenticação**.
- **Impacto:** quem implanta acredita que o painel é restrito; em rede局 é storefront aberto com
  botão de apagar produto.
- **Mudança:** (1) aviso explícito no README **antes** do `SEC-05`; (2) depois do `SEC-05`, documentar
  como criar o admin (`ADMIN_EMAIL`/`ADMIN_PASSWORD`) e qual rota exige token.
- **Aceite:** README diz o que é público e o que exige token, com exemplo de `curl` dos dois.
- **Verificação:** `grep -ni 'publico\|token\|admin' README.md`.

### DOC-02 · Falta `SECURITY.md` · [P3]

- **Arquivo:** *(ausente)* `SECURITY.md`
- **Evidência:** tem `LICENSE` e `README`, nenhum guia de reporte nem política.
- **Impacto:** as decisões (vitrine/checkout público, painel admin, dinheiro em centavos) não ficam
  registradas; não há canal de reporte.
- **Mudança:** criar com canal + a regra "checkout e vitrine são públicos **por desenho**; painel é
  admin-only" + a invariante "dinheiro em centavos inteiros".
- **Aceite:** arquivo existe com as duas regras.
- **Verificação:** `ls SECURITY.md`

---

## 8. Ordem de execução (waves)

### Wave 1 — Fechar o painel (P0)
1. **`SEC-05`** — implementar auth (JWT + BCrypt + tabela `admins`). **Sem isso nada abaixo é possível.**
2. **`SEC-01`** — `exigirAdmin` no CRUD de produto e métricas.
3. **`SEC-02`** — `exigirAdmin` na transição + registrar autor.
4. **`SEC-03`** — `exigirAdmin` na listagem de pedidos (+ rota de pedido individual com token do cliente).
5. **`SEC-04`** — `exigirAdmin` no PATCH (+ revalidação, ver `BUG-02`).

> Depois da Wave 1, a vitrine e o checkout continuam abertos; o painel, não.

### Wave 2 — Integridade de dinheiro e estoque (P1)
6. **`BUG-02`** — revalidar `preco`/`estoque` no `editarProduto`.
7. **`IMP-03`** — `quantidade` inteira.
8. **`BUG-01`** — UPDATE condicional de estoque (+ `TEST-02` junto).
9. **`BUG-04`** — dinheiro em centavos (com migração).
10. **`SEC-07`** — validar e-mail.
11. **`SEC-06`** — rate limit no checkout.
12. **`TEST-01`** — testes de rota com auth.

### Wave 3 — Higiene (P2)
13. **`BUG-03`** — 404 em PATCH de produto inexistente.
14. **`BUG-05`** — não apagar produto com histórico (soft delete).
15. **`IMP-02`** — `helmet`.
16. **`IMP-01`** — CORS explícito quando houver front separado.
17. **`DEVOPS-01`** — tirar o `.db` do índice.

### Wave 4 — Registro (P2/P3)
18. **`DOC-01`**, **`DEVOPS-02`**, **`DOC-02`**.

**Dependências que não podem ser invertidas:**
`SEC-05` antes de `SEC-01`..`SEC-04` (sem auth, "exigir admin" não existe) ·
`BUG-01` junto com `TEST-02` · `BUG-02` antes de `SEC-04` (senão o admin seta preço negativo) ·
`BUG-04` (centavos) antes de relatórios/métricas que somem total · `DEVOPS-01` antes de criar
qualquer teste que escreva banco.

---

## 9. Fora de escopo / riscos

| Item | Decisão | Motivo |
|---|---|---|
| Exigir login do cliente no checkout | **Não** | Checkout público é o funil. O problema é o painel aberto, não o checkout. |
| Gateway de pagamento real | **Não, ainda** | O fluxo cria pedido `criado` e para — integrar pagamento é feature (ver `DOC-01`). |
| Carrinho persistido no servidor | **Não** | O carrinho vive no cliente e chega pronto no `itens` — não é defeito. |
| Trocar SQLite por Postgres | **Não** | Volume não justifica. `BUG-01` se resolve com UPDATE condicional. |
| Cupom/desconto | **Não** | Feature nova, não correção. |

**Riscos desta execução:**

- **`SEC-05` exige criar o admin.** Sem `ADMIN_EMAIL`/`ADMIN_PASSWORD` no env, o painel fica sem
  porta de entrada — semear no primeiro boot e **falhar alto** se não houver.
- **`SEC-01`..`SEC-04` podem "quebrar" o painel** se o front (`public/index.html`) não enviar token.
  Migrar servidor + front na mesma mudança.
- **`BUG-04` (centavos) exige migração de dado.** `preco REAL` → `preco_centavos INTEGER`; converter
  os valores existentes antes de trocar o schema, senão preço vira 0.
- **`BUG-01` (UPDATE condicional) pode rejeitar pedidos válidos** sob concorrência — que é o
  comportamento correto (melhor recusar que vender sem estoque).

---

## 10. Definição de pronto (DoD)

**Segurança**
- [ ] `SEC-05` — JWT + BCrypt + tabela `admins`; sem env, falha alto
- [ ] `SEC-01` — CRUD de produto e métricas exigem admin
- [ ] `SEC-02` — transição de pedido exige admin e registra autor
- [ ] `SEC-03` — listagem de pedidos exige admin; cliente só vê o próprio
- [ ] `SEC-04` — PATCH de produto exige admin e revalida
- [ ] `SEC-06` — 21º checkout na hora → `429`
- [ ] `SEC-07` — e-mail inválido → `400`

**Funcional**
- [ ] `BUG-01` — 20 checkouts concorrentes com estoque=1 → 1 sucesso, estoque 0 (nunca −1)
- [ ] `BUG-02` — `preco: -1` no PATCH → `400`
- [ ] `BUG-03` — PATCH de inexistente → `404`
- [ ] `BUG-04` — valores em centavos; 0,10+0,20 = 30 exatos
- [ ] `BUG-05` — produto com histórico não é apagado fisicamente
- [ ] `IMP-03` — `quantidade: 2.5` → `400`

**Testes e infra**
- [ ] `TEST-01` — 11/11 (6 núcleo + 5 rota)
- [ ] `TEST-02` — concorrência de estoque verde
- [ ] `IMP-02` — headers do `helmet` presentes
- [ ] `IMP-01` — CORS documentado (same-origin hoje)
- [ ] `DEVOPS-01` — nenhum `.db` no índice
- [ ] `DEVOPS-02` — `.env.example` com as 5 variáveis
- [ ] `DOC-01` — README diz o que é público
- [ ] `DOC-02` — `SECURITY.md` com as 2 invariantes

**Validação final:**
```bash
npm test 2>&1 | tail -2   # 11/11
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3200/api/pedidos   # 401
git ls-files | grep -c '\\.db$'   # 0
```

---

*Fim do plano. Gerado por leitura direta do código em 2026-10-02. Nenhum item já estava corrigido*
*— todos apontam para defeitos ainda presentes.*
