const $ = selector => document.querySelector(selector);
const staticDeployment = document.querySelector('meta[name="site-mode"]')?.content === 'static';
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
  if (staticDeployment) throw new Error('Para confirmar sua presença, fale com os noivos pelo WhatsApp.');
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

let invitation = null;
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
