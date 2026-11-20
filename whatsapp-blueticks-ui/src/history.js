// Message history + delivery reports, stored as JSON lines in data/messages.jsonl.
// Every send is recorded; Blueticks callbacks (callbackUrl) update the record's status.
import fs from 'node:fs';
import path from 'node:path';

const DIR = process.env.DATA_DIR || path.resolve('data');
const FILE = path.join(DIR, 'messages.jsonl');
const MAX_IN_MEMORY = 5000;
const records = new Map(); // messageId|localId -> record

fs.mkdirSync(DIR, { recursive: true });
if (fs.existsSync(FILE)) {
  for (const line of fs.readFileSync(FILE, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); records.set(r.key, { ...records.get(r.key), ...r }); } catch { /* skip bad line */ }
  }
  trim();
}

function trim() {
  while (records.size > MAX_IN_MEMORY) records.delete(records.keys().next().value);
}
function persist(rec) {
  fs.appendFile(FILE, JSON.stringify(rec) + '\n', (err) => err && console.error('[history]', err.message));
}

export function addRecord(rec) {
  const key = rec.messageId || `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const full = { key, createdAt: new Date().toISOString(), ...rec };
  records.set(key, full); trim(); persist(full);
  return full;
}

/** Find a message id and a status inside any callback payload shape. */
function parseCallback(body = {}) {
  const b = typeof body === 'object' && body ? body : {};
  const um = b.userMessage || b.message || b.data || {};
  const id = b.messageId || b._id || b.id || um._id || um.id || um.messageId;
  let status = b.status ?? um.status ?? b.state ?? b.event;
  if (status === true) status = 'sent';
  if (status === false) status = 'failed';
  const error = b.error || b.reason || um.error || (b.success === false ? 'failed' : undefined);
  if (!status) status = b.success === true ? 'sent' : error ? 'failed' : 'callback';
  return { id: id ? String(id) : '', status: String(status), error };
}

export function applyCallback(body) {
  const { id, status, error } = parseCallback(body);
  const prev = (id && records.get(id)) || null;
  const rec = {
    ...(prev || { key: id || `cb-${Date.now()}`, messageId: id }),
    status, error, callbackAt: new Date().toISOString(), callback: body,
  };
  records.set(rec.key, rec); persist(rec);
  return { matched: !!prev, record: rec };
}

export function listRecords({ limit = 200, q = '' } = {}) {
  const needle = String(q).toLowerCase();
  return [...records.values()].reverse()
    .filter((r) => !needle || JSON.stringify([r.to, r.name, r.text, r.messageId, r.status]).toLowerCase().includes(needle))
    .slice(0, limit);
}
