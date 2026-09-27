// FrancosCommerce M1 — núcleo: produtos (CRUD) + carrinho + checkout (máquina de estados do pedido).
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export function criarLoja(caminhoDb = 'francos-commerce.db') {
  const db = new DatabaseSync(caminhoDb);
  db.exec(`
  CREATE TABLE IF NOT EXISTS produtos (
    id TEXT PRIMARY KEY, nome TEXT NOT NULL, preco REAL NOT NULL,
    estoque INTEGER NOT NULL DEFAULT 0, descricao TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS pedidos (
    id TEXT PRIMARY KEY, cliente_email TEXT NOT NULL, cliente_nome TEXT NOT NULL,
    total REAL NOT NULL, status TEXT NOT NULL DEFAULT 'criado'
      CHECK (status IN ('criado','pago','enviado','entregue','cancelado')),
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS itens_pedido (
    id TEXT PRIMARY KEY, pedido_id TEXT NOT NULL, produto_id TEXT NOT NULL,
    nome TEXT NOT NULL, preco_unit REAL NOT NULL, quantidade INTEGER NOT NULL
  );
  `);

  return {
    db,

    // ---- produtos (CRUD) ----
    criarProduto({ nome, preco, estoque = 0, descricao = '' }) {
      if (!nome || preco <= 0 || estoque < 0) throw Object.assign(new Error('nome e preco (>0) obrigatórios, estoque >=0'), { codigo: 'produto' });
      const id = randomUUID().slice(0, 10);
      db.prepare('INSERT INTO produtos (id, nome, preco, estoque, descricao) VALUES (?, ?, ?, ?, ?)').run(id, nome, preco, estoque, descricao);
      return this.obterProduto(id);
    },
    obterProduto(id) { return db.prepare('SELECT * FROM produtos WHERE id = ?').get(id) || null; },
    listarProdutos() { return db.prepare('SELECT * FROM produtos ORDER BY nome').all(); },
    editarProduto(id, mudancas = {}) {
      const permitidos = ['nome', 'preco', 'estoque', 'descricao'];
      const sets = Object.keys(mudancas).filter((k) => permitidos.includes(k));
      if (!sets.length) return this.obterProduto(id);
      db.prepare(`UPDATE produtos SET ${sets.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...sets.map((k) => mudancas[k]), id);
      return this.obterProduto(id);
    },
    apagarProduto(id) {
      const p = this.obterProduto(id);
      if (!p) throw Object.assign(new Error('produto não encontrado'), { codigo: '404' });
      db.prepare('DELETE FROM produtos WHERE id = ?').run(id);
      return { apagado: true, id };
    },

    // ---- carrinho -> checkout (máquina de estados) ----
    // checkout: valida estoque, cria pedido + itens, decrementa estoque (transação)
    checkout({ clienteEmail, clienteNome, itens }) {
      if (!clienteEmail || !clienteNome || !Array.isArray(itens) || itens.length === 0) {
        throw Object.assign(new Error('cliente e itens obrigatórios'), { codigo: 'dados' });
      }
      db.exec('BEGIN');
      try {
        let total = 0;
        const preparados = [];
        for (const it of itens) {
          const p = this.obterProduto(it.produtoId);
          if (!p) throw Object.assign(new Error(`produto ${it.produtoId} não encontrado`), { codigo: '404' });
          const qtd = Number(it.quantidade);
          if (!(qtd >= 1)) throw Object.assign(new Error('quantidade >= 1'), { codigo: 'dados' });
          if (p.estoque < qtd) throw Object.assign(new Error(`estoque insuficiente: ${p.nome} (${p.estoque} disponíveis)`), { codigo: 'estoque' });
          total += p.preco * qtd;
          preparados.push({ p, qtd });
        }
        const id = randomUUID().slice(0, 10);
        db.prepare('INSERT INTO pedidos (id, cliente_email, cliente_nome, total, status) VALUES (?, ?, ?, ?, ?)').run(id, clienteEmail, clienteNome, total, 'criado');
        for (const { p, qtd } of preparados) {
          db.prepare('INSERT INTO itens_pedido (id, pedido_id, produto_id, nome, preco_unit, quantidade) VALUES (?, ?, ?, ?, ?, ?)')
            .run(randomUUID().slice(0, 10), id, p.id, p.nome, p.preco, qtd);
          db.prepare('UPDATE produtos SET estoque = estoque - ? WHERE id = ?').run(qtd, p.id);
        }
        db.exec('COMMIT');
        return this.obterPedido(id);
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },

    // máquina de estados do pedido: criado → pago → enviado → entregue (transição válida)
    transicionar(id, novoStatus) {
      const FLUXO = { criado: ['pago', 'cancelado'], pago: ['enviado', 'cancelado'], enviado: ['entregue'], entregue: [], cancelado: [] };
      const pedido = this.obterPedido(id);
      if (!pedido) throw Object.assign(new Error('pedido não encontrado'), { codigo: '404' });
      if (!FLUXO[pedido.status]?.includes(novoStatus)) {
        throw Object.assign(new Error(`transição inválida: ${pedido.status} → ${novoStatus}`), { codigo: 'estado' });
      }
      db.prepare('UPDATE pedidos SET status = ? WHERE id = ?').run(novoStatus, id);
      return this.obterPedido(id);
    },

    obterPedido(id) {
      const pedido = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(id);
      if (!pedido) return null;
      pedido.itens = db.prepare('SELECT * FROM itens_pedido WHERE pedido_id = ?').all(id);
      return pedido;
    },
    listarPedidos() { return db.prepare('SELECT * FROM pedidos ORDER BY criado_em DESC').all(); },

    metricas() {
      const produtos = db.prepare('SELECT COUNT(*) AS n FROM produtos').get().n;
      const pedidos = db.prepare('SELECT COUNT(*) AS n FROM pedidos').get().n;
      const receita = db.prepare("SELECT COALESCE(SUM(total), 0) AS r FROM pedidos WHERE status != 'cancelado'").get().r;
      return { produtos, pedidos, receita };
    }
  };
}
