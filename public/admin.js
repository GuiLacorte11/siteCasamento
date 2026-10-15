const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const statuses = { pending: 'Pendente', confirmed: 'Confirmado', declined: 'Não poderá ir' };
const categories = { casa: 'Nosso lar', experiencias: 'Experiências', simbolicos: 'Com um sorriso' };
let state, editing;
async function api(url, data) {
  const response = await fetch(url, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('O painel precisa das funções do Netlify. Consulte as instruções do pacote completo para habilitá-lo.');
  const result = await response.json();
  if (!response.ok) { const error = new Error(result.error || 'Não foi possível concluir.'); error.status = response.status; throw error; }
  return result;
}
function feedback(selector, message, isError = false) { $(selector).textContent = message; $(selector).classList.toggle('error', isError); }
function loginView() { $('#dashboard').hidden = true; $('#logout').hidden = true; $('#login-section').hidden = false; }
function renderGuests() {
  const query = $('#admin-search').value.toLocaleLowerCase('pt-BR'), status = $('#guest-status').value;
  const rows = state.guests.filter(g => g.name.toLocaleLowerCase('pt-BR').includes(query) && (status === 'all' || g.status === status));
  $('#guest-rows').innerHTML = rows.map(g => `<tr><td>${esc(g.name)}</td><td><span class="badge ${g.status}">${statuses[g.status]}</span></td><td>${g.companions} confirmados / ${g.max_companions} autorizados</td><td>${esc(g.message || '—')}</td><td><div class="row-actions"><button data-edit-guest="${g.id}">Editar</button><button class="delete-button" data-delete-guest="${g.id}">Excluir</button></div></td></tr>`).join('') || '<tr><td colspan="5" class="empty-row">Nenhum convidado encontrado.</td></tr>';
}
function render() {
  const confirmed = state.guests.filter(g => g.status === 'confirmed'), declined = state.guests.filter(g => g.status === 'declined'), pending = state.guests.filter(g => g.status === 'pending');
  const seats = state.guests.reduce((sum,g) => sum + 1 + g.max_companions, 0), people = confirmed.reduce((sum,g) => sum + 1 + g.companions, 0);
  const paid = state.contributions.filter(g => g.status === 'confirmed').reduce((sum,g) => sum + g.amount, 0);
  const metrics = [['Convites cadastrados', state.guests.length, `${seats} pessoas convidadas`], ['Presenças confirmadas', people, `${confirmed.length} convites respondidos`], ['Ainda não responderam', pending.length, 'convites pendentes'], ['Não poderão ir', declined.length, 'convites recusados'], ['Presentes conferidos', money(paid), `${state.contributions.filter(g => g.status === 'pending').length} registros aguardando conferência`]];
  $('#metrics').innerHTML = metrics.map(([title,value,note]) => `<div class="metric"><span>${title}</span><strong>${value}</strong><small>${note}</small></div>`).join('');
  renderGuests();
  $('#contribution-rows').innerHTML = state.contributions.map(g => `<tr><td>${esc(g.sender)}</td><td>${esc(g.gift_name)}<br><small>${new Date(g.created_at).toLocaleDateString('pt-BR')}</small></td><td>${money(g.amount)}</td><td>${esc(g.message || '—')}</td><td><span class="badge ${g.status}">${g.status === 'confirmed' ? 'Recebido' : 'A conferir'}</span><br><button data-contribution="${g.id}" data-status="${g.status === 'confirmed' ? 'pending' : 'confirmed'}">${g.status === 'confirmed' ? 'Voltar a pendente' : 'Confirmar recebimento'}</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty-row">Os registros de presentes aparecerão aqui. Nenhum pagamento é confirmado automaticamente.</td></tr>';
  $('#catalog-rows').innerHTML = state.gifts.map(g => `<tr><td>${esc(g.name)}</td><td>${categories[g.category]}</td><td>${money(g.amount)}</td><td><span class="badge ${g.active ? 'confirmed' : ''}">${g.active ? 'Visível' : 'Oculto'}</span></td><td><button data-edit-gift="${g.id}">Editar</button></td></tr>`).join('');
}
async function load() {
  try { state = await api('/api/admin/dashboard'); $('#login-section').hidden = true; $('#dashboard').hidden = false; $('#logout').hidden = false; render(); return true; }
  catch(e) { if (e.status === 401) loginView(); else feedback('#admin-feedback', e.message, true); return false; }
}
load();
$('#login-form').addEventListener('submit', async e => { e.preventDefault(); e.submitter.disabled = true; try { await api('/api/admin/login', { password: $('#admin-password').value }); $('#login-form').reset(); feedback('#login-feedback', ''); await load(); } catch(error) { feedback('#login-feedback', error.message, true); } finally { e.submitter.disabled = false; } });
$('#logout').addEventListener('click', async () => { try { await api('/api/admin/logout', {}); state = null; loginView(); } catch(e) { feedback('#admin-feedback', e.message, true); } });
$('#refresh').addEventListener('click', async () => { if (await load()) feedback('#admin-feedback', 'Painel atualizado.'); });
$('.admin-tabs').addEventListener('click', e => { const tab = e.target.closest('[data-panel]'); if (!tab) return; document.querySelectorAll('[data-panel]').forEach(node => { const selected = node === tab; node.classList.toggle('active', selected); node.setAttribute('aria-selected', String(selected)); $('#' + node.dataset.panel + '-panel').hidden = !selected; }); feedback('#admin-feedback', ''); });
$('.admin-tabs').addEventListener('keydown', e => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return; e.preventDefault(); const tabs = [...document.querySelectorAll('[data-panel]')], index = tabs.indexOf(document.activeElement); const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length; tabs[next].focus(); tabs[next].click(); });
$('#admin-search').addEventListener('input', renderGuests); $('#guest-status').addEventListener('change', renderGuests);
function openGuest(g = { name: '', max_companions: 0, status: 'pending', companions: 0 }) {
  editing = { kind: 'guest', id: g.id }; $('#edit-title').textContent = g.id ? 'Editar convidado' : 'Novo convidado';
  $('#edit-form').innerHTML = `<label for="edit-name">Nome completo</label><input id="edit-name" name="name" value="${esc(g.name)}" required maxlength="120"><label for="edit-max">Acompanhantes autorizados</label><input id="edit-max" name="max" type="number" min="0" max="20" value="${g.max_companions}" required><label for="edit-status">Resposta</label><select id="edit-status" name="status">${Object.entries(statuses).map(([key,label]) => `<option value="${key}" ${g.status === key ? 'selected' : ''}>${label}</option>`).join('')}</select><label for="edit-companions">Acompanhantes confirmados</label><input id="edit-companions" name="companions" type="number" min="0" max="${g.max_companions}" value="${g.companions}" required><button class="button wine" type="submit">Salvar convidado ↗</button>`;
  feedback('#edit-feedback', ''); $('#edit-dialog').showModal();
}
function openGift(g = { name: '', description: '', amount: 50, category: 'casa', active: 1 }) {
  editing = { kind: 'gift', id: g.id }; $('#edit-title').textContent = g.id ? 'Editar presente' : 'Novo presente';
  $('#edit-form').innerHTML = `<label for="edit-name">Nome do presente</label><input id="edit-name" name="name" value="${esc(g.name)}" maxlength="120" required><label for="edit-description">Descrição</label><textarea id="edit-description" name="description" maxlength="300" rows="3" required>${esc(g.description)}</textarea><label for="edit-amount">Valor em reais</label><input id="edit-amount" name="amount" type="number" min="1" max="100000" step="0.01" value="${g.amount}" required><label for="edit-category">Categoria</label><select id="edit-category" name="category">${Object.entries(categories).map(([key,label]) => `<option value="${key}" ${g.category === key ? 'selected' : ''}>${label}</option>`).join('')}</select><label class="check-label"><input name="active" type="checkbox" ${g.active ? 'checked' : ''}> Mostrar na lista de presentes</label><button class="button wine" type="submit">Salvar presente ↗</button>`;
  feedback('#edit-feedback', ''); $('#edit-dialog').showModal();
}
$('#new-guest').addEventListener('click', () => openGuest()); $('#new-gift').addEventListener('click', () => openGift()); $('.dialog-close').addEventListener('click', () => $('#edit-dialog').close());
$('#edit-form').addEventListener('change', e => { if (editing.kind === 'guest') { if (e.target.name === 'max') $('#edit-companions').max = e.target.value; if (e.target.name === 'status' && e.target.value !== 'confirmed') $('#edit-companions').value = 0; } });
$('#edit-form').addEventListener('submit', async e => {
  e.preventDefault(); e.submitter.disabled = true; const input = new FormData(e.currentTarget);
  try {
    const data = editing.kind === 'guest' ? { id: editing.id, name: input.get('name'), max_companions: Number(input.get('max')), status: input.get('status'), companions: Number(input.get('companions')) } : { id: editing.id, name: input.get('name'), description: input.get('description'), amount: Number(input.get('amount')), category: input.get('category'), active: input.get('active') === 'on' };
    await api(editing.kind === 'guest' ? '/api/admin/guests' : '/api/admin/gifts', data); $('#edit-dialog').close(); await load(); feedback('#admin-feedback', 'Alterações salvas.');
  } catch(error) { feedback('#edit-feedback', error.message, true); } finally { e.submitter.disabled = false; }
});
$('#dashboard').addEventListener('click', async e => {
  const editGuest = e.target.closest('[data-edit-guest]'), editGift = e.target.closest('[data-edit-gift]'), remove = e.target.closest('[data-delete-guest]'), contribution = e.target.closest('[data-contribution]');
  if (editGuest) return openGuest(state.guests.find(g => g.id === Number(editGuest.dataset.editGuest)));
  if (editGift) return openGift(state.gifts.find(g => g.id === Number(editGift.dataset.editGift)));
  if (remove) {
    const guest = state.guests.find(g => g.id === Number(remove.dataset.deleteGuest));
    if (!confirm(`Excluir o convite de ${guest.name}? A resposta também será removida.`)) return;
    try { await api('/api/admin/guests/delete', { id: guest.id }); await load(); feedback('#admin-feedback', 'Convidado removido.'); } catch(error) { feedback('#admin-feedback', error.message, true); }
  }
  if (contribution) {
    if (contribution.dataset.status === 'confirmed' && !confirm('Você conferiu o recebimento deste valor no banco?')) return;
    contribution.disabled = true;
    try { await api('/api/admin/contributions', { id: Number(contribution.dataset.contribution), status: contribution.dataset.status }); await load(); feedback('#admin-feedback', 'Conferência atualizada.'); } catch(error) { feedback('#admin-feedback', error.message, true); contribution.disabled = false; }
  }
});
$('#password-form').addEventListener('submit', async e => {
  e.preventDefault();
  if ($('#new-password').value !== $('#repeat-password').value) return feedback('#admin-feedback', 'As senhas precisam ser iguais.', true);
  e.submitter.disabled = true;
  try { await api('/api/admin/password', { password: $('#new-password').value }); $('#password-form').reset(); loginView(); feedback('#login-feedback', 'Senha atualizada. Entre com a nova senha.'); }
  catch(error) { feedback('#admin-feedback', error.message, true); } finally { e.submitter.disabled = false; }
});
