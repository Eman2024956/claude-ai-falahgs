// MCP client for the Blueticks WhatsApp MCP server.
// Connects over Streamable HTTP (falls back to SSE) and exposes a small `callTool` helper
// that returns parsed JSON from the tool result.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const MCP_URL = process.env.BLUETICKS_MCP_URL || 'https://api.blueticks.co/mcp';
const API_KEY = process.env.BLUETICKS_API_KEY;
const FROM_NUMBER = process.env.BLUETICKS_FROM_NUMBER || '';

if (API_KEY && !API_KEY.startsWith('bt_live_')) {
  console.warn('[mcp] Warning: BLUETICKS_API_KEY does not start with "bt_live_". Blueticks API keys normally do — check you copied the API key from the Blueticks API page.');
}

let client = null;
let connecting = null;

function authHeaders() {
  return API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {};
}

/** Turn low-level errors into messages that say what to fix. */
export function explainError(err) {
  const m = String(err?.message || err);
  if (/ENOTFOUND|getaddrinfo/i.test(m)) return `Cannot reach ${MCP_URL} (host not found). Use BLUETICKS_MCP_URL=https://api.blueticks.co/mcp`;
  if (/invalid_token|401|Authentication required|Unauthorized/i.test(m)) return 'Blueticks rejected the API key (invalid_token). Create a new key on the Blueticks API page (it starts with bt_live_) and put it in BLUETICKS_API_KEY.';
  if (/no_engine|No WhatsApp is connected/i.test(m)) return 'No WhatsApp is connected to this Blueticks account. Connect it at https://app.blueticks.co/connections (Gateway, or the Chrome extension with web.whatsapp.com open).';
  return m;
}

async function connect() {
  if (!MCP_URL) throw new Error('BLUETICKS_MCP_URL is not set (see .env.example)');
  if (!API_KEY) throw new Error('BLUETICKS_API_KEY is not set (see .env.example)');
  const url = new URL(MCP_URL);
  const requestInit = { headers: authHeaders() };

  const c = new Client({ name: 'whatsapp-blueticks-ui', version: '1.0.0' });
  try {
    await c.connect(new StreamableHTTPClientTransport(url, { requestInit }));
    return c;
  } catch (err) {
    // Only fall back to the old SSE transport when the server doesn't speak Streamable HTTP.
    // Auth / DNS errors are real errors — report them instead of hiding them behind an SSE error.
    if (!/\b(404|405)\b/.test(String(err?.message))) throw new Error(explainError(err));
    console.warn('[mcp] Streamable HTTP not supported, trying SSE:', err.message);
    const sse = new Client({ name: 'whatsapp-blueticks-ui', version: '1.0.0' });
    try {
      await sse.connect(new SSEClientTransport(url, {
        requestInit,
        eventSourceInit: { fetch: (u, init) => fetch(u, { ...init, headers: { ...(init?.headers || {}), ...authHeaders() } }) },
      }));
    } catch (e2) { throw new Error(explainError(e2)); }
    return sse;
  }
}

export async function getClient() {
  if (client) return client;
  if (!connecting) {
    connecting = connect()
      .then((c) => { client = c; return c; })
      .finally(() => { connecting = null; });
  }
  return connecting;
}

/** Parse an MCP tool result into plain JSON (structuredContent > JSON text > raw text). */
export function parseToolResult(result) {
  if (result?.structuredContent) return result.structuredContent;
  const texts = (result?.content || []).filter((p) => p.type === 'text').map((p) => p.text);
  const joined = texts.join('\n');
  try { return JSON.parse(joined); } catch { return { text: joined }; }
}

/**
 * Call a Blueticks MCP tool, e.g. callTool('chats_read', { action: 'list' }).
 * Adds the configured `number` / `from` automatically for multi-number accounts.
 */
export async function callTool(name, args = {}, { retry = true } = {}) {
  const finalArgs = { ...args };
  if (FROM_NUMBER) {
    if (name === 'chats_write' && String(args.action).startsWith('send_')) finalArgs.from ??= FROM_NUMBER;
    else finalArgs.number ??= FROM_NUMBER;
  }
  try {
    const c = await getClient();
    const result = await c.callTool({ name, arguments: finalArgs }, undefined, { timeout: 180_000 });
    const data = parseToolResult(result);
    if (result?.isError) {
      const msg = typeof data === 'object' ? (data.error || data.message || data.text || JSON.stringify(data)) : String(data);
      throw new Error(explainError(`${name}/${args.action}: ${msg}`));
    }
    return data;
  } catch (err) {
    // Reconnect once if the session dropped.
    if (retry && /session|closed|not connected|ECONNRESET|fetch failed/i.test(err.message)) {
      client = null;
      return callTool(name, args, { retry: false });
    }
    throw err;
  }
}

export async function listTools() {
  const c = await getClient();
  const { tools } = await c.listTools();
  return tools.map((t) => ({ name: t.name, description: (t.description || '').split('\n')[0] }));
}
