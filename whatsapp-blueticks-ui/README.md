# WhatsApp Number Selector (Blueticks REST API + MCP)

A Node.js web app that connects to the **Blueticks WhatsApp MCP server** as an MCP client and gives you a UI to:

1. **Load** your WhatsApp chats or contacts.
2. **Filter** mobile numbers by name/number search, country code or prefix (`964`, `96477`…), regex, unread only, or contacts vs groups. You can also paste numbers by hand.
3. **Select** numbers with checkboxes or "select all visible". Copy the selection or download it as a CSV.
4. **Preview** messages of the selected chats in a date range.
5. **Export a ZIP** with `selected_numbers.csv` and, for each chat, `messages.json`, `messages.txt` and `messages.csv` (media files optional).
6. **Send Message tab**: send **any message** (text, image, video, audio, document, or poll):
   - to **one number** (type it, or pick a loaded contact),
   - to the **selected** numbers,
   - to **all filtered** numbers,
   - or to **all loaded** numbers.

   `{name}` / `{phone}` are filled in for each person. You get a live preview bubble, a delay between messages, a live progress bar with a ✔/✖ line per chat, and a **Stop** button.
7. **Download the source code** of this app as a ZIP (`/api/source.zip`).

## Setup

```bash
npm install
cp .env.example .env     # then set BLUETICKS_MCP_URL and BLUETICKS_API_KEY
npm start                # open http://localhost:3000
```

| Variable | Meaning |
|---|---|
| `BLUETICKS_MCP_URL` | `https://api.blueticks.co/mcp` (the default) |
| `BLUETICKS_MODE` | `auto` (default), `rest` or `mcp` |
| `BLUETICKS_REST_URL` | `https://api.blueticks.co` (default) or `https://stg-api.blueticks.co` |
| `BLUETICKS_API_KEY` | Your Blueticks API key, either a REST key or a `bt_live_` MCP key |
| `BLUETICKS_FROM_NUMBER` | Optional. The number to use if your account has more than one WhatsApp number |
| `PORT` | Local port (default 3000) |

### Try it without a Blueticks account

```bash
npm run mock                                                  # fake MCP server on :4100
BLUETICKS_MCP_URL=http://localhost:4100/mcp BLUETICKS_API_KEY=x npm start
```

## Two Blueticks APIs: which one your key is for

| | **REST API** ([Postman docs](https://documenter.getpostman.com/view/800229/TVsrG9VS)) | **MCP API** |
|---|---|---|
| Key looks like | `yYBiIMwqvUWBWWzxEyvPzIuIGrGcHgJG` (no prefix) | `bt_live_…` |
| Endpoint | `POST https://api.blueticks.co/messages` (staging: `https://stg-api.blueticks.co/messages`) | `https://api.blueticks.co/mcp` |
| Where the key goes | JSON body field **`apiKey`** | `Authorization: Bearer` header |
| Send text | ✅ | ✅ |
| Send media | ✅ public URL only (`asset: {url, type}`) | ✅ URL or file upload |
| Schedule (`dueDate`, UTC) | ✅ | — |
| Delivery callback (`callbackUrl`) | ✅ | — |
| Polls | — | ✅ |
| Load chats, contacts and history, ZIP export | — | ✅ |

`BLUETICKS_MODE=auto` (the default) picks **MCP** if the key starts with `bt_live_`, otherwise **REST**. In REST mode the UI hides what that API can't do, and you add recipients by pasting numbers.

REST request sent by the app:
```json
POST https://api.blueticks.co/messages
{ "to": "+9647701234567", "message": "Hello", "apiKey": "<your key>",
  "asset": { "url": "https://picsum.photos/200/300", "type": "image/jpeg" },
  "dueDate": "2026-12-01T09:00:00.000Z", "callbackUrl": "https://your-server/webhook" }
→ 201 { "status": true, "message": "Message queued successfuly", "callbackUrl": "Not supplied",
        "userMessage": { "_id": "6b00…", "status": "pending", "dueDate": "…", "contactList": [{ "mobile": "+9647701234567" }] } }
```
- **Production vs staging:** keys only work on their own server. Set `BLUETICKS_REST_URL=https://stg-api.blueticks.co` for a staging key. With the wrong server you get `401 Invalid API key`.
- **GET is not available with an API key.** `GET /messages` and `GET /messages/:id` need a logged-in user token (JWT) and return `401 Not authenticated` with the API key. To get delivery status, pass a `callbackUrl` and Blueticks will call it.
With the REST API, WhatsApp Web must stay open in Chrome with the Blueticks extension, unless you have the Campaigner package.

## Before you start, and fixing common errors

1. **Connect WhatsApp to Blueticks** at https://app.blueticks.co/connections, through Gateway or through the Chrome extension with web.whatsapp.com open.
2. **Get your API key** from your Blueticks account. A REST key has no prefix; an MCP key starts with `bt_live_`.
3. **Test the key with curl**:
   ```bash
   ./test-key.sh +9647701234567 "Hello"                          # send a test message
   ./test-key.sh +9647701234567 "Hello" 2026-12-01T09:00:00Z     # schedule it (REST key)
   ```

| Error | What it means |
|---|---|
| `getaddrinfo ENOTFOUND …` | Wrong URL. Use `https://api.blueticks.co/mcp` |
| REST `401 Invalid API key` | The field is right but the key is wrong or expired. Copy it again from Blueticks |
| REST `401 Not authenticated` | No `apiKey` in the body |
| MCP `invalid_token` | The key is not an MCP key, or it's revoked. Use REST mode or a `bt_live_` key |
| `No WhatsApp is connected` (`no_engine`) | Connect your phone at app.blueticks.co/connections |

## How it works

```
Browser UI (public/)  ──REST──▶  Express (server.js)  ──MCP (Streamable HTTP / SSE)──▶  Blueticks MCP
```

| REST endpoint | Blueticks MCP tool call |
|---|---|
| `GET /api/chats` | `chats_read` → `list` / `search` (paged, `kinds`, `since`) |
| `GET /api/contacts` | `contacts` → `list` (cursor paging) |
| `POST /api/messages` | `chats_read` → `list_messages` with `chat_ids` (25 chats per batch) |
| `POST /api/send` | `chats_write` → `send_message_text` / `send_message_media` / `send_message_poll` (progress streamed as NDJSON) |
| `POST /api/export` | `list_messages` (+ `get_media`) → streamed ZIP (archiver) |
| `GET /api/status` | `listTools` |

## Files

```
server.js            Express API, ZIP export, source download
src/mcpClient.js     MCP client (connect, callTool, parse results)
src/restClient.js    REST client (POST /messages with apiKey in the body)
src/normalize.js     Turns Blueticks rows into stable chat/contact/message objects
public/index.html    UI
public/app.js        Filtering, selection, preview, export, Send Message tab
public/styles.css    Styles (light and dark)
mock-mcp.mjs         Local mock of the Blueticks MCP server for testing
test-key.sh          curl test of your API key (and optional test send)
```

## Notes

- **Send** goes out right away. The UI asks you to confirm first. Only message people who agreed to hear from you, so your number does not get banned.
- Keep `.env` private. It is in `.gitignore`.

## `POST /api/send` body

```json
{
  "recipients": [{ "id": "9647701234567@c.us", "name": "Ali", "phone": "+9647701234567" }],
  "type": "text | media | poll",
  "text": "Hello {name}",
  "media": { "data_base64": "...", "mime_type": "image/png", "filename": "a.png", "kind": "image" },
  "poll":  { "question": "Best day?", "options": ["Mon", "Tue"], "allow_multiple": false },
  "delayMs": 3000
}
```
For `media`, you can send `"url": "https://..."` in place of `data_base64`. When the type is `media`, `text` is used as the caption.
