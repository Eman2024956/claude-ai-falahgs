// Helpers that turn Blueticks responses into stable shapes for the UI.
// Field names are read defensively because engines can differ slightly.

export function pickArray(data, ...keys) {
  if (Array.isArray(data)) return data;
  for (const k of keys) if (Array.isArray(data?.[k])) return data[k];
  for (const v of Object.values(data || {})) if (Array.isArray(v)) return v;
  return [];
}

export function idOf(row) {
  const v = row?.id ?? row?.chatId ?? row?.chat_id ?? row?.jid ?? row?.wid;
  if (v && typeof v === 'object') return v._serialized || (v.user && v.server ? `${v.user}@${v.server}` : '');
  return v ? String(v) : '';
}

/** "9647701234567@c.us" -> "+9647701234567"; groups/channels -> "" */
export function phoneFromChatId(chatId = '') {
  const m = /^(\d{6,16})@(c\.us|s\.whatsapp\.net)$/.exec(chatId);
  return m ? `+${m[1]}` : '';
}

export function chatKind(chatId = '', row = {}) {
  if (chatId.endsWith('@g.us')) return 'group';
  if (chatId.endsWith('@newsletter')) return 'channel';
  if (chatId.endsWith('@c.us') || chatId.endsWith('@s.whatsapp.net')) return 'contact';
  return row.chatType || 'other';
}

/** Normalise any number the user typed into digits only (keeps it comparable). */
export function digits(s = '') { return String(s).replace(/\D/g, ''); }

/** Build a chat id from a typed phone number: "+964 770 123 4567" -> "9647701234567@c.us" */
export function chatIdFromPhone(phone) {
  const d = digits(phone);
  return d.length >= 6 ? `${d}@c.us` : '';
}

function toIso(t) {
  if (t == null || t === '') return '';
  if (typeof t === 'number') return new Date(t < 1e12 ? t * 1000 : t).toISOString();
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? String(t) : d.toISOString();
}

export function normalizeChat(row) {
  const id = idOf(row);
  return {
    id,
    name: row.name || row.formattedTitle || row.pushname || row.title || phoneFromChatId(id) || id,
    phone: phoneFromChatId(id),
    kind: chatKind(id, row),
    unread: row.unreadCount ?? 0,
    pinned: !!row.pinned,
    archived: !!row.archived,
    lastMessageAt: toIso(row.lastMessageAt ?? row.timestamp ?? row.t),
    lastMessage: row.lastMessageText ?? '',
  };
}

export function normalizeContact(row) {
  const id = idOf(row) || (row.number ? `${digits(row.number)}@c.us` : '');
  return {
    id,
    name: row.name || row.pushname || row.shortName || row.verifiedName || phoneFromChatId(id) || id,
    phone: phoneFromChatId(id) || (row.number ? `+${digits(row.number)}` : ''),
    kind: chatKind(id, row),
    isMyContact: row.isMyContact ?? null,
    isBusiness: row.isBusiness ?? null,
  };
}

export function normalizeMessage(m) {
  const key = m.waMessageKey?._serialized || m.key || m.id?._serialized || m.id || '';
  return {
    key: typeof key === 'string' ? key : JSON.stringify(key),
    time: toIso(m.timestamp ?? m.t ?? m.sentAt ?? m.createdAt),
    fromMe: !!m.fromMe,
    sender: m.senderName || m.notifyName || m.sender || m.author || m.from || '',
    type: m.type || 'chat',
    text: m.body ?? m.text ?? m.caption ?? '',
    caption: m.caption ?? '',
    filename: m.filename ?? m.fileName ?? '',
    mimetype: m.mimetype ?? m.mime ?? '',
    hasMedia: !!(m.hasMedia || m.mimetype),
    call: m.call || null,
  };
}
