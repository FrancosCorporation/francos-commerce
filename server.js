// FrancosCommerce — vitrine e checkout públicos; operações da loja só para admin.
import express from 'express';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import helmet from 'helmet';
import { criarLoja } from './src/loja.js';
import { inicializarAutenticacao } from './src/auth.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT || 3200);
const loja = criarLoja(process.env.COMMERCE_DB || 'francos-commerce.db');
const auth = inicializarAutenticacao(loja.db);

// Seed de demonstração só quando a tabela nunca recebeu produtos.
if (loja.db.prepare('SELECT COUNT(*) AS n FROM produtos').get().n === 0) {
  loja.criarProduto({ nome: 'Camiseta Franco Dev', preco: 49.9, estoque: 20, descricao: '100% algodão, estampado' });
  loja.criarProduto({ nome: 'Caneca WebSockets', preco: 29.9, estoque: 15, descricao: 'cerâmica, 325ml' });
  loja.criarProduto({ nome: 'Boné Open Source', preco: 39.9, estoque: 12, descricao: 'aba curva, ajustável' });
  loja.criarProduto({ nome: 'Mousepad Docker', preco: 34.9, estoque: 18, descricao: '900x300mm, base antiderrapante' });
}

const app = express();
app.disable('x-powered-by');
const desenvolvimento = app.get('env') !== 'production';
app.use(helmet({
  strictTransportSecurity: false,
  contentSecurityPolicy: {
    directives: { 'upgrade-insecure-requests': desenvolvimento ? null : [] }
  }
}));
app.use(express.json({ limit: '32kb' }));

function criarLimitador(limite, janelaMs, maxChaves = 20_000) {
  const janelas = new Map();
  let operacoes = 0;
  return (chave) => {
    const agora = Date.now();
    let janela = janelas.get(chave);
    if (!janela || janela.ate <= agora) {
      janela = { usos: 0, ate: agora + janelaMs };
      janelas.set(chave, janela);
    }
    const permitido = janela.usos < limite;
    if (permitido) janela.usos += 1;
    if (++operacoes % 256 === 0 || janelas.size > maxChaves) {
      for (const [k, v] of janelas) if (v.ate <= agora) janelas.delete(k);
      while (janelas.size > maxChaves) janelas.delete(janelas.keys().next().value);
    }
    return { permitido, aguardeMs: Math.max(1, janela.ate - agora) };
  };
}

const limiteLoginIp = criarLimitador(20, 5 * 60 * 1000);
const limiteLoginEmail = criarLimitador(5, 5 * 60 * 1000);
const limiteCheckoutIp = criarLimitador(20, 10 * 60 * 1000);
const limiteCheckoutEmail = criarLimitador(5, 10 * 60 * 1000);

function aplicarLimite(req, res, regras) {
  const bloqueados = regras.filter((regra) => !regra.permitido);
  if (!bloqueados.length) return false;
  const aguarde = Math.max(1, Math.ceil(Math.max(...bloqueados.map((r) => r.aguardeMs)) / 1000));
  res.setHeader('Retry-After', String(aguarde));
  res.status(429).json({ erro: { codigo: 'limite', mensagem: 'Muitas tentativas. Aguarde antes de tentar novamente.' } });
  return true;
}

function limitarLogin(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || 'desconhecido';
  const emailBruto = req.body?.email;
  const email = typeof emailBruto === 'string' && emailBruto.length <= 254 ? emailBruto.trim().toLowerCase() : '';
  const regras = [limiteLoginIp(ip)];
  if (email) regras.push(limiteLoginEmail(email));
  if (aplicarLimite(req, res, regras)) return;
  next();
}

function limitarCheckout(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || 'desconhecido';
  const emailBruto = req.body?.clienteEmail;
  const email = typeof emailBruto === 'string' && emailBruto.length <= 254 ? emailBruto.trim().toLowerCase() : '';
  const regras = [limiteCheckoutIp(ip)];
  if (email) regras.push(limiteCheckoutEmail(email));
  if (aplicarLimite(req, res, regras)) return;
  next();
}

function erro(e, res) {
  const status = { produto: 400, dados: 400, estado: 409, estoque: 409, credenciais: 401, '404': 404 }[e.codigo] || 500;
  if (status === 500) console.error('[FrancosCommerce] Erro interno:', e);
  res.status(status).json({ erro: { codigo: status === 500 ? 'interno' : e.codigo, mensagem: status === 500 ? 'Erro interno do servidor' : e.message } });
}

// ---- login de administrador ----
app.post('/api/admin/login', limitarLogin, auth.login);

// ---- vitrine pública ----
app.get('/api/produtos', (req, res) => res.json(loja.listarProdutos()));
app.post('/api/checkout', limitarCheckout, (req, res) => {
  try { res.status(201).json(loja.checkout(req.body ?? {})); }
  catch (e) { erro(e, res); }
});

// ---- operações privadas da loja ----
app.post('/api/produtos', auth.exigirAdmin, (req, res) => {
  try { res.status(201).json(loja.criarProduto(req.body ?? {})); }
  catch (e) { erro(e, res); }
});
app.patch('/api/produtos/:id', auth.exigirAdmin, (req, res) => {
  try { res.json(loja.editarProduto(req.params.id, req.body ?? {})); }
  catch (e) { erro(e, res); }
});
app.delete('/api/produtos/:id', auth.exigirAdmin, (req, res) => {
  try { res.json(loja.apagarProduto(req.params.id)); }
  catch (e) { erro(e, res); }
});
app.get('/api/pedidos', auth.exigirAdmin, (req, res) => res.json(loja.listarPedidos()));
app.post('/api/pedidos/:id/:acao', auth.exigirAdmin, (req, res) => {
  try { res.json(loja.transicionar(req.params.id, req.params.acao, req.admin.sub)); }
  catch (e) { erro(e, res); }
});
app.get('/api/metricas', auth.exigirAdmin, (req, res) => res.json(loja.metricas()));

app.use('/api', (req, res) => res.status(404).json({ erro: { codigo: '404', mensagem: 'Rota não encontrada' } }));

// ---- painel same-origin ----
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
app.use(async (req, res, next) => {
  try {
    const pastaPublica = resolve(ROOT, 'public');
    const arquivo = resolve(pastaPublica, `.${req.path}`);
    if (arquivo !== pastaPublica && !arquivo.startsWith(`${pastaPublica}${sep}`)) throw new Error('fora');
    const dados = await readFile(arquivo);
    res.writeHead(200, { 'Content-Type': MIME[extname(arquivo)] || 'application/octet-stream' });
    res.end(dados);
  } catch {
    try {
      const indice = await readFile(join(ROOT, 'public/index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(indice);
    } catch { res.writeHead(500); res.end('erro'); }
  }
});

app.use((e, req, res, next) => {
  if (res.headersSent) return next(e);
  const status = Number.isInteger(e.status) && e.status >= 400 && e.status < 500 ? e.status : 500;
  if (status === 500) console.error('[FrancosCommerce] Erro HTTP interno:', e);
  const mensagem = status === 413 ? 'Corpo da requisição excede 32 KiB' : status === 400 ? 'JSON inválido' : 'Erro interno do servidor';
  res.status(status).json({ erro: { codigo: status === 500 ? 'interno' : 'requisicao_invalida', mensagem } });
});

const server = http.createServer(app);
export { server, app, loja };

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => console.log(`FrancosCommerce em http://localhost:${PORT} (vitrine + checkout)`));
}
