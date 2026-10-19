import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createHandler } from '../lib/netlify-api.mjs';

// Simulates the storage contract, including conditional writes and isolated reads.
function memoryStore() {
  let value = null, revision = 0;
  return {
    async getWithMetadata() { return value === null ? null : { data: structuredClone(value), etag: String(revision) }; },
    async setJSON(key, data, options = {}) {
      if ((options.onlyIfNew && value !== null) || (options.onlyIfMatch !== undefined && options.onlyIfMatch !== String(revision))) return { modified: false };
      value = structuredClone(data); revision++;
      return { modified: true, etag: String(revision) };
    },
  };
}
const password = 'test-only-password-1234';
const origin = 'https://wedding.example';
function caller(store, client = 'test-client', adminPassword = password) {
  const handle = createHandler({ store, adminPassword });
  return async (route, data, cookie, overrides = {}) => {
    const headers = { ...(data !== undefined ? { 'Content-Type': 'application/json', Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}), ...overrides };
    const response = await handle(new Request(origin + route, { method: data === undefined ? 'GET' : 'POST', headers, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) }), { ip: client });
    const value = response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text();
    return { status: response.status, value, headers: response.headers };
  };
}
async function login(call) { const result = await call('/api/admin/login', { password }); assert.equal(result.status, 200); return result.headers.get('set-cookie').split(';')[0]; }

test('public catalog and Pix work without exposing guests or requiring an admin password', async () => {
  const call = caller(memoryStore(), 'public', undefined);
  const result = await call('/api/gifts');
  assert.equal(result.status, 200); assert.equal(result.value.gifts.length, 30);
  assert.equal(result.value.guests, undefined); assert.equal(result.value.settings, undefined);
  const pix = await call('/api/gifts/1/pix');
  assert.equal(pix.status, 200); assert.equal(pix.value.amount, 50);
  assert.match(pix.value.qr, /^data:image\/png;base64,/); assert.match(pix.value.payload, /540550\.00/);
  assert.equal((await call('/api/admin/dashboard')).status, 401);
});

test('confirmation survives a fresh handler and rejects excess companions or forged invitations', async () => {
  const store = memoryStore(), call = caller(store);
  const invitation = (await call('/api/rsvp/find', { name: '  Mariana   Costa  ' })).value;
  assert.equal(invitation.maxCompanions, 2);
  assert.equal((await call('/api/rsvp/respond', { token: invitation.token, status: 'confirmed', companions: 3 })).status, 400);
  assert.equal((await call('/api/rsvp/respond', { token: invitation.token + 'x', status: 'confirmed', companions: 0 })).status, 403);
  const fresh = caller(store, 'fresh-client');
  assert.equal((await fresh('/api/rsvp/respond', { token: invitation.token, status: 'confirmed', companions: 2, message: 'Até lá!' })).status, 200);
  const found = (await fresh('/api/rsvp/find', { name: 'Mariana Costa' })).value;
  assert.equal(found.status, 'confirmed'); assert.equal(found.companions, 2);
});

test('simultaneous confirmations persist independently', async () => {
  const store = memoryStore(), first = caller(store, 'first'), second = caller(store, 'second');
  const a = (await first('/api/rsvp/find', { name: 'Pedro Almeida' })).value;
  const b = (await second('/api/rsvp/find', { name: 'Lucas Ferreira' })).value;
  const results = await Promise.all([
    first('/api/rsvp/respond', { token: a.token, status: 'confirmed', companions: 0 }),
    second('/api/rsvp/respond', { token: b.token, status: 'confirmed', companions: 1 }),
  ]);
  assert.ok(results.every(x => x.status === 200));
  assert.equal((await first('/api/rsvp/find', { name: 'Pedro Almeida' })).value.status, 'confirmed');
  assert.equal((await second('/api/rsvp/find', { name: 'Lucas Ferreira' })).value.companions, 1);
});

test('contribution retries are idempotent and never mark a payment as received', async () => {
  const call = caller(memoryStore());
  const data = { giftId: 1, amount: 50, sender: 'Teste', message: 'Felicidades', requestId: randomUUID() };
  const first = await call('/api/contributions', data), again = await call('/api/contributions', data);
  assert.equal(first.status, 201); assert.equal(again.value.id, first.value.id); assert.equal(first.value.status, 'pending');
  assert.equal((await call('/api/contributions', { ...data, requestId: randomUUID(), amount: 1 })).status, 409);
  const dashboard = (await call('/api/admin/dashboard', undefined, await login(call))).value;
  assert.equal(dashboard.contributions.length, 1); assert.equal(dashboard.contributions[0].status, 'pending');
});

test('admin sessions work across handlers, hide inactive gifts, and revoke on logout', async () => {
  const store = memoryStore(), call = caller(store), session = await login(call);
  const other = caller(store, 'other');
  assert.equal((await other('/api/admin/dashboard', undefined, session)).status, 200);
  assert.equal((await other('/api/admin/gifts', { id: 1, name: 'Café', description: 'A dois', amount: 75, category: 'experiencias', active: false }, session)).status, 200);
  assert.equal((await other('/api/gifts')).value.gifts.some(g => g.id === 1), false);
  assert.equal((await other('/api/gifts/1/pix')).status, 404);
  assert.equal((await call('/api/admin/logout', {}, session)).status, 200);
  assert.equal((await other('/api/admin/dashboard', undefined, session)).status, 401);
});

test('renamed or deleted guests cannot use an old invitation', async () => {
  const call = caller(memoryStore()), session = await login(call);
  const invitation = (await call('/api/rsvp/find', { name: 'Pedro Almeida' })).value;
  await call('/api/admin/guests', { id: 2, name: 'Pedro Teste', max_companions: 0, status: 'pending', companions: 0 }, session);
  assert.equal((await call('/api/rsvp/respond', { token: invitation.token, status: 'confirmed', companions: 0 })).status, 404);
  await call('/api/admin/guests/delete', { id: 2 }, session);
  assert.equal((await call('/api/rsvp/find', { name: 'Pedro Teste' })).status, 404);
});

test('password change invalidates prior sessions and persists after redeploy', async () => {
  const store = memoryStore(), call = caller(store), session = await login(call);
  const result = await call('/api/admin/password', { password: 'replacement-test-password' }, session);
  assert.equal(result.status, 200);
  const restarted = caller(store, 'restarted');
  assert.equal((await restarted('/api/admin/dashboard', undefined, session)).status, 401);
  assert.equal((await restarted('/api/admin/login', { password })).status, 401);
  assert.equal((await restarted('/api/admin/login', { password: 'replacement-test-password' })).status, 200);
});

test('CSRF is rejected and rate limiting persists across handlers', async () => {
  const store = memoryStore();
  assert.equal((await caller(store)('/api/rsvp/find', { name: 'Mariana Costa' }, null, { Origin: 'https://unrelated.example' })).status, 403);
  for (let i = 0; i < 5; i++) assert.equal((await caller(store)('/api/admin/login', { password: 'wrong' })).status, 401);
  assert.equal((await caller(store)('/api/admin/login', { password })).status, 429);
});

test('CSV exports require authentication and neutralize spreadsheet formulas', async () => {
  const call = caller(memoryStore()), session = await login(call);
  await call('/api/admin/guests', { name: '=formula', max_companions: 0, status: 'pending', companions: 0 }, session);
  assert.equal((await call('/api/admin/export')).status, 401);
  const exported = await call('/api/admin/export', undefined, session);
  assert.equal(exported.status, 200); assert.ok(exported.value.includes("\"'=formula\""));
});

test('hybrid gifts persist shop links across handlers while preserving Pix', async () => {
  const store = memoryStore(), call = caller(store), session = await login(call);
  const catalog = (await call('/api/gifts')).value.gifts;
  assert.equal(catalog.find(g => g.id === 1).physical_enabled, 0);
  const gift = catalog.find(g => g.id === 3);
  assert.equal(gift.physical_enabled, 1);
  const update = { ...gift, physical_enabled: true, product_url: 'https://loja.example/produto?cor=verde' };
  assert.equal((await call('/api/admin/gifts', update)).status, 401);
  assert.equal((await call('/api/admin/gifts', update, session)).status, 200);
  const fresh = caller(store, 'fresh-catalog');
  assert.equal((await fresh('/api/gifts')).value.gifts.find(g => g.id === 3).product_url, update.product_url);
  assert.equal((await fresh('/api/gifts/3/pix')).value.amount, gift.amount);
  assert.equal((await fresh('/api/admin/dashboard', undefined, session)).value.contributions.length, 0);
  for (const product_url of ['javascript:alert(1)', 'data:text/html,test', 'https://user:password@loja.example/item', 'http://loja.example/item']) {
    assert.equal((await call('/api/admin/gifts', { ...update, product_url }, session)).status, 400);
  }
  assert.equal((await fresh('/api/gifts')).value.gifts.find(g => g.id === 3).product_url, update.product_url);
  assert.equal((await call('/api/admin/gifts', { ...update, physical_enabled: false, product_url: '' }, session)).status, 200);
  const disabled = (await fresh('/api/gifts')).value.gifts.find(g => g.id === 3);
  assert.equal(disabled.physical_enabled, 0); assert.equal(disabled.product_url, '');
});

test('old hosted catalogs gain product defaults without losing saved information', async () => {
  const store = memoryStore(), call = caller(store);
  await call('/api/gifts');
  const { data, etag } = await store.getWithMetadata();
  for (const gift of data.gifts) { delete gift.physical_enabled; delete gift.product_url; }
  data.gifts[2].description = 'Descrição já cadastrada';
  await store.setJSON('private-state', data, { onlyIfMatch: etag });
  const gift = (await caller(store)('/api/gifts')).value.gifts.find(g => g.id === 3);
  assert.equal(gift.description, 'Descrição já cadastrada');
  assert.equal(gift.physical_enabled, 1); assert.equal(gift.product_url, '');
});
