import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import QRCode from 'qrcode';
import { initialGuests, initialGifts, wedding } from '../config.mjs';
import { makePix } from '../pix.mjs';

const STATE_KEY = 'private-state';
const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
const hash = value => createHash('sha256').update(value).digest('hex');
const baseHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' };
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
function text(value, max = 200, required = true) {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) throw fail('Revise os campos preenchidos.');
  return value.trim();
}
function integer(value, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) throw fail('Quantidade inválida.');
  return value;
}
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { ...baseHeaders, 'Content-Type': 'application/json; charset=utf-8', ...headers } });
function initialState() {
  return {
    schema: 1,
    guests: initialGuests.map(([name, max_companions, status, companions], index) => ({ id: index + 1, name, normalized: normalize(name), max_companions, status, companions, message: '', updated_at: null })),
    gifts: initialGifts.map(([name, description, amount, category, icon], index) => ({ id: index + 1, name, description, amount, category, icon, active: 1 })),
    contributions: [],
    nextGuest: initialGuests.length + 1, nextGift: initialGifts.length + 1, nextContribution: 1,
    settings: { token_secret: randomBytes(32).toString('hex'), epoch: 1, admin_hash: null, admin_salt: null },
    revoked: {}, limits: {},
  };
}
function token(settings, value) {
  const payload = Buffer.from(JSON.stringify({ ...value, epoch: settings.epoch })).toString('base64url');
  return `${payload}.${createHmac('sha256', settings.token_secret).update(payload).digest('base64url')}`;
}
function verifyToken(settings, value, kind) {
  try {
    if (typeof value !== 'string' || value.length > 2048) throw new Error();
    const parts = value.split('.');
    if (parts.length !== 2) throw new Error();
    const expected = createHmac('sha256', settings.token_secret).update(parts[0]).digest();
    const signature = Buffer.from(parts[1], 'base64url');
    if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) throw new Error();
    const data = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    if (data.kind !== kind || data.epoch !== settings.epoch || !Number.isFinite(data.exp) || data.exp <= Date.now()) throw new Error();
    return data;
  } catch { throw fail(kind === 'admin' ? 'Entre no painel para continuar.' : 'Procure seu nome novamente para confirmar.', kind === 'admin' ? 401 : 403); }
}
function adminSession(state, request) {
  const cookie = request.headers.get('cookie')?.match(/(?:^|;\s*)lacortes_session=([A-Za-z0-9_.-]+)/)?.[1];
  const session = verifyToken(state.settings, cookie, 'admin');
  if (!state.settings.admin_hash || state.revoked[session.sid]) throw fail('Entre no painel para continuar.', 401);
  return session;
}
async function body(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw fail('Formato de envio inválido.', 415);
  if (request.headers.get('origin') !== new URL(request.url).origin) throw fail('Origem não permitida.', 403);
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 16384) throw fail('Conteúdo muito grande.', 413);
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw fail('Envio inválido.'); }
}
function cookie(request, value, age) {
  return `lacortes_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
function csv(rows, fields) {
  const cell = value => { let s = String(value ?? ''); if (/^[\s]*[=+@-]/.test(s)) s = `'${s}`; return '"' + s.replaceAll('"', '""') + '"'; };
  return '\ufeff' + [fields.map(x => cell(x[1])).join(';'), ...rows.map(row => fields.map(x => cell(row[x[0]])).join(';'))].join('\r\n');
}

export function createHandler({ store, adminPassword }) {
  async function read() {
    let entry = await store.getWithMetadata(STATE_KEY, { type: 'json' });
    if (!entry) {
      await store.setJSON(STATE_KEY, initialState(), { onlyIfNew: true });
      entry = await store.getWithMetadata(STATE_KEY, { type: 'json' });
    }
    if (!entry) throw fail('Não foi possível abrir os dados do site.', 503);
    return entry;
  }
  // Conditional writes keep simultaneous confirmations from overwriting each other.
  async function mutate(change) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const { data, etag } = await read();
      const result = change(data);
      const saved = await store.setJSON(STATE_KEY, data, { onlyIfMatch: etag });
      if (saved.modified) return result;
    }
    throw fail('Há outras respostas sendo salvas. Tente novamente.', 409);
  }
  async function rate(scope, client, maximum) {
    await mutate(state => {
      const now = Date.now();
      for (const [key, value] of Object.entries(state.limits)) if (value.until <= now) delete state.limits[key];
      for (const [key, value] of Object.entries(state.revoked)) if (value <= now) delete state.revoked[key];
      const key = hash(`${scope}:${client}`);
      const current = state.limits[key];
      if (!current) state.limits[key] = { count: 1, until: now + 60000 };
      else if (current.count >= maximum) throw fail('Aguarde um minuto antes de tentar novamente.', 429);
      else current.count++;
    });
  }
  return async (request, context = {}) => {
    try {
      const url = new URL(request.url), route = url.pathname, method = request.method;
      if (!route.startsWith('/api/')) throw fail('Página não encontrada.', 404);
      if (!['GET', 'POST'].includes(method)) throw fail('Método não permitido.', 405);
      const isAdmin = route.startsWith('/api/admin/') && route !== '/api/admin/login';
      let state = (await read()).data;
      if (isAdmin) adminSession(state, request);
      const input = method === 'POST' ? await body(request) : null;
      if (method === 'POST') {
        const scope = route === '/api/admin/login' ? 'login' : route === '/api/rsvp/find' ? 'lookup' : isAdmin ? 'admin' : 'responses';
        await rate(scope, context.ip || 'unknown', scope === 'login' ? 5 : scope === 'lookup' ? 15 : isAdmin ? 60 : 20);
        state = (await read()).data;
      }
      if (method === 'GET' && route === '/api/gifts') return json({ gifts: state.gifts.filter(g => g.active).sort((a, b) => a.id - b.id) });
      if (method === 'GET' && /^\/api\/gifts\/\d+\/pix$/.test(route)) {
        const gift = state.gifts.find(g => g.id === Number(route.split('/')[3]) && g.active);
        if (!gift) throw fail('Presente não encontrado.', 404);
        const payload = makePix(gift.amount);
        const qr = await QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', width: 280, margin: 4 });
        return json({ payload, qr, key: wedding.pixKey, amount: gift.amount });
      }
      if (method === 'POST' && route === '/api/rsvp/find') {
        const name = normalize(text(input.name, 120));
        const guest = state.guests.find(g => g.normalized === name);
        if (!guest) throw fail('Não encontramos esse nome. Confira o nome completo do convite ou fale com os noivos.', 404);
        return json({ token: token(state.settings, { kind: 'invite', id: guest.id, name: hash(guest.normalized), exp: Date.now() + 600000 }), name: guest.name, maxCompanions: guest.max_companions, status: guest.status, companions: guest.companions });
      }
      if (method === 'POST' && route === '/api/rsvp/respond') {
        return json(await mutate(current => {
          const invitation = verifyToken(current.settings, input.token, 'invite');
          const guest = current.guests.find(g => g.id === invitation.id && hash(g.normalized) === invitation.name);
          if (!guest) throw fail('Convite não encontrado.', 404);
          if (!['confirmed', 'declined'].includes(input.status)) throw fail('Selecione sua resposta.');
          const companions = input.status === 'declined' ? 0 : integer(input.companions, 0, guest.max_companions);
          Object.assign(guest, { status: input.status, companions, message: text(input.message || '', 1000, false), updated_at: new Date().toISOString() });
          return { ok: true, name: guest.name, status: guest.status, companions };
        }));
      }
      if (method === 'POST' && route === '/api/contributions') {
        const sender = text(input.sender, 120), message = text(input.message || '', 1000, false), requestId = text(input.requestId, 64);
        if (!/^[a-f0-9-]{36}$/.test(requestId)) throw fail('Identificador inválido.');
        return json(await mutate(current => {
          const existing = current.contributions.find(g => g.request_id === requestId);
          if (existing) return { ok: true, id: existing.id, status: existing.status };
          const gift = current.gifts.find(g => g.id === integer(input.giftId, 1, 1000000) && g.active);
          if (!gift) throw fail('Presente não encontrado.', 404);
          if (gift.amount !== input.amount) throw fail('O valor foi atualizado. Abra o presente novamente para conferir.', 409);
          const id = current.nextContribution++;
          current.contributions.push({ id, request_id: requestId, gift_id: gift.id, gift_name: gift.name, amount: gift.amount, sender, message, status: 'pending', created_at: new Date().toISOString(), confirmed_at: null });
          return { ok: true, id, status: 'pending' };
        }), 201);
      }
      if (method === 'POST' && route === '/api/admin/login') {
        if (!state.settings.admin_hash) {
          if (typeof adminPassword !== 'string' || adminPassword.length < 12) throw fail('Defina LACORTES_ADMIN_PASSWORD nas variáveis do Netlify, com pelo menos 12 caracteres, para habilitar o painel.', 503);
          await mutate(current => {
            if (!current.settings.admin_hash) {
              const salt = randomBytes(16).toString('hex');
              current.settings.admin_salt = salt;
              current.settings.admin_hash = scryptSync(adminPassword, salt, 64).toString('hex');
            }
          });
          state = (await read()).data;
        }
        const password = text(input.password, 200);
        if (!timingSafeEqual(Buffer.from(state.settings.admin_hash, 'hex'), scryptSync(password, state.settings.admin_salt, 64))) throw fail('Senha incorreta.', 401);
        const signed = token(state.settings, { kind: 'admin', sid: randomBytes(16).toString('hex'), exp: Date.now() + 28800000 });
        return json({ ok: true }, 200, { 'Set-Cookie': cookie(request, signed, 28800) });
      }
      if (method === 'POST' && route === '/api/admin/logout') {
        await mutate(current => { const session = adminSession(current, request); current.revoked[session.sid] = session.exp; });
        return json({ ok: true }, 200, { 'Set-Cookie': cookie(request, '', 0) });
      }
      if (method === 'GET' && route === '/api/admin/dashboard') return json({ guests: [...state.guests].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')), gifts: [...state.gifts].sort((a, b) => a.id - b.id), contributions: [...state.contributions].sort((a, b) => b.id - a.id), demo: true });
      if (method === 'POST' && route === '/api/admin/guests') {
        const name = text(input.name, 120), max = integer(input.max_companions, 0, 20);
        if (!['pending', 'confirmed', 'declined'].includes(input.status)) throw fail('Resposta inválida.');
        const companions = input.status === 'confirmed' ? integer(input.companions, 0, max) : 0;
        await mutate(current => {
          adminSession(current, request);
          if (current.guests.some(g => g.normalized === normalize(name) && g.id !== input.id)) throw fail('Já existe um convidado com esse nome.');
          const fields = { name, normalized: normalize(name), max_companions: max, status: input.status, companions, updated_at: new Date().toISOString() };
          if (input.id) {
            const guest = current.guests.find(g => g.id === integer(input.id, 1, 1000000));
            if (!guest) throw fail('Convidado não encontrado.', 404);
            Object.assign(guest, fields);
          } else current.guests.push({ id: current.nextGuest++, message: '', ...fields });
        });
        return json({ ok: true });
      }
      if (method === 'POST' && route === '/api/admin/guests/delete') {
        const id = integer(input.id, 1, 1000000);
        await mutate(current => { adminSession(current, request); current.guests = current.guests.filter(g => g.id !== id); });
        return json({ ok: true });
      }
      if (method === 'POST' && route === '/api/admin/gifts') {
        const name = text(input.name, 120), description = text(input.description, 300);
        if (!Number.isFinite(input.amount) || input.amount < 1 || input.amount > 100000 || Math.round(input.amount * 100) / 100 !== input.amount) throw fail('Informe um valor válido com até duas casas decimais.');
        if (!['casa', 'experiencias', 'simbolicos'].includes(input.category)) throw fail('Categoria inválida.');
        await mutate(current => {
          adminSession(current, request);
          const fields = { name, description, amount: input.amount, category: input.category, active: input.active ? 1 : 0 };
          if (input.id) {
            const gift = current.gifts.find(g => g.id === integer(input.id, 1, 1000000));
            if (!gift) throw fail('Presente não encontrado.', 404);
            Object.assign(gift, fields);
          } else current.gifts.push({ id: current.nextGift++, icon: 'dinner', ...fields });
        });
        return json({ ok: true });
      }
      if (method === 'POST' && route === '/api/admin/contributions') {
        if (!['pending', 'confirmed'].includes(input.status)) throw fail('Situação inválida.');
        await mutate(current => {
          adminSession(current, request);
          const contribution = current.contributions.find(g => g.id === integer(input.id, 1, 1000000));
          if (!contribution) throw fail('Registro não encontrado.', 404);
          Object.assign(contribution, { status: input.status, confirmed_at: input.status === 'confirmed' ? new Date().toISOString() : null });
        });
        return json({ ok: true });
      }
      if (method === 'POST' && route === '/api/admin/password') {
        const password = text(input.password, 200);
        if (password.length < 12) throw fail('Use pelo menos 12 caracteres.');
        await mutate(current => {
          adminSession(current, request);
          const salt = randomBytes(16).toString('hex');
          current.settings.admin_salt = salt;
          current.settings.admin_hash = scryptSync(password, salt, 64).toString('hex');
          current.settings.epoch++;
          current.revoked = {};
        });
        return json({ ok: true }, 200, { 'Set-Cookie': cookie(request, '', 0) });
      }
      if (method === 'GET' && route === '/api/admin/export') {
        const gifts = url.searchParams.get('type') === 'gifts';
        const rows = gifts ? state.contributions : state.guests;
        const fields = gifts ? [['sender', 'Nome'], ['gift_name', 'Presente'], ['amount', 'Valor'], ['status', 'Status'], ['message', 'Mensagem'], ['created_at', 'Data']] : [['name', 'Nome'], ['max_companions', 'Limite de acompanhantes'], ['status', 'Status'], ['companions', 'Acompanhantes confirmados'], ['message', 'Mensagem']];
        return new Response(csv(rows, fields), { headers: { ...baseHeaders, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${gifts ? 'presentes' : 'convidados'}-lacortes.csv"` } });
      }
      throw fail('Página não encontrada.', 404);
    } catch (error) {
      return json({ error: error.status ? error.message : 'Não foi possível concluir. Tente novamente.' }, error.status || 500);
    }
  };
}
