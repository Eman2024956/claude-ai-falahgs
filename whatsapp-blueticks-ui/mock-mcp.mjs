// Local mock of the Blueticks MCP server + REST API for testing (node mock-mcp.mjs, then BLUETICKS_MCP_URL=http://localhost:4100/mcp)
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const chats = [
  { id: '9647701234567@c.us', name: 'Ali Hassan', unreadCount: 2, lastMessageAt: '2026-11-19T10:00:00Z', lastMessageText: 'See you tomorrow' },
  { id: '9647809998877@c.us', name: 'Sara Ahmed', unreadCount: 0, lastMessageAt: '2026-11-18T09:00:00Z', lastMessageText: 'Thanks!' },
  { id: '15550100123@c.us', name: 'John US', unreadCount: 0, lastMessageAt: '2026-11-17T09:00:00Z', lastMessageText: 'ok' },
  { id: '120363000000@g.us', name: 'Family Group', unreadCount: 5, lastMessageAt: '2026-11-19T12:00:00Z', lastMessageText: 'photo' },
];
const msgs = (id) => [1, 2, 3].map((n) => ({ waMessageKey: { _serialized: `true_${id}_${n}` }, timestamp: 1763500000 + n * 60, fromMe: n % 2 === 0, body: `Message ${n} in ${id}`, type: 'chat' }));
const json = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }] });
const anyArgs = { action: z.string() }; // passthrough

function build() {
  const s = new McpServer({ name: 'mock-blueticks', version: '0.0.1' });
  s.registerTool('chats_read', { inputSchema: z.object(anyArgs).passthrough() }, async (a) => {
    let rows = chats;
    if (a.kinds?.includes('contact')) rows = rows.filter((c) => c.id.endsWith('@c.us'));
    if (a.query && a.action === 'search') rows = rows.filter((c) => c.name.toLowerCase().includes(a.query.toLowerCase()));
    if (a.action === 'list' || a.action === 'search') return json({ chats: rows.slice(a.skip || 0, (a.skip || 0) + (a.limit || 50)), total: rows.length });
    if (a.action === 'list_messages') return json({ chats: a.chat_ids.map((c) => ({ chatId: c, messages: msgs(c), coverage: { truncated: false } })) });
    return json({ error: 'unsupported' });
  });
  s.registerTool('contacts', { inputSchema: z.object(anyArgs).passthrough() }, async () => json({ contacts: chats.filter((c) => c.id.endsWith('@c.us')) }));
  s.registerTool('chats_write', { inputSchema: z.object(anyArgs).passthrough() }, async (a) => { console.log('SEND', a.action, a.chat_id, a.text || a.media?.caption || a.poll?.question, a.media ? `[${a.media.mime_type || a.media.url} ${(a.media.data_base64 || '').length}b64]` : '', a.poll ? a.poll.options.join('|') : ''); return json({ ok: true, id: 'msg_' + Date.now() }); });
  return s;
}
const app = express(); app.use(express.json());
app.post('/mcp', async (req, res) => {
  const t = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => t.close());
  await build().connect(t); await t.handleRequest(req, res, req.body);
});
// Mock of the Blueticks REST API: POST /messages (apiKey "test-key" is valid)
app.post('/messages', (req, res) => {
  const { to, message, apiKey, asset, dueDate, callbackUrl } = req.body || {};
  if (!apiKey) return res.status(401).json({ name: 'NotAuthenticated', message: 'Not authenticated', code: 401 });
  if (apiKey !== 'test-key') return res.status(401).json({ name: 'NotAuthenticated', message: 'Invalid API key', code: 401 });
  console.log('REST', to, message, asset ? JSON.stringify(asset) : '', dueDate || '', callbackUrl || '');
  res.json({ status: true, message: 'Message queued successfuly', callbackUrl: callbackUrl || 'Not supplied' });
});
app.listen(4100, () => console.log('mock MCP on :4100'));
