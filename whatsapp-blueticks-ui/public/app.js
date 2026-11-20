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

// ---------- status / mode ----------
let MODE = 'mcp';
api('/api/status')
  .then((s) => {
    MODE = s.mode || 'mcp';
    $('status').textContent = MODE === 'rest' ? `Blueticks REST API · ${new URL(s.server).host}` : `Connected · ${s.tools.length} MCP tools`;
    $('status').className = 'status ok';
    if (MODE === 'rest') applyRestMode();
    if (s.production) $('sourceLink').hidden = true;
  })
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
  if (typeof updateSendTab === 'function') updateSendTab();
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
        ${msgs.map((m) => `<div class="msg ${m.fromMe ? 'me' : ''}" dir="auto"><time>${esc(new Date(m.time).toLocaleString())}</time>
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

// =====================================================================
// SEND MESSAGE TAB — send text / media / poll to one, selected or all
// =====================================================================
const radio = (name) => document.querySelector(`input[name="${name}"]:checked`).value;
let media = null;            // { data_base64, mime_type, filename } from an uploaded file
let sendAbort = null;

// ----- tabs -----
function showTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tabpanel').forEach((p) => { p.hidden = p.id !== `tab-${name}`; });
  if (name === 'send') updateSendTab();
  if (name === 'history') loadHistory();
  try { localStorage.setItem('tab', name); } catch {}
}
document.querySelectorAll('.tab').forEach((t) => (t.onclick = () => showTab(t.dataset.tab)));
document.addEventListener('click', (e) => {
  const g = e.target.closest('[data-goto]');
  if (g) { e.preventDefault(); showTab(g.dataset.goto); }
});

// ----- recipients -----
function resolveOne() {
  const v = $('oneTo').value.trim();
  if (!v) return null;
  const lower = v.toLowerCase();
  // exact match on a loaded item (name, phone or id)
  const hit = state.items.find((i) => i.id === v || i.phone === v || i.name?.toLowerCase() === lower
    || (digits(v).length >= 6 && digits(i.phone) === digits(v)));
  if (hit) return hit;
  if (/@(c\.us|g\.us|newsletter)$/.test(v)) return { id: v, name: v, phone: '' };
  const d = digits(v);
  if (d.length >= 7 && d.length <= 15) return { id: `${d}@c.us`, name: `+${d}`, phone: `+${d}` };
  return null;
}

function getRecipients() {
  switch (radio('mode')) {
    case 'one': { const r = resolveOne(); return r ? [r] : []; }
    case 'selected': return selectedList();
    case 'visible': return visibleItems();
    case 'all': return [...state.items];
    default: return [];
  }
}

function updateSendTab() {
  $('tabSelCount').textContent = state.selected.size;
  $('cntSelected').textContent = state.selected.size;
  $('cntVisible').textContent = visibleItems().length;
  $('cntAll').textContent = state.items.length;

  $('oneList').innerHTML = state.items.slice(0, 500)
    .map((i) => `<option value="${esc(i.phone || i.id)}">${esc(i.name)}</option>`).join('');

  const mode = radio('mode');
  $('oneBox').hidden = mode !== 'one';
  const hints = {
    selected: 'Sends to every number you ticked in the Select & Export tab.',
    visible: 'Sends to every number that matches the current filters in the Select & Export tab.',
    all: 'Sends to EVERY loaded chat/contact. Double-check before sending.',
  };
  $('modeHint').hidden = mode === 'one';
  $('modeHint').textContent = hints[mode] || '';

  if (mode === 'one') {
    const r = resolveOne();
    $('oneResolved').textContent = r ? `→ ${r.name} (${r.id})` : ($('oneTo').value ? 'Not a valid number yet — include the country code.' : 'Type a number with its country code, or pick a loaded contact.');
  }

  const rec = getRecipients();
  $('recipCount').textContent = `${rec.length}`;
  $('recipChips').innerHTML = rec.length
    ? rec.slice(0, 60).map((r) => `<span class="chip">${esc(r.name && r.name !== r.phone ? `${r.name} · ${r.phone || r.id}` : r.phone || r.id)}</span>`).join('')
      + (rec.length > 60 ? `<span class="muted">+${rec.length - 60} more</span>` : '')
    : '<span class="muted">No recipients.</span>';
  const verb = $('dueDate')?.value ? 'Schedule for' : 'Send now to';
  $('sendNowBtn').textContent = rec.length === 1 ? `${verb} 1 chat` : `${verb} ${rec.length} chats`;
  updateBubble(rec[0]);
}

// ----- message type -----
function updateType() {
  const t = radio('mtype');
  document.querySelectorAll('[data-type]').forEach((el) => { el.hidden = !el.dataset.type.split(' ').includes(t); });
  $('textLabel').textContent = t === 'media' ? 'Caption (optional)' : 'Message text';
  updateBubble(getRecipients()[0]);
}
function updateMediaSrc() {
  const src = radio('msrc');
  $('fileBox').hidden = src !== 'file';
  $('urlBox').hidden = src !== 'url';
  updateBubble(getRecipients()[0]);
}

const fillTokens = (s, r) => String(s || '').replaceAll('{name}', r?.name || '{name}').replaceAll('{phone}', r?.phone || '{phone}');
function updateBubble(r) {
  const t = radio('mtype');
  const text = $('msgText').value;
  $('charCount').textContent = `${text.length} chars`;
  let html = '';
  if (t === 'text') html = esc(fillTokens(text, r)) || '<span class="muted">Write a message…</span>';
  if (t === 'media') {
    const name = radio('msrc') === 'file' ? (media?.filename || 'no file chosen') : ($('mediaUrl').value || 'no URL');
    html = `📎 <b>${esc(name)}</b>${text ? '\n' + esc(fillTokens(text, r)) : ''}`;
  }
  if (t === 'poll') {
    const opts = pollOptions();
    html = `📊 <b>${esc(fillTokens($('pollQ').value, r) || 'Question…')}</b>\n` + opts.map((o) => `○ ${esc(o)}`).join('\n')
      + ($('pollMulti').checked ? '\n<span class="muted">(multiple answers)</span>' : '');
  }
  $('bubble').innerHTML = html;
}

// ----- tokens -----
document.querySelectorAll('[data-token]').forEach((b) => (b.onclick = () => {
  const ta = $('msgText');
  const [a, z] = [ta.selectionStart, ta.selectionEnd];
  ta.value = ta.value.slice(0, a) + b.dataset.token + ta.value.slice(z);
  ta.focus(); ta.selectionStart = ta.selectionEnd = a + b.dataset.token.length;
  updateBubble(getRecipients()[0]);
}));

// ----- file upload -> base64 -----
$('mediaFile').onchange = () => {
  const f = $('mediaFile').files[0];
  media = null; $('filePreview').hidden = true;
  if (!f) { $('fileInfo').textContent = 'Max ~16 MB.'; return updateBubble(getRecipients()[0]); }
  if (f.size > 16 * 1024 * 1024) { toast('File is larger than 16 MB'); $('mediaFile').value = ''; return; }
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = String(reader.result);
    media = { data_base64: dataUrl.slice(dataUrl.indexOf(',') + 1), mime_type: f.type || 'application/octet-stream', filename: f.name };
    $('fileInfo').textContent = `${f.name} · ${(f.size / 1024).toFixed(0)} KB · ${media.mime_type}`;
    if (f.type.startsWith('image/')) { $('filePreview').src = dataUrl; $('filePreview').hidden = false; }
    updateBubble(getRecipients()[0]);
  };
  reader.readAsDataURL(f);
};

// ----- poll options -----
function addPollOption(value = '') {
  const n = $('pollOpts').children.length;
  if (n >= 12) return toast('WhatsApp polls allow at most 12 options');
  const row = document.createElement('div');
  row.className = 'pollopt';
  row.innerHTML = `<input type="text" placeholder="Option ${n + 1}" value="${esc(value)}" /><button class="btn mini" title="Remove">✕</button>`;
  row.querySelector('button').onclick = () => { row.remove(); updateBubble(getRecipients()[0]); };
  row.querySelector('input').oninput = () => updateBubble(getRecipients()[0]);
  $('pollOpts').appendChild(row);
}
const pollOptions = () => [...$('pollOpts').querySelectorAll('input')].map((i) => i.value.trim()).filter(Boolean);
$('addOpt').onclick = () => addPollOption();
addPollOption(); addPollOption();

// ----- wiring -----
document.querySelectorAll('input[name="mode"]').forEach((r) => (r.onchange = updateSendTab));
document.querySelectorAll('input[name="mtype"]').forEach((r) => (r.onchange = updateType));
document.querySelectorAll('input[name="msrc"]').forEach((r) => (r.onchange = updateMediaSrc));
$('oneTo').addEventListener('input', updateSendTab);
['msgText', 'pollQ', 'mediaUrl'].forEach((id) => $(id).addEventListener('input', () => updateBubble(getRecipients()[0])));
$('pollMulti').onchange = () => updateBubble(getRecipients()[0]);

// ----- build payload -----
function buildPayload(recipients) {
  const type = radio('mtype');
  const payload = { recipients, type, text: $('msgText').value, delayMs: (Number($('sendDelay').value) || 3) * 1000 };
  if (MODE === 'rest') {
    if ($('dueDate').value) {
      const due = new Date($('dueDate').value);
      if (due < new Date()) throw new Error('Schedule time is in the past');
      payload.dueDate = due.toISOString();
    }
    if ($('callbackUrl').value.trim()) payload.callbackUrl = $('callbackUrl').value.trim();
  }
  if (type === 'text' && !payload.text.trim()) throw new Error('Write a message first');
  if (type === 'media') {
    const kind = $('mediaKind').value || undefined;
    if (radio('msrc') === 'file') {
      if (!media) throw new Error('Choose a file to send');
      payload.media = { ...media, kind };
    } else {
      const url = $('mediaUrl').value.trim();
      if (!/^https:\/\//i.test(url)) throw new Error('Media URL must be a public https:// link');
      payload.media = { url, kind };
    }
  }
  if (type === 'poll') {
    const options = pollOptions();
    if (!$('pollQ').value.trim()) throw new Error('Write the poll question');
    if (options.length < 2) throw new Error('A poll needs at least 2 options');
    payload.poll = { question: $('pollQ').value.trim(), options, allow_multiple: $('pollMulti').checked };
  }
  return payload;
}

// ----- send (streams NDJSON progress) -----
$('sendNowBtn').onclick = async () => {
  const recipients = getRecipients();
  if (!recipients.length) return toast(radio('mode') === 'one' ? 'Enter a valid phone number' : 'No recipients — load/select numbers first');
  let payload;
  try { payload = buildPayload(recipients); } catch (e) { return toast(e.message); }

  const what = { text: 'text message', media: 'media message', poll: 'poll' }[payload.type];
  const secs = Math.round(((recipients.length - 1) * payload.delayMs) / 1000);
  const who = recipients.length === 1 ? (recipients[0].phone || recipients[0].id) : `${recipients.length} chats`;
  const when = payload.dueDate ? `at ${new Date(payload.dueDate).toLocaleString()}` : 'NOW';
  if (!confirm(`Send this ${what} ${when} to ${who}?${recipients.length > 1 ? `\nEstimated time: ~${secs}s` : ''}`)) return;

  const log = $('sendLog');
  log.textContent = '';
  $('progWrap').hidden = false; $('progBar').style.width = '0%';
  $('sendNowBtn').disabled = true; $('stopBtn').hidden = false;
  sendAbort = new AbortController();

  try {
    const res = await fetch('/api/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: sendAbort.signal,
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '', total = recipients.length, doneCount = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        const ev = JSON.parse(line);
        if (ev.event === 'start') { total = ev.total; log.textContent += `Sending ${ev.type} to ${ev.total} chat(s)…\n`; }
        if (ev.event === 'result') {
          doneCount++;
          const info = ev.ok && ev.data?.messageId ? ` — ${ev.data.status || 'queued'} · id ${ev.data.messageId}${ev.data.dueDate ? ' · due ' + new Date(ev.data.dueDate).toLocaleString() : ''}` : '';
          log.textContent += `${ev.ok ? '✔' : '✖'} ${ev.name ? ev.name + ' · ' : ''}${ev.id}${ev.ok ? info : ' — ' + ev.error}\n`;
          $('progBar').style.width = `${Math.round((doneCount / total) * 100)}%`;
          log.scrollTop = log.scrollHeight;
        }
        if (ev.event === 'done') {
          log.textContent += `\nDone: ${ev.sent} sent, ${ev.failed} failed${ev.stopped ? ' (stopped)' : ''}.`;
          toast(`Sent ${ev.sent}/${ev.total}`);
        }
      }
    }
  } catch (e) {
    log.textContent += e.name === 'AbortError' ? '\n■ Stopped by you. Messages already sent were not recalled.' : `\nError: ${e.message}`;
  } finally {
    $('sendNowBtn').disabled = false; $('stopBtn').hidden = true; sendAbort = null;
  }
};
$('stopBtn').onclick = () => sendAbort?.abort();

// ----- REST API mode: only what POST /messages supports -----
function applyRestMode() {
  $('restBanner').hidden = false;
  $('restOpts').hidden = false;
  // no polls
  const poll = document.querySelector('input[name="mtype"][value="poll"]');
  poll.closest('label').hidden = true;
  if (poll.checked) document.querySelector('input[name="mtype"][value="text"]').checked = true;
  // media from URL only
  const file = document.querySelector('input[name="msrc"][value="file"]');
  file.closest('label').hidden = true;
  document.querySelector('input[name="msrc"][value="url"]').checked = true;
  $('mediaKind').closest('label').hidden = true;
  $('mediaUrl').placeholder = 'https://example.com/photo.jpg (public link: image, video, PDF…)';
  // loading from WhatsApp is not available
  $('loadBtn').disabled = true;
  $('loadBtn').title = 'Needs the Blueticks MCP API (bt_live_ key)';
  document.querySelector('.manual').open = true;
  updateType(); updateMediaSrc(); updateSendTab();
}
$('dueDate').addEventListener('input', () => {
  const v = $('dueDate').value;
  $('sendNowBtn').dataset.when = v ? 'schedule' : '';
  updateSendTab();
});

// =====================================================================
// HISTORY TAB — every send + delivery reports (Blueticks callbackUrl)
// =====================================================================
let histRows = [];
function statusClass(s = '') {
  s = s.toLowerCase();
  if (/(sent|deliver|success|read|done|ok)/.test(s)) return 'ok';
  if (/(pend|queue|schedul|wait|process)/.test(s)) return 'wait';
  if (/(fail|error|declin|cancel|invalid)/.test(s)) return 'bad';
  return '';
}
async function loadHistory() {
  try {
    const data = await api('/api/history?limit=500&q=' + encodeURIComponent($('histQ').value.trim()));
    histRows = data.records;
    $('histNote').textContent = data.callbacks
      ? 'Delivery reports are on: Blueticks calls this server when a message is sent or fails, and the status updates here.'
      : 'Delivery reports are off. Set PUBLIC_URL and CALLBACK_SECRET in .env to get “sent / failed” updates from Blueticks. Until then the status stays “pending” as Blueticks returned it.';
    $('histBody').innerHTML = histRows.length ? histRows.map((r) => `
      <tr>
        <td>${esc(new Date(r.createdAt).toLocaleString())}${r.dueDate && new Date(r.dueDate) - new Date(r.createdAt) > 60000 ? `<br><span class="muted">due ${esc(new Date(r.dueDate).toLocaleString())}</span>` : ''}</td>
        <td>${r.name && r.name !== r.to ? `${esc(r.name)}<br><span class="muted">${esc(r.to)}</span>` : esc(r.to || '')}</td>
        <td class="msg" dir="auto">${esc((r.text || '').slice(0, 300))}${r.media ? `<br><span class="muted">📎 ${esc(r.media)}</span>` : ''}</td>
        <td><span class="st ${statusClass(r.status)}">${esc(r.status || '')}</span>${r.error ? `<br><span class="muted">${esc(String(r.error).slice(0, 200))}</span>` : ''}</td>
        <td>${r.callbackAt ? esc(new Date(r.callbackAt).toLocaleString()) : '<span class="muted">—</span>'}</td>
        <td><code>${esc(r.messageId || '')}</code></td>
      </tr>`).join('') : '<tr><td colspan="6" class="muted">No messages yet.</td></tr>';
  } catch (e) { $('histNote').textContent = 'Error: ' + e.message; }
}
$('histRefresh').onclick = loadHistory;
$('histQ').addEventListener('input', () => { clearTimeout(loadHistory._t); loadHistory._t = setTimeout(loadHistory, 300); });
$('histCsv').onclick = () => {
  if (!histRows.length) return toast('No history to export');
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const cols = ['createdAt', 'to', 'name', 'type', 'text', 'media', 'status', 'error', 'dueDate', 'callbackAt', 'messageId'];
  download('message_history.csv', '\uFEFF' + [cols.join(',')].concat(histRows.map((r) => cols.map((c) => cell(r[c])).join(','))).join('\n'));
};
setInterval(() => { if (!$('tab-history').hidden && $('histAuto').checked) loadHistory(); }, 10000);

// ----- init -----
updateType(); updateMediaSrc(); updateSendTab();
try { if (localStorage.getItem('tab') === 'send') showTab('send'); } catch {}
