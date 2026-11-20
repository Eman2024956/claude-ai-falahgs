# WhatsApp Number Selector (Blueticks MCP)

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
| `BLUETICKS_MCP_URL` | The MCP endpoint URL from your Blueticks dashboard |
| `BLUETICKS_API_KEY` | Your Blueticks API key, sent as `Authorization: Bearer …` |
| `BLUETICKS_FROM_NUMBER` | Optional. The number to use if your account has more than one WhatsApp number |
| `PORT` | Local port (default 3000) |

### Try it without a Blueticks account

```bash
npm run mock                                                  # fake MCP server on :4100
BLUETICKS_MCP_URL=http://localhost:4100/mcp BLUETICKS_API_KEY=x npm start
```

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
src/normalize.js     Turns Blueticks rows into stable chat/contact/message objects
public/index.html    UI
public/app.js        Filtering, selection, preview, export, Send Message tab
public/styles.css    Styles (light and dark)
mock-mcp.mjs         Local mock of the Blueticks MCP server for testing
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
