// MCP client for the Blueticks WhatsApp MCP server.
// Connects over Streamable HTTP (falls back to SSE) and exposes a small `callTool` helper
// that returns parsed JSON from the tool result.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const MCP_URL = process.env.BLUETICKS_MCP_URL;
const API_KEY = process.env.BLUETICKS_API_KEY;
const FROM_NUMBER = process.env.BLUETICKS_FROM_NUMBER || '';

let client = null;
let connecting = null;

function authHeaders() {
  return API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {};
}

async function connect() {
  if (!MCP_URL) throw new Error('BLUETICKS_MCP_URL is not set (see .env.example)');
  const url = new URL(MCP_URL);
  const requestInit = { headers: authHeaders() };

  const c = new Client({ name: 'whatsapp-blueticks-ui', version: '1.0.0' });
  try {
    await c.connect(new StreamableHTTPClientTransport(url, { requestInit }));
  } catch (err) {
    console.warn('[mcp] Streamable HTTP failed, trying SSE:', err.message);
    const sse = new Client({ name: 'whatsapp-blueticks-ui', version: '1.0.0' });
    await sse.connect(new SSEClientTransport(url, {
      requestInit,
      eventSourceInit: { fetch: (u, init) => fetch(u, { ...init, headers: { ...(init?.headers || {}), ...authHeaders() } }) },
    }));
    return sse;
  }
  return c;
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
      throw new Error(`${name}/${args.action}: ${msg}`);
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
