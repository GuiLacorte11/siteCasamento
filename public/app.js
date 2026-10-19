const $ = selector => document.querySelector(selector);
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = value => Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const staticDeployment = document.querySelector('meta[name="site-mode"]')?.content === 'static';
const originalGiftNote = $('#gift-dialog .dialog-note').textContent;
if (staticDeployment) {
  $('#find-guest').hidden = true;
  $('.demo-note').hidden = true;
  $('#form-confirmacao > .eyebrow').textContent = 'CONFIRME COM OS NOIVOS';
  const contact = document.createElement('a');
  contact.className = 'button cream';
  contact.href = 'https://wa.me/5531991470557?text=' + encodeURIComponent('Olá! Quero confirmar minha presença no casamento de Evelin e Guilherme.');
  contact.target = '_blank'; contact.rel = 'noopener noreferrer';
  contact.textContent = 'Confirmar pelo WhatsApp ↗';
  $('#find-guest').before(contact);
}
async function api(url, data) {
  if (staticDeployment) {
    if (data !== undefined) throw new Error('Para enviar sua resposta ou um recado, fale com os noivos pelo WhatsApp.');
    const pixId = url.match(/^\/api\/gifts\/(\d+)\/pix$/)?.[1];
    const filename = url === '/api/gifts' ? '/static-data/gifts.json' : pixId ? `/static-data/pix-${pixId}.json` : null;
    if (!filename) throw new Error('Esta opção ainda não está disponível. Fale com os noivos pelo WhatsApp.');
    const response = await fetch(filename);
    if (!response.ok) throw new Error('Não foi possível abrir o presente. Atualize a página e tente novamente.');
    return response.json();
  }
  const response = await fetch(url, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Esta opção ainda não está disponível. Fale com os noivos pelo WhatsApp.');
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Não foi possível concluir. Tente novamente.');
  return result;
}
function feedback(selector, message, isError = false) { const node = $(selector); node.textContent = message; node.classList.toggle('error', isError); }
async function busy(button, fn) { button.disabled = true; try { await fn(); } finally { button.disabled = false; } }

$('.menu-button').addEventListener('click', event => { const open = $('#menu').classList.toggle('open'); event.currentTarget.setAttribute('aria-expanded', String(open)); event.currentTarget.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu'); });
$('#menu').addEventListener('click', e => { if (e.target.closest('a')) { $('#menu').classList.remove('open'); $('.menu-button').setAttribute('aria-expanded', 'false'); $('.menu-button').setAttribute('aria-label', 'Abrir menu'); } });

function countdown() {
  let total = Math.max(0, Math.floor((new Date('2027-09-05T15:30:00-03:00') - Date.now()) / 1000));
  const days = Math.floor(total / 86400); total %= 86400;
  const hours = Math.floor(total / 3600); total %= 3600;
  const minutes = Math.floor(total / 60), seconds = total % 60;
  for (const [id, value] of Object.entries({ days, hours, minutes, seconds })) $('#' + id).textContent = String(value).padStart(2, '0');
  $('#countdown-message').hidden = days + hours + minutes + seconds > 0;
}
countdown(); setInterval(countdown, 1000);
if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  document.documentElement.classList.add('js-reveal');
  const observer = new IntersectionObserver(entries => entries.forEach(entry => { if (entry.isIntersecting) { entry.target.classList.add('shown'); observer.unobserve(entry.target); } }), { threshold: .08 });
  document.querySelectorAll('.reveal').forEach(node => observer.observe(node));
}

const categoryLabels = { casa: 'PARA O NOSSO LAR', experiencias: 'PARA VIVER JUNTOS', simbolicos: 'PARA SORRIR JUNTOS' };
const drawings = {
  coffee: '<path d="M28 45h43v22c0 14-43 14-43 0zM71 47h7c15 0 15 19-7 19M20 82h61M42 20c-7 8 7 10 0 18M56 15c-7 8 7 11 0 19"/><ellipse cx="49.5" cy="45" rx="21.5" ry="4"/>',
  glasses: '<path d="M21 20h25l-2 23c-1 14-19 14-21 0zM33 55v24M21 79h24M57 24h25l-2 23c-1 14-19 14-21 0zM69 59v24M57 83h24M24 35h19M60 39h19M48 18l4-6M52 24l6-2"/>',
  bed: '<path d="M14 44h73v38H14zM22 23h57v21M21 82v7M80 82v7M14 65h73M21 33h24v15H21zM53 33h24v15H53zM14 55c15-7 59-7 73 0"/>',
  dinner: '<circle cx="51" cy="51" r="26"/><circle cx="51" cy="51" r="21"/><path d="M12 25v17c0 8 10 8 10 0V25M17 25v59M89 25c-9 7-10 28 0 28v31M49 12v4M48 87v4"/>',
  pan: '<path d="M24 43h53v22c0 19-53 19-53 0zM18 42h65M24 48h-8c-10 0-10 13 8 13M77 48h7c10 0 10 13-7 13M26 36c8-11 42-11 50 0M44 25v-6h12v6M39 13v-3M66 22v-5"/>',
  appliance: '<rect x="25" y="24" width="51" height="58" rx="11"/><path d="M25 52h51M39 37h23M45 63h13v7H45zM31 82v4M69 82v4M40 24v-8h22v8"/><circle cx="38" cy="43" r="2"/><circle cx="63" cy="43" r="2"/>',
  travel: '<rect x="25" y="28" width="50" height="49" rx="5"/><path d="M40 28v-9h20v9M25 42h50M34 28v49M66 28v49M34 77v7M66 77v7M11 34l5-5M82 24l6-4M81 34l8 1M14 57h5"/><path d="M44 48h12v11H44z"/>',
};
function illustration(icon) { return `<svg viewBox="0 0 100 100" aria-hidden="true">${drawings[icon] || drawings.dinner}</svg>`; }
let gifts = [], category = 'all', visible = 6, activeGift = null, invitation = null, dialogGeneration = 0, requestId;
function physicalGift(gift) { return Boolean(gift.physical_enabled ?? (gift.category === 'casa')); }
function productURL(gift) {
  try { const url = new URL(gift.product_url); if (url.protocol === 'https:' && !url.username && !url.password) return url.href; } catch {}
  return null;
}
function setGiftMethod(method) {
  const product = method === 'product' && physicalGift(activeGift);
  $('#gift-pix-panel').hidden = product; $('#gift-product-panel').hidden = !product;
  $('#gift-dialog-amount').hidden = product; $('#gift-feedback').hidden = product;
  document.querySelectorAll('[data-gift-method]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.giftMethod === (product ? 'product' : 'pix'))));
}
$('#gift-methods').addEventListener('click', event => { const button = event.target.closest('[data-gift-method]'); if (button && activeGift) setGiftMethod(button.dataset.giftMethod); });
function renderGifts() {
  let selected = gifts.filter(g => category === 'all' || g.category === category);
  const sort = $('#gift-sort').value;
  if (sort !== 'default') selected = [...selected].sort((a,b) => sort === 'asc' ? a.amount - b.amount : b.amount - a.amount);
  $('#gift-grid').innerHTML = selected.slice(0, visible).map(g => `<article class="gift-card"><div class="gift-illustration">${illustration(g.icon)}<small>${categoryLabels[g.category]}</small></div><h3>${escapeHTML(g.name)}</h3><p class="gift-description">${escapeHTML(g.description)}</p><p class="gift-ways">${physicalGift(g) ? 'Pix ou produto' : 'Contribuição por Pix'}</p><div class="gift-card-bottom"><div><span class="gift-price-label">Pix sugerido</span><p class="gift-price">${money(g.amount)}</p></div><button type="button" data-gift="${g.id}" aria-label="Presentear: ${escapeHTML(g.name)}">Escolher <span>↗</span></button></div></article>`).join('') || '<p>Nenhum presente nesta categoria.</p>';
  $('#more-gifts').hidden = selected.length <= visible;
}
async function loadGifts() { try { gifts = (await api('/api/gifts')).gifts; renderGifts(); } catch(e) { $('#gift-grid').textContent = e.message + ' Atualize a página para tentar novamente.'; } }
loadGifts();
$('.filters').addEventListener('click', event => { const button = event.target.closest('[data-category]'); if (!button) return; category = button.dataset.category; visible = 6; document.querySelectorAll('.filter').forEach(b => { b.classList.toggle('active', b === button); b.setAttribute('aria-pressed', String(b === button)); }); renderGifts(); });
$('#gift-sort').addEventListener('change', () => { visible = 6; renderGifts(); });
$('#more-gifts').addEventListener('click', () => { visible += 6; renderGifts(); });
$('#gift-grid').addEventListener('click', async event => {
  const button = event.target.closest('[data-gift]'); if (!button) return;
  activeGift = gifts.find(g => g.id === Number(button.dataset.gift));
  const generation = ++dialogGeneration;
  $('#gift-dialog-title').textContent = activeGift.name;
  $('#gift-dialog-amount').textContent = 'Pix sugerido: ' + money(activeGift.amount);
  $('#gift-methods').hidden = !physicalGift(activeGift);
  const storeURL = productURL(activeGift);
  $('#gift-product-link').href = storeURL || 'https://www.amazon.com.br/s?k=' + encodeURIComponent(activeGift.name);
  $('#gift-product-link').textContent = storeURL ? 'Ver produto na loja ↗' : 'Ver opções na Amazon ↗';
  $('#gift-product-description').textContent = storeURL ? 'Confira o modelo e o preço diretamente na loja. A compra é feita por lá.' : 'Veja opções deste item na Amazon. O modelo ainda não foi definido; confira os detalhes com os noivos.';
  $('#gift-delivery-link').href = 'https://wa.me/5531991470557?text=' + encodeURIComponent('Olá! Gostaria de presentear vocês com o produto ' + activeGift.name + '. Podemos combinar o modelo e a entrega?');
  setGiftMethod('pix');
  $('#gift-message-form').reset(); $('#gift-message-form').hidden = false; $('#gift-message-form button').disabled = true;
  $('#gift-dialog .dialog-note').textContent = originalGiftNote;
  $('#pix-qr').hidden = true; $('#pix-payload').value = ''; $('#copy-pix').disabled = true; $('#copy-key').disabled = true;
  feedback('#gift-feedback', 'Preparando seu Pix…'); requestId = crypto.randomUUID(); $('#gift-dialog').showModal();
  try {
    const pix = await api(`/api/gifts/${activeGift.id}/pix`);
    if (generation !== dialogGeneration || !$('#gift-dialog').open) return;
    activeGift.amount = pix.amount; $('#gift-dialog-amount').textContent = 'Pix sugerido: ' + money(pix.amount);
    $('#pix-qr').src = pix.qr; $('#pix-qr').hidden = false; $('#pix-payload').value = pix.payload;
    $('#copy-pix').disabled = false; $('#copy-key').disabled = false; $('#copy-key').dataset.key = pix.key;
    $('#gift-message-form button').disabled = false; feedback('#gift-feedback', '');
    if (pix.registrationAvailable === false) {
      $('#gift-message-form').hidden = true;
      $('#gift-dialog .dialog-note').textContent = 'Para enviar um recado aos noivos após seu Pix, use o contato pelo WhatsApp no final do site.';
    }
  } catch(e) { if (generation === dialogGeneration) feedback('#gift-feedback', e.message, true); }
});
$('.dialog-close').addEventListener('click', () => $('#gift-dialog').close());
$('#gift-dialog').addEventListener('click', event => { if (event.target === $('#gift-dialog')) { const rect = event.target.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close(); } });
async function copy(value, button) {
  try { await navigator.clipboard.writeText(value); feedback('#gift-feedback', 'Copiado! Cole no aplicativo do seu banco.'); }
  catch { $('#pix-payload').value = value; $('#pix-payload').focus(); $('#pix-payload').select(); feedback('#gift-feedback', 'Selecione e copie o código mostrado acima.'); }
}
$('#copy-pix').addEventListener('click', e => copy($('#pix-payload').value, e.currentTarget));
$('#copy-key').addEventListener('click', e => copy(e.currentTarget.dataset.key, e.currentTarget));
$('#gift-message-form').addEventListener('submit', async event => {
  event.preventDefault();
  await busy(event.submitter, async () => {
    try { await api('/api/contributions', { giftId: activeGift.id, amount: activeGift.amount, sender: $('#gift-sender').value, message: $('#gift-message').value, requestId }); $('#gift-message-form').hidden = true; feedback('#gift-feedback', 'Seu carinho foi registrado. Obrigado! O recebimento ficará aguardando a conferência dos noivos.'); }
    catch(e) { feedback('#gift-feedback', e.message, true); }
  });
});
$('#find-guest').addEventListener('submit', async event => {
  event.preventDefault(); feedback('#rsvp-feedback', 'Procurando seu convite…');
  await busy(event.submitter, async () => {
    try {
      invitation = await api('/api/rsvp/find', { name: $('#guest-name').value });
      $('#found-name').textContent = `Olá, ${invitation.name.split(' ')[0]}!`;
      $('#respond-guest').reset();
      $('#companions').innerHTML = Array.from({ length: invitation.maxCompanions + 1 }, (_,i) => `<option value="${i}">${i === 0 ? 'Somente eu' : `${i} acompanhante${i > 1 ? 's' : ''}`}</option>`).join('');
      $('#companions').value = invitation.companions;
      const previous = $(`input[name="attendance"][value="${invitation.status}"]`); if (previous) previous.checked = true;
      $('#companion-field').hidden = invitation.status === 'declined' || invitation.maxCompanions === 0;
      $('#find-guest').hidden = true; $('#respond-guest').hidden = false;
      feedback('#rsvp-feedback', invitation.status === 'pending' ? '' : 'Você já respondeu ao convite. Pode atualizar sua resposta abaixo.');
      $('#found-name').setAttribute('tabindex', '-1'); $('#found-name').focus();
    } catch(e) { feedback('#rsvp-feedback', e.message, true); }
  });
});
$('#respond-guest').addEventListener('change', e => { if (e.target.name === 'attendance') $('#companion-field').hidden = e.target.value === 'declined' || invitation.maxCompanions === 0; });
$('.change-guest').addEventListener('click', () => { $('#find-guest').hidden = false; $('#respond-guest').hidden = true; invitation = null; feedback('#rsvp-feedback', ''); $('#guest-name').focus(); });
$('#respond-guest').addEventListener('submit', async event => {
  event.preventDefault();
  await busy(event.submitter, async () => {
    try {
      const result = await api('/api/rsvp/respond', { token: invitation.token, status: $('input[name="attendance"]:checked').value, companions: Number($('#companions').value), message: $('#rsvp-message').value });
      $('#respond-guest').hidden = true; $('#find-guest').hidden = false;
      feedback('#rsvp-feedback', result.status === 'confirmed' ? `Presença confirmada! Estamos felizes em celebrar com você${result.companions ? ` e ${result.companions} acompanhante${result.companions > 1 ? 's' : ''}` : ''}. Até a nossa mesa!` : 'Obrigado por nos avisar. Você faz parte da nossa história, mesmo de longe.');
    } catch(e) { feedback('#rsvp-feedback', e.message, true); }
  });
});
