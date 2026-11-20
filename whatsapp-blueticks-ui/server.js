// WhatsApp (Blueticks MCP) selection UI — Express backend.
import 'dotenv/config';
import express from 'express';
import archiver from 'archiver';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { callTool, listTools, explainError } from './src/mcpClient.js';
import {
  pickArray, normalizeChat, normalizeContact, normalizeMessage,
  chatIdFromPhone, phoneFromChatId, digits,
} from './src/normalize.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '25mb' })); // large enough for media uploads (base64)
app.use(express.static(path.join(__dirname, 'public')));

const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
  console.error(err);
  if (!res.headersSent) res.status(500).json({ error: explainError(err) });
  else res.end();
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_CHATS_PER_REQUEST = 25; // Blueticks list_messages batch limit

// ---------- status ----------
app.get('/api/status', wrap(async (_req, res) => {
  const tools = await listTools();
  let engine = null;
  try { engine = await callTool('engine', { action: 'status' }); } catch { /* optional */ }
  res.json({ connected: true, tools, engine });
}));

// ---------- chats (with server-side filters) ----------
// GET /api/chats?kind=contact|group|all&q=text&prefix=964&since=ISO&max=500&archived=1
app.get('/api/chats', wrap(async (req, res) => {
  const { kind = 'all', q = '', prefix = '', since = '', archived = '' } = req.query;
  const max = Math.min(Number(req.query.max) || 500, 3000);
  const pageSize = 100;
  const rows = [];

  for (let skip = 0; skip < max; skip += pageSize) {
    const args = {
      action: q ? 'search' : 'list',
      skip, limit: Math.min(pageSize, max - skip),
      include_last_message: true,
      include_archive: archived === '1',
    };
    if (q) args.query = q;
    if (kind === 'contact') args.kinds = ['contact'];
    if (kind === 'group') args.kinds = ['group'];
    if (since) args.since = since;
    const data = await callTool('chats_read', args);
    const page = pickArray(data, 'chats', 'items', 'results', 'data');
    rows.push(...page);
    const total = data?.total ?? data?.paging?.total;
    if (page.length < args.limit || (total != null && skip + page.length >= total)) break;
  }

  const p = digits(prefix);
  let chats = rows.map(normalizeChat).filter((c) => c.id);
  if (kind !== 'all') chats = chats.filter((c) => c.kind === kind);
  if (p) chats = chats.filter((c) => digits(c.phone).startsWith(p));
  res.json({ count: chats.length, chats });
}));

// ---------- contacts address book ----------
// GET /api/contacts?q=&max=1000
app.get('/api/contacts', wrap(async (req, res) => {
  const max = Math.min(Number(req.query.max) || 1000, 5000);
  const out = [];
  let cursor;
  do {
    const args = { action: 'list', limit: 200 };
    if (req.query.q) args.query = req.query.q;
    if (cursor) args.cursor = cursor;
    const data = await callTool('contacts', args);
    out.push(...pickArray(data, 'contacts', 'items', 'results', 'data'));
    cursor = data?.nextCursor || data?.next_cursor || data?.cursor || null;
  } while (cursor && out.length < max);
  const contacts = out.map(normalizeContact).filter((c) => c.id && c.kind === 'contact');
  res.json({ count: contacts.length, contacts });
}));

// ---------- resolve pasted phone numbers ----------
app.post('/api/resolve-numbers', wrap(async (req, res) => {
  const list = String(req.body.numbers || '').split(/[\s,;]+/).filter(Boolean);
  const seen = new Set();
  const chats = [];
  for (const n of list) {
    const id = chatIdFromPhone(n);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    chats.push({ id, name: phoneFromChatId(id), phone: phoneFromChatId(id), kind: 'contact', manual: true });
  }
  res.json({ count: chats.length, chats });
}));

// ---------- messages of the selected chats ----------
async function fetchMessages(chatIds, { since, until, limit = 50, query } = {}) {
  const result = {};
  for (let i = 0; i < chatIds.length; i += MAX_CHATS_PER_REQUEST) {
    const batch = chatIds.slice(i, i + MAX_CHATS_PER_REQUEST);
    const args = { action: 'list_messages', chat_ids: batch, limit: Number(limit) || 50 };
    if (since) args.since = since;
    if (until) args.until = until;
    if (query) args.query = query;
    const data = await callTool('chats_read', args);
    const perChat = pickArray(data, 'chats');
    if (perChat.length && perChat[0]?.chatId !== undefined) {
      for (const c of perChat) {
        result[c.chatId] = {
          skipped: !!c.skipped,
          coverage: c.coverage || null,
          messages: (c.messages || []).map(normalizeMessage),
        };
      }
    } else if (batch.length === 1) {
      result[batch[0]] = { messages: pickArray(data, 'messages', 'items').map(normalizeMessage) };
    }
  }
  return result;
}

app.post('/api/messages', wrap(async (req, res) => {
  const { chatIds = [], since, until, limit, query } = req.body;
  if (!chatIds.length) return res.status(400).json({ error: 'chatIds is required' });
  res.json(await fetchMessages(chatIds, { since, until, limit, query }));
}));

// ---------- send any message (text / media / poll) to one, selected or all ----------
// Body: {
//   recipients: [{id, name, phone}],          // one or many chat ids
//   type: 'text' | 'media' | 'poll',
//   text,                                     // text, or the caption for media
//   media: { data_base64 | url, mime_type, filename, kind },
//   poll:  { question, options: [..], allow_multiple },
//   delayMs
// }
// Streams progress as NDJSON (one JSON object per line), so the UI shows each result live.
// {name} and {phone} in text, caption and poll question are filled in per recipient.
const fill = (s, r) => String(s ?? '')
  .replaceAll('{name}', r.name || '')
  .replaceAll('{phone}', r.phone || phoneFromChatId(r.id));

function buildSendArgs(type, r, { text, media, poll }) {
  if (type === 'media') {
    if (!media?.data_base64 && !media?.url) throw new Error('media needs a file or a URL');
    const m = { ...media };
    if (text) m.caption = fill(text, r);
    for (const k of Object.keys(m)) if (m[k] === '' || m[k] == null) delete m[k];
    return { action: 'send_message_media', chat_id: r.id, media: m };
  }
  if (type === 'poll') {
    const options = (poll?.options || []).map((o) => String(o).trim()).filter(Boolean);
    if (!poll?.question?.trim() || options.length < 2 || options.length > 12) throw new Error('poll needs a question and 2-12 options');
    return { action: 'send_message_poll', chat_id: r.id, poll: { question: fill(poll.question, r), options, allow_multiple: !!poll.allow_multiple } };
  }
  if (!String(text || '').trim()) throw new Error('text is empty');
  return { action: 'send_message_text', chat_id: r.id, text: fill(text, r) };
}

app.post('/api/send', wrap(async (req, res) => {
  const { recipients = [], type = 'text', text = '', media, poll, delayMs = 3000 } = req.body;
  // Remove duplicates and anything that isn't a chat id
  const seen = new Set();
  const list = recipients.filter((r) => r?.id && /@(c\.us|g\.us|newsletter)$/.test(r.id) && !seen.has(r.id) && seen.add(r.id));
  if (!list.length) return res.status(400).json({ error: 'No valid recipients' });
  try { buildSendArgs(type, list[0], { text, media, poll }); } catch (err) { return res.status(400).json({ error: err.message }); }

  let aborted = false;
  res.on('close', () => { if (!res.writableEnded) aborted = true; });
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  const emit = (o) => res.write(JSON.stringify(o) + '\n');
  emit({ event: 'start', total: list.length, type });

  const batchId = Date.now().toString(36);
  let sent = 0, failed = 0;
  for (const [i, r] of list.entries()) {
    if (aborted) break;
    try {
      const args = buildSendArgs(type, r, { text, media, poll });
      args.idempotency_key = `ui-${batchId}-${i}`;
      const data = await callTool('chats_write', args);
      sent++;
      emit({ event: 'result', index: i, id: r.id, name: r.name, ok: true, data });
    } catch (err) {
      failed++;
      emit({ event: 'result', index: i, id: r.id, name: r.name, ok: false, error: explainError(err) });
    }
    if (i < list.length - 1 && !aborted) await sleep(Math.max(1000, Number(delayMs) || 0));
  }
  emit({ event: 'done', sent, failed, total: list.length, stopped: aborted });
  res.end();
}));

// ---------- ZIP export of the selected chats ----------
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const safeName = (s) => String(s || 'chat').replace(/[^\p{L}\p{N}+._ -]/gu, '_').slice(0, 60).trim() || 'chat';
const extFromMime = (m = '') => (m.split('/')[1] || 'bin').split(';')[0].replace('jpeg', 'jpg').replace('ogg', 'ogg');

// Body: { chats:[{id,name,phone,kind}], since, until, limit, includeMedia, maxMediaPerChat }
app.post('/api/export', wrap(async (req, res) => {
  const { chats = [], since, until, limit = 200, includeMedia = false, maxMediaPerChat = 20 } = req.body;
  if (!chats.length) return res.status(400).json({ error: 'chats is required' });

  const messagesByChat = await fetchMessages(chats.map((c) => c.id), { since, until, limit });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="whatsapp-export-${stamp}.zip"`);
  const zip = archiver('zip', { zlib: { level: 9 } });
  zip.on('warning', (e) => console.warn('[zip]', e));
  zip.on('error', (e) => { console.error('[zip]', e); res.destroy(e); });
  zip.pipe(res);

  // Summary of the selected numbers
  const summary = [['chat_id', 'name', 'phone', 'kind', 'messages_exported'].map(csvCell).join(',')];
  for (const c of chats) {
    const n = messagesByChat[c.id]?.messages?.length ?? 0;
    summary.push([c.id, c.name, c.phone || phoneFromChatId(c.id), c.kind, n].map(csvCell).join(','));
  }
  zip.append('﻿' + summary.join('\n'), { name: 'selected_numbers.csv' });
  zip.append(JSON.stringify({ exportedAt: new Date().toISOString(), since, until, limit, chats }, null, 2), { name: 'export_info.json' });

  for (const c of chats) {
    const entry = messagesByChat[c.id] || { messages: [] };
    const msgs = [...entry.messages].sort((a, b) => (a.time < b.time ? -1 : 1));
    const folder = `chats/${safeName(c.name)}_${digits(c.id) || safeName(c.id)}`;

    zip.append(JSON.stringify({ chat: c, coverage: entry.coverage, messages: msgs }, null, 2), { name: `${folder}/messages.json` });

    const txt = msgs.map((m) => {
      const who = m.fromMe ? 'Me' : (m.sender || c.name);
      const body = m.text || (m.filename ? `[${m.type}: ${m.filename}]` : `[${m.type}]`);
      return `[${m.time}] ${who}: ${body}`;
    }).join('\n');
    zip.append(txt || '(no messages in range)', { name: `${folder}/messages.txt` });

    const csv = [['time', 'from_me', 'sender', 'type', 'text', 'filename', 'key'].map(csvCell).join(',')]
      .concat(msgs.map((m) => [m.time, m.fromMe, m.sender, m.type, m.text, m.filename, m.key].map(csvCell).join(',')));
    zip.append('﻿' + csv.join('\n'), { name: `${folder}/messages.csv` });

    if (includeMedia) {
      const withMedia = msgs.filter((m) => m.hasMedia && m.key).slice(-Number(maxMediaPerChat || 20));
      for (const m of withMedia) {
        try {
          const media = await callTool('chats_read', { action: 'get_media', chat_id: c.id, key: m.key });
          const fname = safeName(media.filename || m.filename || `${m.time}_${m.type}`);
          const ext = fname.includes('.') ? '' : `.${extFromMime(media.mimetype || m.mimetype)}`;
          let buf = null;
          if (media.data_base64) buf = Buffer.from(media.data_base64, 'base64');
          else if (media.url) buf = Buffer.from(await (await fetch(media.url)).arrayBuffer());
          if (buf) zip.append(buf, { name: `${folder}/media/${fname}${ext}` });
        } catch (err) {
          zip.append(`Failed to download media ${m.key}: ${err.message}`, { name: `${folder}/media/_error_${safeName(m.key)}.txt` });
        }
      }
    }
  }
  await zip.finalize();
}));

// ---------- download this project's source code as a ZIP ----------
app.get('/api/source.zip', (_req, res) => {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="whatsapp-blueticks-ui.zip"');
  const zip = archiver('zip', { zlib: { level: 9 } });
  zip.pipe(res);
  zip.glob('**/*', { cwd: __dirname, dot: true, ignore: ['node_modules/**', '.env', 'exports/**', '*.zip'] }, { prefix: 'whatsapp-blueticks-ui' });
  zip.finalize();
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => console.log(`WhatsApp Blueticks UI → http://localhost:${PORT}`));
