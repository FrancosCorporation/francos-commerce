// FrancosCommerce — servidor: API (produtos CRUD + checkout + estados) + vitrine + painel admin.
import express from 'express';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { criarLoja } from './src/loja.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = process.env.PORT || 3200;
const loja = criarLoja(process.env.COMMERCE_DB || 'francos-commerce.db');

const app = express();
app.use(express.json());

// seed inicial (vitrine com produtos demo se vazia)
if (loja.listarProdutos().length === 0) {
  loja.criarProduto({ nome: 'Camiseta Franco Dev', preco: 49.9, estoque: 20, descricao: '100% algodão, estampado' });
  loja.criarProduto({ nome: 'Caneca WebSockets', preco: 29.9, estoque: 15, descricao: 'cerâmica, 325ml' });
  loja.criarProduto({ nome: 'Boné Open Source', preco: 39.9, estoque: 12, descricao: 'aba curva, ajustável' });
  loja.criarProduto({ nome: 'Mousepad Docker', preco: 34.9, estoque: 18, descricao: '900x300mm, base antiderrapante' });
}

function erro(e, res) {
  const status = { produto: 400, dados: 400, estado: 400, estoque: 409, '404': 404 }[e.codigo] || 500;
  res.status(status).json({ erro: { codigo: e.codigo, mensagem: e.message } });
}

// ---- produtos ----
app.get('/api/produtos', (req, res) => res.json(loja.listarProdutos()));
app.post('/api/produtos', (req, res) => { try { res.status(201).json(loja.criarProduto(req.body)); } catch (e) { erro(e, res); } });
app.patch('/api/produtos/:id', (req, res) => { try { res.json(loja.editarProduto(req.params.id, req.body)); } catch (e) { erro(e, res); } });
app.delete('/api/produtos/:id', (req, res) => { try { res.json(loja.apagarProduto(req.params.id)); } catch (e) { erro(e, res); } });

// ---- checkout + pedidos ----
app.post('/api/checkout', (req, res) => { try { res.status(201).json(loja.checkout(req.body)); } catch (e) { erro(e, res); } });
app.get('/api/pedidos', (req, res) => res.json(loja.listarPedidos()));
app.post('/api/pedidos/:id/:acao', (req, res) => { try { res.json(loja.transicionar(req.params.id, req.params.acao)); } catch (e) { erro(e, res); } });
app.get('/api/metricas', (req, res) => res.json(loja.metricas()));

// estático (vitrine + admin)
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
app.use(async (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  try {
    let arquivo = normalize(join(ROOT, 'public', req.path));
    if (!arquivo.startsWith(ROOT)) throw new Error('fora');
    const dados = await readFile(arquivo);
    res.writeHead(200, { 'Content-Type': MIME[extname(arquivo)] || 'text/html; charset=utf-8' });
    res.end(dados);
  } catch {
    try {
      const indice = await readFile(join(ROOT, 'public/index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(indice);
    } catch { res.writeHead(500); res.end('erro'); }
  }
});

const server = http.createServer(app);
export { server, loja };

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => console.log(`FrancosCommerce em http://localhost:${PORT} (vitrine + checkout)`));
}
