const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const statusPedido = {
  criado: 'Recebido',
  pago: 'Pago',
  enviado: 'Enviado',
  entregue: 'Entregue',
  cancelado: 'Cancelado'
};
const transicoes = {
  criado: ['pago', 'cancelado'],
  pago: ['enviado', 'cancelado'],
  enviado: ['entregue'],
  entregue: [],
  cancelado: []
};
const TOKEN_KEY = 'francos_admin_token';
const produtos = new Map();
const carrinho = new Map();
let tokenAdmin = sessionStorage.getItem(TOKEN_KEY) || '';

const $ = (id) => document.getElementById(id);
const criar = (tag, classe, texto) => {
  const elemento = document.createElement(tag);
  if (classe) elemento.className = classe;
  if (texto !== undefined) elemento.textContent = texto;
  return elemento;
};
const reais = (centavos) => moeda.format((Number(centavos) || 0) / 100);

function mensagem(elemento, texto = '', erro = false) {
  elemento.textContent = texto;
  elemento.hidden = !texto;
  elemento.classList.toggle('error', Boolean(erro && texto));
}

async function requisicao(url, { token = '', ...opcoes } = {}) {
  const headers = new Headers(opcoes.headers || {});
  if (opcoes.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const resposta = await fetch(url, { ...opcoes, headers });
  const tipo = resposta.headers.get('content-type') || '';
  const corpo = tipo.includes('application/json') ? await resposta.json() : null;
  if (!resposta.ok) {
    const erro = new Error(corpo?.erro?.mensagem || `Não foi possível concluir a solicitação (${resposta.status}).`);
    erro.status = resposta.status;
    throw erro;
  }
  return corpo;
}

function abrir(dialogo) {
  if (!dialogo.open) dialogo.showModal();
}

function fechar(dialogo) {
  if (dialogo.open) dialogo.close();
}

function mostrarProdutos() {
  const vitrine = $('vitrine');
  vitrine.replaceChildren();
  $('catalog-count').textContent = `${produtos.size} ${produtos.size === 1 ? 'produto disponível' : 'produtos disponíveis'}`;

  if (!produtos.size) {
    vitrine.append(criar('p', 'cart-empty', 'Nenhum produto disponível no momento.'));
    return;
  }

  for (const produto of produtos.values()) {
    const card = criar('article', 'product-card');
    const arte = criar('div', 'product-art');
    arte.setAttribute('aria-hidden', 'true');
    arte.append(criar('span', '', (produto.nome || 'F').trim().charAt(0).toUpperCase()));
    const nome = criar('h3', '', produto.nome);
    const descricao = criar('p', 'product-description', produto.descricao || 'Um item especial da nossa seleção.');
    const rodape = criar('div', 'product-bottom');
    const preco = criar('div');
    preco.append(criar('strong', 'product-price', reais(produto.preco_centavos)));
    const estoque = Number(produto.estoque) || 0;
    preco.append(criar('small', 'product-stock', estoque > 0 ? `${estoque} em estoque` : 'Indisponível'));
    const adicionar = criar('button', 'button button-primary', estoque > 0 ? 'Adicionar' : 'Sem estoque');
    adicionar.type = 'button';
    adicionar.disabled = estoque < 1;
    adicionar.setAttribute('aria-label', `${estoque > 0 ? 'Adicionar' : 'Produto indisponível'}: ${produto.nome}`);
    adicionar.addEventListener('click', () => adicionarAoCarrinho(produto.id));
    rodape.append(preco, adicionar);
    card.append(arte, nome, descricao, rodape);
    vitrine.append(card);
  }
}

async function carregarProdutos() {
  const vitrine = $('vitrine');
  vitrine.setAttribute('aria-busy', 'true');
  try {
    const lista = await requisicao('/api/produtos');
    produtos.clear();
    for (const produto of lista) produtos.set(String(produto.id), produto);
    mostrarProdutos();
    mensagem($('store-message'));
    renderizarCarrinho();
  } catch (erro) {
    mensagem($('store-message'), erro.message || 'Não foi possível carregar a loja.', true);
  } finally {
    vitrine.removeAttribute('aria-busy');
  }
}

function adicionarAoCarrinho(id) {
  const produto = produtos.get(String(id));
  if (!produto || Number(produto.estoque) < 1) return;
  const quantidade = carrinho.get(String(id)) || 0;
  if (quantidade >= Number(produto.estoque)) {
    abrir($('carrinho-dialog'));
    mensagem($('checkout-message'), `Só há ${produto.estoque} unidade(s) de ${produto.nome} em estoque.`, true);
    return;
  }
  carrinho.set(String(id), quantidade + 1);
  renderizarCarrinho();
  $('carrinho-n').setAttribute('aria-label', `${quantidade + 1} itens no carrinho`);
}

function alterarQuantidade(id, delta) {
  const chave = String(id);
  const produto = produtos.get(chave);
  const quantidade = (carrinho.get(chave) || 0) + delta;
  if (quantidade <= 0) carrinho.delete(chave);
  else if (produto && quantidade <= Number(produto.estoque)) carrinho.set(chave, quantidade);
  else mensagem($('checkout-message'), 'A quantidade solicitada excede o estoque disponível.', true);
  renderizarCarrinho();
}

function renderizarCarrinho() {
  const itens = $('itens-carrinho');
  itens.replaceChildren();
  let totalCentavos = 0;
  let quantidadeTotal = 0;

  for (const [id, quantidade] of [...carrinho]) {
    const produto = produtos.get(id);
    if (!produto) {
      carrinho.delete(id);
      continue;
    }
    quantidadeTotal += quantidade;
    totalCentavos += Number(produto.preco_centavos) * quantidade;
    const linha = criar('div', 'cart-row');
    const descricao = criar('div');
    descricao.append(criar('strong', '', produto.nome));
    descricao.append(criar('small', '', `${reais(produto.preco_centavos)} cada`));
    const controle = criar('div', 'quantity-control');
    const diminuir = criar('button', '', '−');
    diminuir.type = 'button';
    diminuir.setAttribute('aria-label', `Diminuir quantidade de ${produto.nome}`);
    diminuir.addEventListener('click', () => alterarQuantidade(id, -1));
    const numero = criar('span', '', String(quantidade));
    const aumentar = criar('button', '', '+');
    aumentar.type = 'button';
    aumentar.disabled = quantidade >= Number(produto.estoque);
    aumentar.setAttribute('aria-label', `Aumentar quantidade de ${produto.nome}`);
    aumentar.addEventListener('click', () => alterarQuantidade(id, 1));
    const remover = criar('button', 'cart-remove', 'Remover');
    remover.type = 'button';
    remover.addEventListener('click', () => {
      carrinho.delete(id);
      renderizarCarrinho();
    });
    controle.append(diminuir, numero, aumentar, remover);
    linha.append(descricao, controle);
    itens.append(linha);
  }

  if (!quantidadeTotal) itens.append(criar('p', 'cart-empty', 'Seu carrinho está vazio.'));
  $('total-carrinho').textContent = reais(totalCentavos);
  $('carrinho-n').textContent = String(quantidadeTotal);
  $('carrinho-n').setAttribute('aria-label', `${quantidadeTotal} ${quantidadeTotal === 1 ? 'item' : 'itens'} no carrinho`);
  $('btn-checkout').disabled = quantidadeTotal === 0;
}

async function fazerCheckout(evento) {
  evento.preventDefault();
  if (!carrinho.size) {
    mensagem($('checkout-message'), 'Adicione ao menos um produto antes de confirmar.', true);
    return;
  }
  const botao = $('btn-checkout');
  botao.disabled = true;
  mensagem($('checkout-message'));
  const itens = [...carrinho].map(([produtoId, quantidade]) => ({ produtoId, quantidade }));
  try {
    const pedido = await requisicao('/api/checkout', {
      method: 'POST',
      body: JSON.stringify({
        clienteNome: $('cli-nome').value.trim(),
        clienteEmail: $('cli-email').value.trim(),
        itens
      })
    });
    carrinho.clear();
    $('checkout-form').reset();
    mensagem($('checkout-message'), `Pedido ${pedido.id} recebido. Total: ${reais(pedido.total_centavos)}. Este checkout é demonstrativo e não processa pagamentos.`);
    renderizarCarrinho();
    await carregarProdutos();
  } catch (erro) {
    mensagem($('checkout-message'), erro.message, true);
    await carregarProdutos();
  } finally {
    botao.disabled = carrinho.size === 0;
  }
}

function sairAdmin() {
  tokenAdmin = '';
  sessionStorage.removeItem(TOKEN_KEY);
  $('admin-login-section').hidden = false;
  $('admin-panel').hidden = true;
  $('admin-login-form').reset();
}

async function carregarPainel() {
  if (!tokenAdmin) {
    $('admin-login-section').hidden = false;
    $('admin-panel').hidden = true;
    return;
  }
  $('admin-login-section').hidden = true;
  $('admin-panel').hidden = false;
  mensagem($('admin-message'));
  try {
    const [metricas, listaProdutos, pedidos] = await Promise.all([
      requisicao('/api/metricas', { token: tokenAdmin }),
      requisicao('/api/produtos'),
      requisicao('/api/pedidos', { token: tokenAdmin })
    ]);
    renderizarMetricas(metricas);
    renderizarProdutosAdmin(listaProdutos);
    renderizarPedidos(pedidos);
  } catch (erro) {
    if (erro.status === 401) {
      sairAdmin();
      mensagem($('admin-login-message'), 'Sua sessão expirou. Entre novamente.', true);
    } else {
      mensagem($('admin-message'), erro.message, true);
    }
  }
}

function renderizarMetricas(metricas) {
  const area = $('admin-metrics');
  area.replaceChildren();
  const valores = [
    ['Produtos ativos', String(metricas.produtos)],
    ['Pedidos', String(metricas.pedidos)],
    ['Receita registrada', reais(metricas.receita_centavos)]
  ];
  for (const [rotulo, valor] of valores) {
    const cartao = criar('div', 'metric');
    cartao.append(criar('span', '', rotulo), criar('strong', '', valor));
    area.append(cartao);
  }
}

function renderizarProdutosAdmin(lista) {
  const area = $('admin-products');
  area.replaceChildren();
  if (!lista.length) {
    area.append(criar('p', 'cart-empty', 'Ainda não há produtos no catálogo.'));
    return;
  }
  for (const produto of lista) {
    const linha = criar('article', 'admin-row');
    const resumo = criar('div');
    resumo.append(criar('strong', '', produto.nome));
    resumo.append(criar('small', '', `${reais(produto.preco_centavos)} · ${produto.estoque} em estoque`));
    const acoes = criar('div', 'admin-row-actions');
    const editar = criar('button', 'button button-quiet', 'Editar');
    editar.type = 'button';
    editar.addEventListener('click', () => abrirFormularioProduto(produto));
    const remover = criar('button', 'button button-danger', 'Remover');
    remover.type = 'button';
    remover.addEventListener('click', () => removerProduto(produto));
    acoes.append(editar, remover);
    linha.append(resumo, acoes);
    area.append(linha);
  }
}

function dataLegivel(valor) {
  if (!valor) return 'Data indisponível';
  const data = new Date(`${String(valor).replace(' ', 'T')}Z`);
  return Number.isNaN(data.getTime()) ? String(valor) : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(data);
}

function renderizarPedidos(pedidos) {
  const area = $('admin-orders');
  area.replaceChildren();
  $('admin-order-count').textContent = `${pedidos.length} ${pedidos.length === 1 ? 'pedido' : 'pedidos'}`;
  if (!pedidos.length) {
    area.append(criar('p', 'cart-empty', 'Nenhum pedido recebido.'));
    return;
  }
  for (const pedido of pedidos) {
    const linha = criar('article', 'admin-row');
    const resumo = criar('div');
    resumo.append(criar('strong', '', `${pedido.cliente_nome} · ${reais(pedido.total_centavos)}`));
    resumo.append(criar('small', '', `${pedido.cliente_email} · ${statusPedido[pedido.status] || pedido.status} · ${dataLegivel(pedido.criado_em)}`));
    if (Array.isArray(pedido.itens)) {
      const itens = pedido.itens.map((item) => `${item.quantidade}× ${item.nome}`).join(', ');
      resumo.append(criar('small', '', itens));
    }
    const acoes = criar('div', 'order-actions');
    const opcoes = transicoes[pedido.status] || [];
    if (opcoes.length) {
      const selecao = document.createElement('select');
      selecao.setAttribute('aria-label', `Próximo estado do pedido de ${pedido.cliente_nome}`);
      selecao.append(new Option('Atualizar status…', ''));
      for (const status of opcoes) selecao.append(new Option(statusPedido[status], status));
      const atualizar = criar('button', 'button button-quiet', 'Aplicar');
      atualizar.type = 'button';
      atualizar.addEventListener('click', () => {
        if (selecao.value) mudarStatusPedido(pedido.id, selecao.value, atualizar);
      });
      acoes.append(selecao, atualizar);
    } else {
      acoes.append(criar('small', 'muted', 'Sem novas ações'));
    }
    linha.append(resumo, acoes);
    area.append(linha);
  }
}

async function mudarStatusPedido(id, status, botao) {
  botao.disabled = true;
  try {
    await requisicao(`/api/pedidos/${encodeURIComponent(id)}/${encodeURIComponent(status)}`, { method: 'POST', token: tokenAdmin, body: '{}' });
    await carregarPainel();
    mensagem($('admin-message'), 'Status do pedido atualizado.');
  } catch (erro) {
    mensagem($('admin-message'), erro.message, true);
  } finally {
    botao.disabled = false;
  }
}

function abrirFormularioProduto(produto = null) {
  $('product-form').reset();
  $('product-id').value = produto?.id || '';
  $('product-dialog-title').textContent = produto ? 'Editar produto' : 'Novo produto';
  $('product-name').value = produto?.nome || '';
  $('product-price').value = produto ? (Number(produto.preco_centavos) / 100).toFixed(2) : '';
  $('product-stock').value = produto?.estoque ?? 0;
  $('product-description').value = produto?.descricao || '';
  mensagem($('product-message'));
  abrir($('product-dialog'));
  $('product-name').focus();
}

async function salvarProduto(evento) {
  evento.preventDefault();
  const id = $('product-id').value;
  const botao = $('btn-save-product');
  botao.disabled = true;
  mensagem($('product-message'));
  const dados = {
    nome: $('product-name').value.trim(),
    preco: Number($('product-price').value),
    estoque: Number($('product-stock').value),
    descricao: $('product-description').value.trim()
  };
  try {
    await requisicao(id ? `/api/produtos/${encodeURIComponent(id)}` : '/api/produtos', {
      method: id ? 'PATCH' : 'POST', token: tokenAdmin, body: JSON.stringify(dados)
    });
    fechar($('product-dialog'));
    await Promise.all([carregarProdutos(), carregarPainel()]);
    mensagem($('admin-message'), 'Produto salvo.');
  } catch (erro) {
    mensagem($('product-message'), erro.message, true);
  } finally {
    botao.disabled = false;
  }
}

async function removerProduto(produto) {
  if (!window.confirm(`Remover “${produto.nome}” do catálogo? O histórico dos pedidos será preservado.`)) return;
  try {
    await requisicao(`/api/produtos/${encodeURIComponent(produto.id)}`, { method: 'DELETE', token: tokenAdmin });
    await Promise.all([carregarProdutos(), carregarPainel()]);
    mensagem($('admin-message'), 'Produto removido do catálogo.');
  } catch (erro) {
    mensagem($('admin-message'), erro.message, true);
  }
}

async function entrarAdmin(evento) {
  evento.preventDefault();
  const botao = $('btn-admin-login');
  botao.disabled = true;
  mensagem($('admin-login-message'));
  try {
    const resultado = await requisicao('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ email: $('admin-email').value.trim(), senha: $('admin-password').value })
    });
    tokenAdmin = resultado.token;
    sessionStorage.setItem(TOKEN_KEY, tokenAdmin);
    $('admin-login-form').reset();
    await carregarPainel();
  } catch (erro) {
    mensagem($('admin-login-message'), erro.message, true);
  } finally {
    botao.disabled = false;
  }
}

$('btn-admin').addEventListener('click', async () => {
  abrir($('admin-dialog'));
  await carregarPainel();
});
$('btn-carrinho').addEventListener('click', () => {
  mensagem($('checkout-message'));
  abrir($('carrinho-dialog'));
});
$('checkout-form').addEventListener('submit', fazerCheckout);
$('admin-login-form').addEventListener('submit', entrarAdmin);
$('btn-admin-sair').addEventListener('click', sairAdmin);
$('btn-add-product').addEventListener('click', () => abrirFormularioProduto());
$('btn-recarregar-admin').addEventListener('click', carregarPainel);
$('product-form').addEventListener('submit', salvarProduto);
document.querySelectorAll('[data-close]').forEach((botao) => {
  botao.addEventListener('click', () => fechar($(botao.dataset.close)));
});
for (const dialogo of document.querySelectorAll('dialog')) {
  dialogo.addEventListener('click', (evento) => {
    if (evento.target === dialogo) fechar(dialogo);
  });
}

renderizarCarrinho();
carregarProdutos();
