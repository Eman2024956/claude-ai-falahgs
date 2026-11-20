// Front-end for the WhatsApp Blueticks selection UI.
const $ = (id) => document.getElementById(id);
const state = {
  items: [],              // all loaded chats/contacts
  selected: new Map(),    // id -> item
};

// ---------- utils ----------
const digits = (s = '') => String(s).replace(/\D/g, '');
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function toast(msg, ms = 2800) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms);
}
async function api(url, opts = {}) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}
async function busy(btn, fn) {
  const label = btn.textContent; btn.disabled = true; btn.textContent = 'Working…';
  try { return await fn(); } catch (e) { toast('Error: ' + e.message, 5000); console.error(e); }
  finally { btn.disabled = false; btn.textContent = label; }
}
const dateToIso = (d, endOfDay = false) => (d ? new Date(d + (endOfDay ? 'T23:59:59' : 'T00:00:00')).toISOString() : undefined);
function download(name, text, type = 'text/csv') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}

// ---------- status ----------
api('/api/status')
  .then((s) => { $('status').textContent = `Connected · ${s.tools.length} MCP tools`; $('status').className = 'status ok'; })
  .catch((e) => { $('status').textContent = 'Not connected: ' + e.message; $('status').className = 'status err'; });

// ---------- loading ----------
function mergeItems(newItems) {
  const map = new Map(state.items.map((i) => [i.id, i]));
  for (const it of newItems) map.set(it.id, { ...map.get(it.id), ...it });
  state.items = [...map.values()];
  buildPrefixList();
  render();
}

$('loadBtn').onclick = (e) => busy(e.target, async () => {
  const source = $('source').value;
  const params = new URLSearchParams({ kind: $('kind').value, max: $('max').value });
  if ($('archived').checked) params.set('archived', '1');
  if ($('since').value) params.set('since', dateToIso($('since').value));
  const data = source === 'contacts'
    ? await api('/api/contacts?' + params)
    : await api('/api/chats?' + params);
  state.items = [];
  mergeItems(data.chats || data.contacts || []);
  toast(`Loaded ${state.items.length} ${source}`);
});

$('addManualBtn').onclick = (e) => busy(e.target, async () => {
  const data = await api('/api/resolve-numbers', { method: 'POST', body: JSON.stringify({ numbers: $('manualNumbers').value }) });
  mergeItems(data.chats);
  data.chats.forEach((c) => state.selected.set(c.id, c));
  $('manualNumbers').value = '';
  render();
  toast(`Added & selected ${data.count} number(s)`);
});

// Top country-code prefixes found in the loaded list (1–3 digits)
function buildPrefixList() {
  const counts = {};
  for (const i of state.items) {
    const d = digits(i.phone);
    if (!d) continue;
    for (const len of [1, 2, 3]) counts[d.slice(0, len)] = (counts[d.slice(0, len)] || 0) + 1;
  }
  $('prefixes').innerHTML = Object.entries(counts)
    .filter(([p]) => p.length >= 2).sort((a, b) => b[1] - a[1]).slice(0, 15)
    .map(([p, n]) => `<option value="${p}">+${p} (${n})</option>`).join('');
}

// ---------- filtering ----------
function visibleItems() {
  const q = $('q').value.trim().toLowerCase();
  const qd = digits(q);
  const prefix = digits($('prefix').value);
  let rx = null;
  try { rx = $('regex').value ? new RegExp($('regex').value) : null; $('regex').style.borderColor = ''; }
  catch { $('regex').style.borderColor = 'var(--red)'; }
  const kind = $('kind').value;

  return state.items.filter((i) => {
    if (kind !== 'all' && i.kind !== kind && !i.manual) return false;
    if (q && !(i.name?.toLowerCase().includes(q) || (qd && digits(i.phone).includes(qd)) || i.id.includes(q))) return false;
    if (prefix && !digits(i.phone).startsWith(prefix)) return false;
    if (rx && !rx.test(i.phone || i.id)) return false;
    if ($('onlyUnread').checked && !(i.unread > 0)) return false;
    if ($('onlySelected').checked && !state.selected.has(i.id)) return false;
    return true;
  });
}

// ---------- rendering ----------
function render() {
  const vis = visibleItems();
  const list = $('list');
  if (!vis.length) {
    list.innerHTML = `<li class="empty">${state.items.length ? 'No numbers match the filters.' : 'Click “Load from WhatsApp” to start.'}</li>`;
  } else {
    list.innerHTML = vis.slice(0, 2000).map((i) => `
      <li data-id="${esc(i.id)}" class="${state.selected.has(i.id) ? 'sel' : ''}">
        <input type="checkbox" ${state.selected.has(i.id) ? 'checked' : ''} tabindex="-1" />
        <div class="avatar">${esc((i.name || '?').trim().charAt(0).toUpperCase() || '#')}</div>
        <div class="who">
          <b>${esc(i.name)}</b>
          <span>${esc(i.phone || i.id)}${i.lastMessage ? ' · ' + esc(i.lastMessage.slice(0, 60)) : ''}</span>
        </div>
        ${i.unread ? `<span class="badge">${i.unread}</span>` : ''}
      </li>`).join('');
  }
  const allSel = vis.length > 0 && vis.every((i) => state.selected.has(i.id));
  $('selectAll').checked = allSel;
  $('counts').textContent = `${vis.length} shown · ${state.selected.size} selected`;
  renderChips();
}

function renderChips() {
  const chips = $('chips');
  if (!state.selected.size) { chips.innerHTML = '<span class="muted">Nothing selected yet.</span>'; return; }
  chips.innerHTML = [...state.selected.values()].map((i) =>
    `<span class="chip">${esc(i.phone || i.name)} <button data-rm="${esc(i.id)}" title="Remove">✕</button></span>`).join('');
}

$('list').onclick = (e) => {
  const li = e.target.closest('li[data-id]');
  if (!li) return;
  const id = li.dataset.id;
  if (state.selected.has(id)) state.selected.delete(id);
  else state.selected.set(id, state.items.find((i) => i.id === id));
  render();
};
$('chips').onclick = (e) => { const id = e.target.dataset.rm; if (id) { state.selected.delete(id); render(); } };
$('selectAll').onchange = (e) => {
  for (const i of visibleItems()) e.target.checked ? state.selected.set(i.id, i) : state.selected.delete(i.id);
  render();
};
['q', 'prefix', 'regex'].forEach((id) => $(id).addEventListener('input', render));
['onlyUnread', 'onlySelected', 'kind'].forEach((id) => $(id).addEventListener('change', render));

// ---------- selection actions ----------
const selectedList = () => [...state.selected.values()];
function requireSelection() { if (!state.selected.size) { toast('Select at least one number first'); return false; } return true; }

$('copyBtn').onclick = async () => {
  if (!requireSelection()) return;
  await navigator.clipboard.writeText(selectedList().map((i) => i.phone || i.id).join('\n'));
  toast(`Copied ${state.selected.size} number(s)`);
};
$('csvBtn').onclick = () => {
  if (!requireSelection()) return;
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['name', 'phone', 'chat_id', 'kind'].join(',')]
    .concat(selectedList().map((i) => [i.name, i.phone, i.id, i.kind].map(cell).join(',')));
  download('selected_numbers.csv', '﻿' + rows.join('\n'));
};
$('clearBtn').onclick = () => { state.selected.clear(); render(); };

// ---------- preview ----------
$('previewBtn').onclick = (e) => {
  if (!requireSelection()) return;
  busy(e.target, async () => {
    const sel = selectedList();
    const data = await api('/api/messages', {
      method: 'POST',
      body: JSON.stringify({
        chatIds: sel.map((i) => i.id),
        since: dateToIso($('msgSince').value),
        until: dateToIso($('msgUntil').value, true),
        limit: Number($('msgLimit').value) || 50,
      }),
    });
    $('preview').innerHTML = sel.map((c) => {
      const msgs = (data[c.id]?.messages || []).slice().sort((a, b) => (a.time < b.time ? -1 : 1));
      return `<div class="chat"><b>${esc(c.name)}</b> <span class="muted">${esc(c.phone || c.id)} · ${msgs.length} msg</span>
        ${msgs.map((m) => `<div class="msg ${m.fromMe ? 'me' : ''}"><time>${esc(new Date(m.time).toLocaleString())}</time>
          ${esc(m.fromMe ? 'Me' : (m.sender || c.name))}: ${esc(m.text || `[${m.type}${m.filename ? ': ' + m.filename : ''}]`)}</div>`).join('')
          || '<div class="muted">No messages in this range.</div>'}</div>`;
    }).join('');
  });
};

// ---------- export zip ----------
$('exportBtn').onclick = (e) => {
  if (!requireSelection()) return;
  busy(e.target, async () => {
    const res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chats: selectedList(),
        since: dateToIso($('msgSince').value),
        until: dateToIso($('msgUntil').value, true),
        limit: Number($('msgLimit').value) || 200,
        includeMedia: $('includeMedia').checked,
        maxMediaPerChat: Number($('maxMedia').value) || 20,
      }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    const blob = await res.blob();
    const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'whatsapp-export.zip';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href);
    toast(`ZIP ready: ${name}`);
  });
};

// ---------- send ----------
$('sendBtn').onclick = (e) => {
  if (!requireSelection()) return;
  const text = $('sendText').value.trim();
  if (!text) return toast('Write a message first');
  const n = state.selected.size;
  if (!confirm(`Send this message NOW to ${n} chat(s)?\n\n${text}`)) return;
  busy(e.target, async () => {
    $('log').textContent = `Sending to ${n} chat(s)…\n`;
    const data = await api('/api/send', {
      method: 'POST',
      body: JSON.stringify({ recipients: selectedList(), text, delayMs: (Number($('delay').value) || 3) * 1000 }),
    });
    $('log').textContent += data.results.map((r) => `${r.ok ? '✔' : '✖'} ${r.id}${r.ok ? '' : ' — ' + r.error}`).join('\n');
    $('log').textContent += `\n\nDone: ${data.sent} sent, ${data.failed} failed.`;
  });
};
