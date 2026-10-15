import http from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import QRCode from 'qrcode';
import { initialGuests, initialGifts, wedding } from './config.mjs';
import { makePix } from './pix.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');
const dataDir = process.env.LACORTES_DATA_DIR || path.join(root, 'data');
await mkdir(dataDir, { recursive: true, mode: 0o700 });
const db = new DatabaseSync(path.join(dataDir, 'wedding.sqlite'));
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS guests (id INTEGER PRIMARY KEY, name TEXT NOT NULL, normalized TEXT NOT NULL UNIQUE, max_companions INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', companions INTEGER NOT NULL DEFAULT 0, message TEXT NOT NULL DEFAULT '', updated_at TEXT);
CREATE TABLE IF NOT EXISTS gifts (id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, amount REAL NOT NULL, category TEXT NOT NULL, icon TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS contributions (id INTEGER PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, gift_id INTEGER NOT NULL, gift_name TEXT NOT NULL, amount REAL NOT NULL, sender TEXT NOT NULL, message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, confirmed_at TEXT);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
const normalize = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
if (!db.prepare('SELECT value FROM settings WHERE key=?').get('seeded')) {
  db.exec('BEGIN');
  for (const [name, max, status, companions] of initialGuests) db.prepare('INSERT INTO guests(name,normalized,max_companions,status,companions) VALUES(?,?,?,?,?)').run(name, normalize(name), max, status, companions);
  for (const [name, description, amount, category, icon] of initialGifts) db.prepare('INSERT INTO gifts(name,description,amount,category,icon) VALUES(?,?,?,?,?)').run(name, description, amount, category, icon);
  db.prepare('INSERT INTO settings VALUES(?,?)').run('seeded', '1');
  db.exec('COMMIT');
}
if (!db.prepare('SELECT value FROM settings WHERE key=?').get('admin_hash')) {
  const password = process.env.LACORTES_ADMIN_PASSWORD || randomBytes(12).toString('base64url');
  if (password.length < 12) throw new Error('A senha administrativa deve ter pelo menos 12 caracteres.');
  const salt = randomBytes(16).toString('hex');
  db.prepare('INSERT INTO settings VALUES(?,?)').run('admin_salt', salt);
  db.prepare('INSERT INTO settings VALUES(?,?)').run('admin_hash', scryptSync(password, salt, 64).toString('hex'));
  console.log(`Senha inicial do painel dos noivos: ${password}`);
  console.log('Guarde esta senha. Ela não será exibida novamente.');
}
const sessions = new Map(), invitations = new Map(), limits = new Map();
const port = Number(process.env.PORT || 4173);
const baseHeaders = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};
function json(res, value, status = 200, headers = {}) { res.writeHead(status, { ...baseHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify(value)); }
function error(message, status = 400) { const e = new Error(message); e.status = status; return e; }
function text(value, max = 200, required = true) { if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) throw error('Revise os campos preenchidos.'); return value.trim(); }
function integer(value, min, max) { if (!Number.isInteger(value) || value < min || value > max) throw error('Quantidade inválida.'); return value; }
function rate(req, scope, maximum) {
  const key = `${req.socket.remoteAddress}:${scope}`, now = Date.now();
  const entry = limits.get(key);
  if (!entry || entry.until < now) limits.set(key, { count: 1, until: now + 60_000 });
  else if (++entry.count > maximum) throw error('Aguarde um minuto antes de tentar novamente.', 429);
}
function session(req) {
  const token = (req.headers.cookie || '').match(/(?:^|;\s*)lacortes_session=([A-Za-z0-9_-]+)/)?.[1];
  const s = sessions.get(token);
  if (!s || s.until < Date.now()) throw error('Entre no painel para continuar.', 401);
  return token;
}
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw error('Formato de envio inválido.', 415);
  const origin = req.headers.origin;
  if (![`http://localhost:${port}`, `http://127.0.0.1:${port}`].includes(origin)) throw error('Origem não permitida.', 403);
  let chunks = '', size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 16_384) throw error('Conteúdo muito grande.', 413); chunks += chunk; }
  try { return JSON.parse(chunks); } catch { throw error('Envio inválido.'); }
}
function csv(rows, fields) {
  const cell = value => { let s = String(value ?? ''); if (/^[\s]*[=+@-]/.test(s)) s = `'${s}`; return '"' + s.replaceAll('"', '""') + '"'; };
  return '\ufeff' + [fields.map(x => cell(x[1])).join(';'), ...rows.map(row => fields.map(x => cell(row[x[0]])).join(';'))].join('\r\n');
}
const server = http.createServer(async (req, res) => {
  try {
    if (![`localhost:${port}`, `127.0.0.1:${port}`].includes(req.headers.host)) throw error('Host não permitido.', 403);
    const url = new URL(req.url, `http://127.0.0.1:${port}`), route = url.pathname;
    if (route.startsWith('/api/')) {
      const admin = route.startsWith('/api/admin/') && !route.endsWith('/login');
      if (admin) session(req);
      if (req.method === 'GET' && route === '/api/gifts') return json(res, { gifts: db.prepare('SELECT * FROM gifts WHERE active=1 ORDER BY id').all() });
      if (req.method === 'GET' && /^\/api\/gifts\/\d+\/pix$/.test(route)) {
        const gift = db.prepare('SELECT * FROM gifts WHERE id=? AND active=1').get(Number(route.split('/')[3]));
        if (!gift) throw error('Presente não encontrado.', 404);
        const payload = makePix(gift.amount), qr = await QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', width: 280, margin: 4 });
        return json(res, { payload, qr, key: wedding.pixKey, amount: gift.amount });
      }
      if (req.method === 'POST' && route === '/api/rsvp/find') {
        rate(req, 'lookup', 15); const input = await body(req), name = text(input.name, 120);
        const guest = db.prepare('SELECT * FROM guests WHERE normalized=?').get(normalize(name));
        if (!guest) throw error('Não encontramos esse nome. Confira o nome completo do convite ou fale com os noivos.', 404);
        const token = randomBytes(24).toString('base64url'); invitations.set(token, { id: guest.id, until: Date.now() + 600_000 });
        return json(res, { token, name: guest.name, maxCompanions: guest.max_companions, status: guest.status, companions: guest.companions });
      }
      if (req.method === 'POST' && route === '/api/rsvp/respond') {
        rate(req, 'rsvp', 20); const input = await body(req), invitation = invitations.get(input.token);
        if (!invitation || invitation.until < Date.now()) throw error('Procure seu nome novamente para confirmar.', 403);
        const guest = db.prepare('SELECT * FROM guests WHERE id=?').get(invitation.id);
        if (!guest) throw error('Convite não encontrado.', 404);
        if (!['confirmed', 'declined'].includes(input.status)) throw error('Selecione sua resposta.');
        const companions = input.status === 'declined' ? 0 : integer(input.companions, 0, guest.max_companions);
        const message = text(input.message || '', 1000, false);
        db.prepare('UPDATE guests SET status=?,companions=?,message=?,updated_at=? WHERE id=?').run(input.status, companions, message, new Date().toISOString(), guest.id);
        return json(res, { ok: true, name: guest.name, status: input.status, companions });
      }
      if (req.method === 'POST' && route === '/api/contributions') {
        rate(req, 'gifts', 15); const input = await body(req);
        const sender = text(input.sender, 120), message = text(input.message || '', 1000, false), requestId = text(input.requestId, 64);
        if (!/^[a-f0-9-]{36}$/.test(requestId)) throw error('Identificador inválido.');
        const existing = db.prepare('SELECT id FROM contributions WHERE request_id=?').get(requestId);
        if (existing) return json(res, { ok: true, id: existing.id, status: 'pending' });
        const gift = db.prepare('SELECT * FROM gifts WHERE id=? AND active=1').get(integer(input.giftId, 1, 1000000));
        if (!gift) throw error('Presente não encontrado.', 404);
        if (input.amount !== gift.amount) throw error('O valor foi atualizado. Abra o presente novamente para conferir.', 409);
        const saved = db.prepare('INSERT INTO contributions(request_id,gift_id,gift_name,amount,sender,message,created_at) VALUES(?,?,?,?,?,?,?)').run(requestId, gift.id, gift.name, gift.amount, sender, message, new Date().toISOString());
        return json(res, { ok: true, id: Number(saved.lastInsertRowid), status: 'pending' }, 201);
      }
      if (req.method === 'POST' && route === '/api/admin/login') {
        rate(req, 'login', 5); const input = await body(req), password = text(input.password, 200);
        const salt = db.prepare('SELECT value FROM settings WHERE key=?').get('admin_salt').value;
        const hash = db.prepare('SELECT value FROM settings WHERE key=?').get('admin_hash').value;
        if (!timingSafeEqual(Buffer.from(hash, 'hex'), scryptSync(password, salt, 64))) throw error('Senha incorreta.', 401);
        const token = randomBytes(32).toString('base64url'); sessions.set(token, { until: Date.now() + 28_800_000 });
        return json(res, { ok: true }, 200, { 'Set-Cookie': `lacortes_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800` });
      }
      if (req.method === 'POST' && route === '/api/admin/logout') { await body(req); sessions.delete(session(req)); return json(res, { ok: true }, 200, { 'Set-Cookie': 'lacortes_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' }); }
      if (req.method === 'GET' && route === '/api/admin/dashboard') {
        return json(res, { guests: db.prepare('SELECT * FROM guests ORDER BY name').all(), gifts: db.prepare('SELECT * FROM gifts ORDER BY id').all(), contributions: db.prepare('SELECT * FROM contributions ORDER BY id DESC').all(), demo: true });
      }
      if (req.method === 'POST' && route === '/api/admin/guests') {
        const input = await body(req), name = text(input.name, 120), max = integer(input.max_companions, 0, 20);
        if (!['pending', 'confirmed', 'declined'].includes(input.status)) throw error('Resposta inválida.');
        const companions = input.status === 'confirmed' ? integer(input.companions, 0, max) : 0;
        try {
          if (input.id) {
            const result = db.prepare('UPDATE guests SET name=?,normalized=?,max_companions=?,status=?,companions=?,updated_at=? WHERE id=?').run(name, normalize(name), max, input.status, companions, new Date().toISOString(), integer(input.id, 1, 1000000));
            if (!result.changes) throw error('Convidado não encontrado.', 404);
          } else db.prepare('INSERT INTO guests(name,normalized,max_companions,status,companions) VALUES(?,?,?,?,?)').run(name, normalize(name), max, input.status, companions);
        } catch (e) { if (e.message.includes('UNIQUE')) throw error('Já existe um convidado com esse nome.'); throw e; }
        return json(res, { ok: true });
      }
      if (req.method === 'POST' && route === '/api/admin/guests/delete') {
        const input = await body(req); db.prepare('DELETE FROM guests WHERE id=?').run(integer(input.id, 1, 1000000)); return json(res, { ok: true });
      }
      if (req.method === 'POST' && route === '/api/admin/gifts') {
        const input = await body(req), name = text(input.name, 120), description = text(input.description, 300);
        if (!Number.isFinite(input.amount) || input.amount < 1 || input.amount > 100000 || Math.round(input.amount * 100) / 100 !== input.amount) throw error('Informe um valor válido com até duas casas decimais.');
        if (!['casa', 'experiencias', 'simbolicos'].includes(input.category)) throw error('Categoria inválida.');
        const active = input.active ? 1 : 0;
        if (input.id) db.prepare('UPDATE gifts SET name=?,description=?,amount=?,category=?,active=? WHERE id=?').run(name, description, input.amount, input.category, active, integer(input.id, 1, 1000000));
        else db.prepare('INSERT INTO gifts(name,description,amount,category,icon,active) VALUES(?,?,?,?,?,?)').run(name, description, input.amount, input.category, 'dinner', active);
        return json(res, { ok: true });
      }
      if (req.method === 'POST' && route === '/api/admin/contributions') {
        const input = await body(req);
        if (!['pending', 'confirmed'].includes(input.status)) throw error('Situação inválida.');
        db.prepare('UPDATE contributions SET status=?,confirmed_at=? WHERE id=?').run(input.status, input.status === 'confirmed' ? new Date().toISOString() : null, integer(input.id, 1, 1000000));
        return json(res, { ok: true });
      }
      if (req.method === 'POST' && route === '/api/admin/password') {
        const input = await body(req), password = text(input.password, 200);
        if (password.length < 12) throw error('Use pelo menos 12 caracteres.');
        const salt = randomBytes(16).toString('hex');
        db.exec('BEGIN');
        db.prepare('UPDATE settings SET value=? WHERE key=?').run(salt, 'admin_salt');
        db.prepare('UPDATE settings SET value=? WHERE key=?').run(scryptSync(password, salt, 64).toString('hex'), 'admin_hash');
        db.exec('COMMIT'); sessions.clear();
        return json(res, { ok: true }, 200, { 'Set-Cookie': 'lacortes_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
      }
      if (req.method === 'GET' && route === '/api/admin/export') {
        const gifts = url.searchParams.get('type') === 'gifts';
        const rows = db.prepare(gifts ? 'SELECT * FROM contributions ORDER BY id' : 'SELECT * FROM guests ORDER BY name').all();
        const fields = gifts ? [['sender', 'Nome'], ['gift_name', 'Presente'], ['amount', 'Valor'], ['status', 'Status'], ['message', 'Mensagem'], ['created_at', 'Data']] : [['name', 'Nome'], ['max_companions', 'Limite de acompanhantes'], ['status', 'Status'], ['companions', 'Acompanhantes confirmados'], ['message', 'Mensagem']];
        res.writeHead(200, { ...baseHeaders, 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="${gifts ? 'presentes' : 'convidados'}-lacortes.csv"` }); return res.end(csv(rows, fields));
      }
      throw error('Página não encontrada.', 404);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw error('Método não permitido.', 405);
    const relative = route === '/' ? 'index.html' : ['/admin', '/admin/'].includes(route) ? 'admin.html' : decodeURIComponent(route).slice(1);
    const filename = path.resolve(publicDir, relative);
    if (!filename.startsWith(publicDir + path.sep) || relative.split('/').some(x => x.startsWith('.'))) throw error('Página não encontrada.', 404);
    if (!existsSync(filename) || !(await stat(filename)).isFile()) throw error('Página não encontrada.', 404);
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.otf': 'font/otf', '.ics': 'text/calendar; charset=utf-8' };
    res.writeHead(200, { ...baseHeaders, 'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': path.extname(filename) === '.html' ? 'no-cache' : 'public, max-age=3600' });
    res.end(req.method === 'HEAD' ? undefined : await readFile(filename));
  } catch (e) { json(res, { error: e.status ? e.message : 'Não foi possível concluir. Tente novamente.' }, e.status || 500); if (!e.status) console.error(e); }
});
const sweep = setInterval(() => { const now = Date.now(); for (const map of [sessions, invitations]) for (const [k,v] of map) if (v.until < now) map.delete(k); for (const [k,v] of limits) if (v.until < now) limits.delete(k); }, 60_000);
sweep.unref();
server.listen(port, '127.0.0.1', () => console.log(`The Lacorte's: http://127.0.0.1:${port}\nPainel dos noivos: http://127.0.0.1:${port}/admin`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(() => { db.close(); process.exit(0); }); });
