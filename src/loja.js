// FrancosCommerce — catálogo, checkout transacional e estados de pedido.
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

function falha(codigo, mensagem) {
  return Object.assign(new Error(mensagem), { codigo });
}

function centavosDe(valor) {
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0) return null;
  const calculado = valor * 100;
  const centavos = Math.round(calculado);
  if (!Number.isSafeInteger(centavos) || centavos <= 0 || Math.abs(calculado - centavos) > 1e-7) return null;
  return centavos;
}

function colunas(db, tabela) {
  return new Set(db.prepare(`PRAGMA table_info(${tabela})`).all().map((c) => c.name));
}

export function criarLoja(caminhoDb = 'francos-commerce.db') {
  const db = new DatabaseSync(caminhoDb);
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS produtos (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL,
      preco_centavos INTEGER NOT NULL CHECK (preco_centavos > 0),
      estoque INTEGER NOT NULL DEFAULT 0 CHECK (estoque >= 0),
      descricao TEXT NOT NULL DEFAULT '',
      ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1))
    );
    CREATE TABLE IF NOT EXISTS pedidos (
      id TEXT PRIMARY KEY,
      cliente_email TEXT NOT NULL,
      cliente_nome TEXT NOT NULL,
      total_centavos INTEGER NOT NULL CHECK (total_centavos >= 0),
      status TEXT NOT NULL DEFAULT 'criado'
        CHECK (status IN ('criado','pago','enviado','entregue','cancelado')),
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      alterado_por TEXT,
      alterado_em TEXT
    );
    CREATE TABLE IF NOT EXISTS itens_pedido (
      id TEXT PRIMARY KEY,
      pedido_id TEXT NOT NULL,
      produto_id TEXT NOT NULL,
      nome TEXT NOT NULL,
      preco_unit_centavos INTEGER NOT NULL CHECK (preco_unit_centavos >= 0),
      quantidade INTEGER NOT NULL CHECK (quantidade >= 1)
    );
  `);

  // Migra os campos REAL do banco legado para centavos, preserva os dados e
  // remove as colunas antigas quando a cópia para centavos foi concluída.
  db.exec('BEGIN IMMEDIATE');
  try {
    let cp = colunas(db, 'produtos');
    if (!cp.has('preco_centavos')) db.exec('ALTER TABLE produtos ADD COLUMN preco_centavos INTEGER');
    if (cp.has('preco')) {
      db.exec('UPDATE produtos SET preco_centavos = COALESCE(preco_centavos, CAST(ROUND(preco * 100) AS INTEGER))');
      db.exec('ALTER TABLE produtos DROP COLUMN preco');
    }
    cp = colunas(db, 'produtos');
    if (!cp.has('ativo')) db.exec('ALTER TABLE produtos ADD COLUMN ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1))');

    let cped = colunas(db, 'pedidos');
    if (!cped.has('total_centavos')) db.exec('ALTER TABLE pedidos ADD COLUMN total_centavos INTEGER');
    if (cped.has('total')) {
      db.exec('UPDATE pedidos SET total_centavos = COALESCE(total_centavos, CAST(ROUND(total * 100) AS INTEGER))');
      db.exec('ALTER TABLE pedidos DROP COLUMN total');
    }
    cped = colunas(db, 'pedidos');
    if (!cped.has('alterado_por')) db.exec('ALTER TABLE pedidos ADD COLUMN alterado_por TEXT');
    if (!cped.has('alterado_em')) db.exec('ALTER TABLE pedidos ADD COLUMN alterado_em TEXT');

    const ci = colunas(db, 'itens_pedido');
    if (!ci.has('preco_unit_centavos')) db.exec('ALTER TABLE itens_pedido ADD COLUMN preco_unit_centavos INTEGER');
    if (ci.has('preco_unit')) {
      db.exec('UPDATE itens_pedido SET preco_unit_centavos = COALESCE(preco_unit_centavos, CAST(ROUND(preco_unit * 100) AS INTEGER))');
      db.exec('ALTER TABLE itens_pedido DROP COLUMN preco_unit');
    }

    const produtoInvalido = db.prepare('SELECT COUNT(*) AS n FROM produtos WHERE preco_centavos IS NULL OR preco_centavos <= 0').get().n;
    const pedidoInvalido = db.prepare('SELECT COUNT(*) AS n FROM pedidos WHERE total_centavos IS NULL OR total_centavos < 0').get().n;
    const itemInvalido = db.prepare('SELECT COUNT(*) AS n FROM itens_pedido WHERE preco_unit_centavos IS NULL OR preco_unit_centavos < 0').get().n;
    if (produtoInvalido || pedidoInvalido || itemInvalido) {
      throw new Error('Migração monetária encontrou valores inválidos. Revise o banco antes de iniciar a loja.');
    }
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* preserva o erro da migração */ }
    throw e;
  }

  const produtoPublico = (p) => p ? ({
    ...p,
    preco_centavos: Number(p.preco_centavos),
    preco: Number(p.preco_centavos) / 100
  }) : null;
  const itemPublico = (item) => ({
    ...item,
    preco_unit_centavos: Number(item.preco_unit_centavos),
    preco_unit: Number(item.preco_unit_centavos) / 100
  });

  function obterPedidoInterno(id) {
    const pedido = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(id);
    if (!pedido) return null;
    pedido.total_centavos = Number(pedido.total_centavos);
    pedido.total = pedido.total_centavos / 100;
    pedido.itens = db.prepare('SELECT * FROM itens_pedido WHERE pedido_id = ? ORDER BY rowid').all(id).map(itemPublico);
    return pedido;
  }

  return {
    db,

    // ---- produtos (CRUD) ----
    criarProduto({ nome, preco, estoque = 0, descricao = '' } = {}) {
      const precoCentavos = centavosDe(preco);
      if (typeof nome !== 'string' || !nome.trim() || nome.trim().length > 120 || precoCentavos === null ||
          !Number.isSafeInteger(estoque) || estoque < 0 || estoque > 1_000_000_000 ||
          typeof descricao !== 'string' || descricao.length > 2000) {
        throw falha('produto', 'nome, preço positivo com até 2 casas, estoque inteiro >= 0 e descrição válida obrigatórios');
      }
      const id = randomUUID();
      db.prepare('INSERT INTO produtos (id, nome, preco_centavos, estoque, descricao) VALUES (?, ?, ?, ?, ?)')
        .run(id, nome.trim(), precoCentavos, estoque, descricao.trim());
      return this.obterProduto(id);
    },

    obterProduto(id) {
      return produtoPublico(db.prepare('SELECT * FROM produtos WHERE id = ? AND ativo = 1').get(id) || null);
    },

    listarProdutos() {
      return db.prepare('SELECT * FROM produtos WHERE ativo = 1 ORDER BY nome').all().map(produtoPublico);
    },

    editarProduto(id, mudancas = {}) {
      if (!mudancas || typeof mudancas !== 'object' || Array.isArray(mudancas)) throw falha('dados', 'alterações inválidas');
      const produto = this.obterProduto(id);
      if (!produto) throw falha('404', 'produto não encontrado');
      const atualizacoes = [];
      const valores = [];
      const incluir = (campo, valor) => { atualizacoes.push(`${campo} = ?`); valores.push(valor); };

      if (Object.hasOwn(mudancas, 'nome')) {
        if (typeof mudancas.nome !== 'string' || !mudancas.nome.trim() || mudancas.nome.trim().length > 120) throw falha('produto', 'nome inválido');
        incluir('nome', mudancas.nome.trim());
      }
      if (Object.hasOwn(mudancas, 'preco')) {
        const novoPreco = centavosDe(mudancas.preco);
        if (novoPreco === null) throw falha('produto', 'preço deve ser positivo, finito e ter até 2 casas decimais');
        incluir('preco_centavos', novoPreco);
      }
      if (Object.hasOwn(mudancas, 'estoque')) {
        if (!Number.isSafeInteger(mudancas.estoque) || mudancas.estoque < 0 || mudancas.estoque > 1_000_000_000) throw falha('produto', 'estoque deve ser um inteiro >= 0');
        incluir('estoque', mudancas.estoque);
      }
      if (Object.hasOwn(mudancas, 'descricao')) {
        if (typeof mudancas.descricao !== 'string' || mudancas.descricao.length > 2000) throw falha('produto', 'descrição inválida');
        incluir('descricao', mudancas.descricao.trim());
      }
      if (atualizacoes.length) {
        db.prepare(`UPDATE produtos SET ${atualizacoes.join(', ')} WHERE id = ? AND ativo = 1`).run(...valores, id);
      }
      return this.obterProduto(id);
    },

    apagarProduto(id) {
      const produto = this.obterProduto(id);
      if (!produto) throw falha('404', 'produto não encontrado');
      db.prepare('UPDATE produtos SET ativo = 0 WHERE id = ? AND ativo = 1').run(id);
      return { apagado: true, id, ocultado: true };
    },

    // ---- carrinho -> checkout público ----
    checkout({ clienteEmail, clienteNome, itens } = {}) {
      const email = typeof clienteEmail === 'string' ? clienteEmail.trim().toLowerCase() : '';
      const nome = typeof clienteNome === 'string' ? clienteNome.trim() : '';
      if (!/^[^\s@]+@[^\s@]+$/.test(email) || email.length > 254 || !nome || nome.length > 120 ||
          !Array.isArray(itens) || itens.length === 0 || itens.length > 50) {
        throw falha('dados', 'nome, e-mail válido e de 1 a 50 itens obrigatórios');
      }

      const quantidades = new Map();
      for (const item of itens) {
        const quantidade = Number(item?.quantidade);
        if (typeof item?.produtoId !== 'string' || !item.produtoId || item.produtoId.length > 64 ||
            !Number.isSafeInteger(quantidade) || quantidade < 1 || quantidade > 999) {
          throw falha('dados', 'cada item precisa de produto e quantidade inteira entre 1 e 999');
        }
        const totalProduto = (quantidades.get(item.produtoId) || 0) + quantidade;
        if (!Number.isSafeInteger(totalProduto) || totalProduto > 999) throw falha('dados', 'quantidade total por produto excede 999');
        quantidades.set(item.produtoId, totalProduto);
      }

      let transacaoAberta = false;
      try {
        db.exec('BEGIN IMMEDIATE');
        transacaoAberta = true;
        let totalCentavos = 0;
        const preparados = [];
        for (const [produtoId, quantidade] of quantidades) {
          const produto = this.obterProduto(produtoId);
          if (!produto) throw falha('404', 'produto não encontrado ou indisponível');
          if (produto.estoque < quantidade) throw falha('estoque', `estoque insuficiente: ${produto.nome} (${produto.estoque} disponíveis)`);
          const subtotal = produto.preco_centavos * quantidade;
          if (!Number.isSafeInteger(subtotal) || !Number.isSafeInteger(totalCentavos + subtotal)) throw falha('dados', 'total do pedido excede o limite');
          totalCentavos += subtotal;
          preparados.push({ produto, quantidade });
        }

        const id = randomUUID();
        db.prepare('INSERT INTO pedidos (id, cliente_email, cliente_nome, total_centavos, status) VALUES (?, ?, ?, ?, ?)')
          .run(id, email, nome, totalCentavos, 'criado');
        for (const { produto, quantidade } of preparados) {
          const atualizacao = db.prepare('UPDATE produtos SET estoque = estoque - ? WHERE id = ? AND ativo = 1 AND estoque >= ?')
            .run(quantidade, produto.id, quantidade);
          if (atualizacao.changes !== 1) throw falha('estoque', `estoque insuficiente: ${produto.nome}`);
          db.prepare('INSERT INTO itens_pedido (id, pedido_id, produto_id, nome, preco_unit_centavos, quantidade) VALUES (?, ?, ?, ?, ?, ?)')
            .run(randomUUID(), id, produto.id, produto.nome, produto.preco_centavos, quantidade);
        }
        db.exec('COMMIT');
        transacaoAberta = false;
        return obterPedidoInterno(id);
      } catch (e) {
        if (transacaoAberta) {
          try { db.exec('ROLLBACK'); } catch { /* mantém a falha do checkout */ }
        }
        throw e;
      }
    },

    // Máquina de estados com atualização condicional e autor administrativo.
    transicionar(id, novoStatus, adminId = 'system') {
      const fluxo = { criado: ['pago', 'cancelado'], pago: ['enviado', 'cancelado'], enviado: ['entregue'], entregue: [], cancelado: [] };
      db.exec('BEGIN IMMEDIATE');
      try {
        const pedido = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(id);
        if (!pedido) throw falha('404', 'pedido não encontrado');
        if (!fluxo[pedido.status]?.includes(novoStatus)) throw falha('estado', `transição inválida: ${pedido.status} → ${novoStatus}`);
        const alteracao = db.prepare('UPDATE pedidos SET status = ?, alterado_por = ?, alterado_em = datetime(\'now\') WHERE id = ? AND status = ?')
          .run(novoStatus, adminId, id, pedido.status);
        if (alteracao.changes !== 1) throw falha('estado', 'o pedido foi alterado por outra operação; atualize e tente novamente');
        const atualizado = obterPedidoInterno(id);
        db.exec('COMMIT');
        return atualizado;
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch { /* preserva o erro original */ }
        throw e;
      }
    },

    obterPedido: obterPedidoInterno,

    listarPedidos() {
      return db.prepare('SELECT * FROM pedidos ORDER BY criado_em DESC, rowid DESC').all().map((p) => obterPedidoInterno(p.id));
    },

    metricas() {
      const produtos = db.prepare('SELECT COUNT(*) AS n FROM produtos WHERE ativo = 1').get().n;
      const pedidos = db.prepare('SELECT COUNT(*) AS n FROM pedidos').get().n;
      const receitaCentavos = db.prepare("SELECT COALESCE(SUM(total_centavos), 0) AS r FROM pedidos WHERE status != 'cancelado'").get().r;
      return { produtos, pedidos, receita_centavos: Number(receitaCentavos), receita: Number(receitaCentavos) / 100 };
    }
  };
}
