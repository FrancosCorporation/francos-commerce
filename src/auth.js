// Autenticação administrativa: primeira conta semeada por ambiente, sem cadastro público.
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';

const SEGREDO = process.env.JWT_SECRET ?? (
  process.env.NODE_ENV === 'test' ? 'francos-commerce-test-only-secret-min-32-bytes' : undefined
);
if (!SEGREDO || Buffer.byteLength(SEGREDO, 'utf8') < 32) {
  throw new Error('JWT_SECRET ausente ou curto — defina um segredo com pelo menos 32 bytes.');
}

const HASH_DUMMY = bcrypt.hashSync('senha-invalida-para-login-admin', 12);

function emailCanonico(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

export function inicializarAutenticacao(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      senha_hash TEXT NOT NULL,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  const total = db.prepare('SELECT COUNT(*) AS n FROM admins').get().n;
  if (total === 0) {
    const email = emailCanonico(process.env.ADMIN_EMAIL);
    const senha = process.env.ADMIN_PASSWORD;
    if (!/^[^\s@]+@[^\s@]+$/.test(email) || email.length > 254 || typeof senha !== 'string' || senha.length < 12 || senha.length > 128) {
      throw new Error('Primeiro início sem administrador: defina ADMIN_EMAIL válido e ADMIN_PASSWORD com 12 a 128 caracteres.');
    }
    db.prepare('INSERT INTO admins (id, email, senha_hash) VALUES (?, ?, ?)')
      .run(randomUUID(), email, bcrypt.hashSync(senha, 12));
  }

  function verificarToken(token) {
    try {
      const payload = jwt.verify(token, SEGREDO, { algorithms: ['HS256'] });
      return payload.role === 'admin' && typeof payload.sub === 'string' && payload.sub ? payload : null;
    } catch { return null; }
  }

  function login(req, res) {
    const email = emailCanonico(req.body?.email);
    const senha = req.body?.senha;
    const admin = db.prepare('SELECT id, email, senha_hash FROM admins WHERE lower(email) = ?').get(email);
    const senhaValida = bcrypt.compareSync(typeof senha === 'string' && senha.length <= 128 ? senha : '', admin?.senha_hash || HASH_DUMMY);
    if (!admin || typeof senha !== 'string' || senha.length < 12 || senha.length > 128 || !senhaValida) {
      return res.status(401).json({ erro: { codigo: 'credenciais', mensagem: 'Credenciais inválidas' } });
    }
    const token = jwt.sign({ sub: admin.id, email: admin.email, role: 'admin' }, SEGREDO, { expiresIn: '12h' });
    return res.json({ token, admin: { id: admin.id, email: admin.email } });
  }

  function exigirAdmin(req, res, next) {
    const cabecalho = req.headers.authorization;
    const token = cabecalho?.startsWith('Bearer ') ? cabecalho.slice(7) : '';
    const payload = token ? verificarToken(token) : null;
    if (!payload) return res.status(401).json({ erro: { codigo: 'token', mensagem: 'Token administrativo ausente ou inválido' } });
    req.admin = payload;
    return next();
  }

  return { login, exigirAdmin };
}
