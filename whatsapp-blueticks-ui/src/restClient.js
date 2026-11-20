// Blueticks REST API (https://documenter.getpostman.com/view/800229/TVsrG9VS)
//   POST https://api.blueticks.co/messages
//   body: { to: "+9647701234567", message, apiKey, asset?: {url, type}, dueDate?: ISO-UTC, callbackUrl? }
//   -> { status: true, message: "Message queued successfuly", callbackUrl }
// The API key goes in the JSON body (field "apiKey"), not in a header. Messages are queued (async).
// WhatsApp Web must be open in Chrome with the Blueticks extension, unless you have the Campaigner package.
const REST_URL = (process.env.BLUETICKS_REST_URL || 'https://api.blueticks.co').replace(/\/$/, '');
const API_KEY = process.env.BLUETICKS_API_KEY || '';

/** "9647701234567@c.us" or "+964 770..." -> "+9647701234567" */
export function toE164(idOrPhone = '') {
  const d = String(idOrPhone).split('@')[0].replace(/\D/g, '');
  return d ? `+${d}` : '';
}

export async function sendRest({ to, message = '', asset, dueDate, callbackUrl }) {
  if (!API_KEY) throw new Error('BLUETICKS_API_KEY is not set (see .env.example)');
  const body = { to: toE164(to), message, apiKey: API_KEY };
  if (asset?.url) body.asset = { url: asset.url, type: asset.type || 'application/octet-stream' };
  if (dueDate) body.dueDate = new Date(dueDate).toISOString();
  if (callbackUrl) body.callbackUrl = callbackUrl;

  let res;
  try {
    res = await fetch(`${REST_URL}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`Cannot reach ${REST_URL}: ${err.cause?.code || err.message}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status === false) {
    if (res.status === 401 && /Invalid API key/i.test(data.message)) {
      throw new Error('Blueticks says "Invalid API key". Copy the API key again from your Blueticks account (extension → API), or create a new one.');
    }
    throw new Error(`Blueticks ${res.status}: ${data.message || res.statusText}`);
  }
  return data; // { status: true, message: "Message queued successfuly", callbackUrl }
}
