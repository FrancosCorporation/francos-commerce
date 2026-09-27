// Testes do FrancosCommerce — CRUD de produtos + checkout com estoque + máquina de estados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { criarLoja } from '../src/loja.js';

const novaLoja = () => criarLoja(join(mkdtempSync(join(tmpdir(), 'fc-')), 't.db'));

test('produtos: CRUD completo (criar, listar, editar, apagar)', () => {
  const loja = novaLoja();
  const p = loja.criarProduto({ nome: 'Camiseta Franco', preco: 49.9, estoque: 10 });
  assert.ok(p.id);
  assert.equal(loja.listarProdutos().length, 1);
  loja.editarProduto(p.id, { preco: 59.9, estoque: 8 });
  assert.equal(loja.obterProduto(p.id).preco, 59.9);
  loja.apagarProduto(p.id);
  assert.equal(loja.obterProduto(p.id), null);
  assert.throws(() => loja.criarProduto({ nome: 'x', preco: -1 }));
});

test('checkout: valida estoque, cria pedido com itens, decrementa estoque', () => {
  const loja = novaLoja();
  const camiseta = loja.criarProduto({ nome: 'Camiseta', preco: 49.9, estoque: 10 });
  const caneca = loja.criarProduto({ nome: 'Caneca', preco: 29.9, estoque: 5 });
  const pedido = loja.checkout({
    clienteEmail: 'maria@x.dev', clienteNome: 'Maria',
    itens: [{ produtoId: camiseta.id, quantidade: 2 }, { produtoId: caneca.id, quantidade: 1 }]
  });
  assert.equal(pedido.status, 'criado');
  assert.ok(Math.abs(pedido.total - (49.9 * 2 + 29.9)) < 1e-9, 'total correto');
  assert.equal(pedido.itens.length, 2);
  assert.equal(loja.obterProduto(camiseta.id).estoque, 8, 'estoque decrementou');
  assert.equal(loja.obterProduto(caneca.id).estoque, 4);
});

test('checkout: estoque insuficiente rejeitado e ROLLBACK (nada parcial)', () => {
  const loja = novaLoja();
  const camiseta = loja.criarProduto({ nome: 'Camiseta', preco: 49.9, estoque: 3 });
  assert.throws(() => loja.checkout({
    clienteEmail: 'x@x', clienteNome: 'X',
    itens: [{ produtoId: camiseta.id, quantidade: 5 }]
  }), /estoque insuficiente/);
  assert.equal(loja.obterProduto(camiseta.id).estoque, 3, 'rollback: estoque intacto');
  assert.equal(loja.listarPedidos().length, 0, 'rollback: nenhum pedido criado');
});

test('máquina de estados: criado → pago → enviado → entregue (transições válidas)', () => {
  const loja = novaLoja();
  const p = loja.criarProduto({ nome: 'X', preco: 10, estoque: 1 });
  const pedido = loja.checkout({ clienteEmail: 'a@x', clienteNome: 'A', itens: [{ produtoId: p.id, quantidade: 1 }] });
  assert.equal(loja.transicionar(pedido.id, 'pago').status, 'pago');
  assert.equal(loja.transicionar(pedido.id, 'enviado').status, 'enviado');
  assert.equal(loja.transicionar(pedido.id, 'entregue').status, 'entregue');
});

test('máquina de estados: transições inválidas rejeitadas (criado → entregue direto)', () => {
  const loja = novaLoja();
  const p = loja.criarProduto({ nome: 'X', preco: 10, estoque: 1 });
  const pedido = loja.checkout({ clienteEmail: 'a@x', clienteNome: 'A', itens: [{ produtoId: p.id, quantidade: 1 }] });
  assert.throws(() => loja.transicionar(pedido.id, 'entregue'), /transição inválida/);
  assert.throws(() => loja.transicionar(pedido.id, 'enviado'), /transição inválida/);
  assert.equal(loja.transicionar(pedido.id, 'cancelado').status, 'cancelado');
  assert.throws(() => loja.transicionar(pedido.id, 'pago'), /transição inválida/); // cancelado é terminal
});

test('metricas: receita exclui cancelados', () => {
  const loja = novaLoja();
  const p = loja.criarProduto({ nome: 'X', preco: 100, estoque: 5 });
  const p1 = loja.checkout({ clienteEmail: 'a@x', clienteNome: 'A', itens: [{ produtoId: p.id, quantidade: 1 }] });
  const p2 = loja.checkout({ clienteEmail: 'b@x', clienteNome: 'B', itens: [{ produtoId: p.id, quantidade: 1 }] });
  loja.transicionar(p2.id, 'cancelado');
  const m = loja.metricas();
  assert.equal(m.receita, 100, 'só o pedido não-cancelado conta');
  assert.equal(m.pedidos, 2);
});
