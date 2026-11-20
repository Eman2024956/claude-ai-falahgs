// WhatsApp (Blueticks MCP) selection UI — Express backend.
import 'dotenv/config';
import express from 'express';
import archiver from 'archiver';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { callTool, listTools, explainError } from './src/mcpClient.js';
import { sendRest } from './src/restClient.js';
import { addRecord, applyCallback, listRecords } from './src/history.js';
import { basicAuth, securityHeaders, rateLimit } from './src/security.js';
import crypto from 'node:crypto';

// ---------- production config ----------
const IS_PROD = process.env.NODE_ENV === 'production';
const APP_USER = process.env.APP_USERNAME || 'admin';
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');          // e.g. https://wa.example.com
const CALLBACK_SECRET = process.env.CALLBACK_SECRET || '';                       // random string in the callback URL
const MAX_RECIPIENTS = Number(process.env.MAX_RECIPIENTS_PER_SEND) || 500;
const MIN_DELAY_MS = (Number(process.env.MIN_DELAY_SECONDS) || 2) * 1000;

const problems = [];
if (!process.env.BLUETICKS_API_KEY) problems.push('BLUETICKS_API_KEY is missing');
if (IS_PROD && !APP_PASSWORD) problems.push('APP_PASSWORD is required in production (protects the UI)');
if (IS_PROD && APP_PASSWORD && APP_PASSWORD.length < 10) problems.push('APP_PASSWORD must be at least 10 characters');
if (PUBLIC_URL && !/^https:\/\//.test(PUBLIC_URL)) problems.push('PUBLIC_URL must start with https://');
if (PUBLIC_URL && CALLBACK_SECRET.length < 16) problems.push('CALLBACK_SECRET (16+ random characters) is required when PUBLIC_URL is set');
if (problems.length) {
  console.error('\n❌ Configuration problems:\n  - ' + problems.join('\n  - ') + '\nSee .env.example\n');
  if (IS_PROD) process.exit(1);
}
const CALLBACK_URL = PUBLIC_URL && CALLBACK_SECRET ? `${PUBLIC_URL}/api/callback/${CALLBACK_SECRET}` : '';

// Which Blueticks API to use:
//   rest -> REST API  (POST api.blueticks.co/messages, apiKey in the body). Sends only: text, media URL, schedule.
//   mcp  -> MCP server (api.blueticks.co/mcp, bt_live_ key). Full access: chats, contacts, messages, polls.
//   auto -> mcp if the key starts with bt_live_, otherwise rest.
const KEY = process.env.BLUETICKS_API_KEY || '';
const MODE = (process.env.BLUETICKS_MODE || 'auto') === 'auto'
  ? (KEY.startsWith('bt_live_') ? 'mcp' : 'rest')
  : process.env.BLUETICKS_MODE;
const REST_ONLY_MSG = 'This needs the Blueticks MCP API (a bt_live_ key). With the REST API key you can only send: paste numbers in the Send tab or in "paste phone numbers manually".';
import {
  pickArray, normalizeChat, normalizeContact, normalizeMessage,
  chatIdFromPhone, phoneFromChatId, digits,
} from './src/normalize.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1)); // behind Nginx / Caddy / a load balancer
app.use(securityHeaders);

// Health check and Blueticks callbacks stay public; everything else needs the password.
app.get('/healthz', (_req, res) => res.json({ ok: true, mode: MODE, uptime: Math.round(process.uptime()) }));
app.post('/api/callback/:secret', express.json({ limit: '1mb' }), express.urlencoded({ extended: true }), (req, res) => {
  const ok = CALLBACK_SECRET && req.params.secret.length === CALLBACK_SECRET.length
    && crypto.timingSafeEqual(Buffer.from(req.params.secret), Buffer.from(CALLBACK_SECRET));
  if (!ok) return res.status(404).end();
  const { matched, record } = applyCallback(req.body);
  console.log(`[callback] ${record.messageId || '?'} → ${record.status}${matched ? '' : ' (unknown id)'}`);
  res.json({ ok: true });
});

app.use(basicAuth({ user: APP_USER, password: APP_PASSWORD }));
app.use(express.json({ limit: '25mb' })); // large enough for media uploads (base64)
app.use(express.static(path.join(__dirname, 'public'), { maxAge: IS_PROD ? '1h' : 0 }));
app.use('/api/send', rateLimit({ windowMs: 60_000, max: Number(process.env.SEND_REQUESTS_PER_MINUTE) || 10 }));
app.use('/api', rateLimit({ windowMs: 60_000, max: 300 }));

const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
  console.error(err);
  if (!res.headersSent) res.status(500).json({ error: explainError(err) });
  else res.end();
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_CHATS_PER_REQUEST = 25; // Blueticks list_messages batch limit

// ---------- config / status ----------
app.get('/api/config', (_req, res) => res.json({ mode: MODE }));

app.get('/api/status', wrap(async (_req, res) => {
  if (MODE === 'rest') return res.json({ connected: true, mode: 'rest', server: process.env.BLUETICKS_REST_URL || 'https://api.blueticks.co', callbacks: !!CALLBACK_URL, production: IS_PROD, tools: [], note: 'REST API mode: the key is checked on the first send.' });
  const tools = await listTools();
  let engine = null;
  try { engine = await callTool('engine', { action: 'status' }); } catch { /* optional */ }
  res.json({ connected: true, tools, engine });
}));

// ---------- chats (with server-side filters) ----------
// GET /api/chats?kind=contact|group|all&q=text&prefix=964&since=ISO&max=500&archived=1
app.get('/api/chats', wrap(async (req, res) => {
  if (MODE === 'rest') return res.status(400).json({ error: REST_ONLY_MSG });
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
  if (MODE === 'rest') return res.status(400).json({ error: REST_ONLY_MSG });
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
  if (MODE === 'rest') return res.status(400).json({ error: REST_ONLY_MSG });
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

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', mp4: 'video/mp4', mov: 'video/quicktime', mp3: 'audio/mpeg', ogg: 'audio/ogg', m4a: 'audio/mp4', pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', zip: 'application/zip', txt: 'text/plain' };
function guessMime(url = '', kind = '') {
  const ext = (url.split('?')[0].split('.').pop() || '').toLowerCase();
  return MIME[ext] || ({ image: 'image/jpeg', video: 'video/mp4', audio: 'audio/mpeg' }[kind]) || 'application/octet-stream';
}

app.post('/api/send', wrap(async (req, res) => {
  const { recipients = [], type = 'text', text = '', media, poll, delayMs = 3000, dueDate, callbackUrl } = req.body;
  // Remove duplicates and anything that isn't a chat id
  const seen = new Set();
  const list = recipients.filter((r) => r?.id && /@(c\.us|g\.us|newsletter)$/.test(r.id) && !seen.has(r.id) && seen.add(r.id));
  if (!list.length) return res.status(400).json({ error: 'No valid recipients' });
  if (list.length > MAX_RECIPIENTS) return res.status(400).json({ error: `Too many recipients (${list.length}). The limit is ${MAX_RECIPIENTS} per send (MAX_RECIPIENTS_PER_SEND).` });
  try { buildSendArgs(type, list[0], { text, media, poll }); } catch (err) { return res.status(400).json({ error: err.message }); }
  if (MODE === 'rest') {
    if (type === 'poll') return res.status(400).json({ error: 'Polls are not supported by the Blueticks REST API.' });
    if (type === 'media' && !media?.url) return res.status(400).json({ error: 'The Blueticks REST API needs a public https URL for media (file upload is not supported).' });
    if (list.some((r) => !r.id.endsWith('@c.us'))) return res.status(400).json({ error: 'The Blueticks REST API sends to phone numbers only (no groups/channels).' });
  } else if (dueDate) {
    return res.status(400).json({ error: 'Scheduling is only available with the REST API key in this app.' });
  }

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
      let data;
      if (MODE === 'rest') {
        data = await sendRest({
          to: r.id,
          message: fill(text, r),
          asset: type === 'media' ? { url: media.url, type: media.mime_type || guessMime(media.url, media.kind) } : undefined,
          dueDate, callbackUrl: callbackUrl || CALLBACK_URL || undefined,
        });
      } else {
        const args = buildSendArgs(type, r, { text, media, poll });
        args.idempotency_key = `ui-${batchId}-${i}`;
        data = await callTool('chats_write', args);
      }
      sent++;
      addRecord({
        messageId: data?.messageId || data?.id || undefined, to: phoneFromChatId(r.id) || r.id, name: r.name,
        type, text: type === 'poll' ? poll?.question : fill(text, r), media: media?.url || media?.filename,
        status: data?.status || 'sent', dueDate: data?.dueDate || dueDate, api: MODE, server: data?.server,
      });
      emit({ event: 'result', index: i, id: r.id, name: r.name, ok: true, data });
    } catch (err) {
      failed++;
      addRecord({ to: phoneFromChatId(r.id) || r.id, name: r.name, type, text: fill(text, r), status: 'error', error: explainError(err), api: MODE });
      emit({ event: 'result', index: i, id: r.id, name: r.name, ok: false, error: explainError(err) });
    }
    if (i < list.length - 1 && !aborted) await sleep(Math.max(MIN_DELAY_MS, Number(delayMs) || 0));
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
  if (MODE === 'rest') return res.status(400).json({ error: REST_ONLY_MSG });
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

// ---------- message history (with delivery reports from callbacks) ----------
app.get('/api/history', (req, res) => {
  res.json({ callbacks: !!CALLBACK_URL, records: listRecords({ limit: Math.min(Number(req.query.limit) || 200, 2000), q: req.query.q || '' }) });
});

// ---------- download this project's source code as a ZIP ----------
app.get('/api/source.zip', (req, res, next) => {
  if (IS_PROD && process.env.ALLOW_SOURCE_DOWNLOAD !== 'true') return res.status(404).json({ error: 'Disabled in production' });
  next();
}, (_req, res) => {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="whatsapp-blueticks-ui.zip"');
  const zip = archiver('zip', { zlib: { level: 9 } });
  zip.pipe(res);
  zip.glob('**/*', { cwd: __dirname, dot: true, ignore: ['node_modules/**', '.env', 'exports/**', '*.zip'] }, { prefix: 'whatsapp-blueticks-ui' });
  zip.finalize();
});

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || (IS_PROD ? '127.0.0.1' : '0.0.0.0'); // in production, expose only via the reverse proxy
const server = app.listen(PORT, HOST, () => {
  console.log(`WhatsApp Blueticks UI → http://${HOST}:${PORT}  (Blueticks ${MODE.toUpperCase()} API${IS_PROD ? ', production' : ''})`);
  console.log(`  password: ${APP_PASSWORD ? 'on' : 'OFF (set APP_PASSWORD)'} · delivery callbacks: ${CALLBACK_URL ? 'on' : 'off (set PUBLIC_URL + CALLBACK_SECRET)'}`);
});
const shutdown = (sig) => { console.log(`${sig} received, shutting down…`); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 10_000).unref(); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
