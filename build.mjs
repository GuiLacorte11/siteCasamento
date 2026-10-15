import { cp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import QRCode from 'qrcode';
import { initialGifts, wedding } from './config.mjs';
import { makePix } from './pix.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(root, 'dist');
await rm(output, { recursive: true, force: true });
await cp(path.join(root, 'public'), output, { recursive: true });
await mkdir(path.join(output, 'static-data'), { recursive: true });
const gifts = initialGifts.map(([name, description, amount, category, icon], index) => ({ id: index + 1, name, description, amount, category, icon, active: 1 }));
await writeFile(path.join(output, 'static-data/gifts.json'), JSON.stringify({ gifts }));
for (const gift of gifts) {
  const payload = makePix(gift.amount);
  const qr = await QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', width: 280, margin: 4 });
  await writeFile(path.join(output, `static-data/pix-${gift.id}.json`), JSON.stringify({ payload, qr, key: wedding.pixKey, amount: gift.amount, registrationAvailable: false }));
}
for (const name of ['index.html', 'admin.html']) {
  const filename = path.join(output, name);
  let html = await readFile(filename, 'utf8');
  for (const asset of ['app.js', 'admin.js', 'editorial.css', 'admin.css', 'styles.css']) {
    const version = createHash('sha256').update(await readFile(path.join(output, asset))).digest('hex').slice(0, 10);
    html = html.replace(new RegExp(`/${asset.replace('.', '\\.')}(?:\\?v=[a-z0-9]+)?`, 'g'), `/${asset}?v=${version}`);
  }
  await writeFile(filename, html);
}
if (process.argv.includes('--static')) {
  const filename = path.join(output, 'index.html');
  let html = (await readFile(filename, 'utf8')).replace('<head>', '<head>\n  <meta name="site-mode" content="static">');
  html = html.replace('Digite seu nome completo na seção de confirmação e responda ao convite. Você também pode informar quantos acompanhantes autorizados irão com você. Para atualizar a resposta, procure seu nome novamente.', 'Use o botão “Confirmar pelo WhatsApp” na seção de confirmação. Envie seu nome completo e a quantidade de acompanhantes conforme o convite. Para atualizar sua resposta, fale novamente com os noivos.');
  html = html.replace('Você pode registrar seu nome e um recado. Os noivos conferem o recebimento manualmente.', 'Envie seu nome e seu recado aos noivos pelo WhatsApp. Os noivos conferem o recebimento manualmente.');
  html = html.replace('<a href="/admin">Área dos noivos ↗</a>', '');
  await writeFile(filename, html);
  for (const name of ['admin.html', 'admin.css', 'admin.js', '_redirects']) await rm(path.join(output, name), { force: true });
  await writeFile(path.join(output, 'LEIA-ME.txt'), 'Extraia o ZIP e envie a pasta inteira que contém index.html para Deploys no Netlify. Fotos, presentes e Pix funcionam neste pacote; a confirmação é pelo WhatsApp. Para usar formulário e painel, publique o projeto completo pela ferramenta do Netlify ou pelo GitHub, conforme o README.');
}
console.log(`Pronto: dist/index.html, fotografias, estilos e catálogo com Pix. Modo: ${process.argv.includes('--static') ? 'envio direto, confirmação por WhatsApp' : 'projeto completo, Functions'}.`);
