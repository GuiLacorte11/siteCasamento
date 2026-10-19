import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';

test('local shop settings survive restart and leave Pix payments independent', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'lacortes-catalog-test-'));
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const origin = `http://127.0.0.1:${port}`, password = 'catalog-test-only-password';
  let child;
  async function stop() {
    if (child && child.exitCode === null) { const done = once(child, 'exit'); child.kill('SIGTERM'); await done; }
  }
  t.after(async () => { await stop(); await rm(directory, { recursive: true, force: true }); });
  async function start() {
    child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(port), LACORTES_DATA_DIR: directory, LACORTES_ADMIN_PASSWORD: password }, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('O servidor local de teste não iniciou.')), 10000);
      child.stdout.on('data', chunk => { if (String(chunk).includes(`http://127.0.0.1:${port}`)) { clearTimeout(timeout); resolve(); } });
      child.once('exit', () => { clearTimeout(timeout); reject(new Error('O servidor local de teste foi encerrado antes de iniciar.')); });
      child.once('error', error => { clearTimeout(timeout); reject(error); });
    });
  }
  async function call(route, data, cookie) {
    const response = await fetch(origin + route, { method: data === undefined ? 'GET' : 'POST', headers: { ...(data === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    return { status: response.status, headers: response.headers, value: await response.json() };
  }
  await start();
  const login = await call('/api/admin/login', { password });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const gift = (await call('/api/gifts')).value.gifts.find(g => g.id === 3);
  assert.equal(gift.physical_enabled, 1);
  const update = { ...gift, physical_enabled: true, product_url: 'https://loja.example/tacas' };
  assert.equal((await call('/api/admin/gifts', update, cookie)).status, 200);
  assert.equal((await call('/api/admin/gifts', { ...update, product_url: 'javascript:alert(1)' }, cookie)).status, 400);
  await stop(); await start();
  const persisted = (await call('/api/gifts')).value.gifts.find(g => g.id === 3);
  assert.equal(persisted.product_url, update.product_url);
  assert.equal(persisted.physical_enabled, 1);
  assert.equal((await call('/api/gifts/3/pix')).value.amount, gift.amount);
});
