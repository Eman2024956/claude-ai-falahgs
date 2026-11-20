#!/usr/bin/env bash
# Test your Blueticks API key with curl.
#   ./test-key.sh +9647701234567 "Hello"            -> sends one message
#   BLUETICKS_REST_URL=https://stg-api.blueticks.co ./test-key.sh +9647701234567 "Hello"   -> staging
#   ./test-key.sh +9647701234567 "Hi" 2026-12-01T09:00:00Z   -> schedules it (UTC)
# Works with both key types:
#   - REST API key (no prefix)  -> POST https://api.blueticks.co/messages  (apiKey in the JSON body)
#   - MCP key (bt_live_...)     -> https://api.blueticks.co/mcp            (Authorization: Bearer)
set -euo pipefail
[ -f .env ] && set -a && . ./.env && set +a
KEY="${BLUETICKS_API_KEY:?Set BLUETICKS_API_KEY in .env}"
TO="${1:?Usage: ./test-key.sh +9647701234567 \"message\" [dueDateUTC]}"
TO="+$(echo "$TO" | tr -cd '0-9')"
MSG="${2:-Test message from Blueticks API}"
DUE="${3:-}"

if [[ "$KEY" != bt_live_* ]]; then
  REST="${BLUETICKS_REST_URL:-https://api.blueticks.co}"
  echo "REST API → POST $REST/messages  to=$TO"
  BODY=$(printf '{"to":"%s","message":"%s","apiKey":"%s"%s}' "$TO" "${MSG//\"/\\\"}" "$KEY" "${DUE:+,\"dueDate\":\"$DUE\"}")
  curl -sS -w '\nHTTP %{http_code}\n' -X POST "$REST/messages" -H 'Content-Type: application/json' -d "$BODY"
  echo '(200/201 + "Message queued successfuly" = OK.  401 "Invalid API key" = wrong key for this server.)'
  exit 0
fi

URL="${BLUETICKS_MCP_URL:-https://api.blueticks.co/mcp}"
H=(-H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream')
echo "MCP API → $URL"
SID=$(curl -sS -D - -o /tmp/bt_init.json "$URL" "${H[@]}" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test-key","version":"1"}}}' \
  | awk -F': ' 'tolower($1)=="mcp-session-id"{print $2}' | tr -d '\r')
grep -q invalid_token /tmp/bt_init.json && { cat /tmp/bt_init.json; echo; echo "❌ Key rejected."; exit 1; }
[ -n "$SID" ] && H+=(-H "mcp-session-id: $SID")
curl -sS "$URL" "${H[@]}" -d '{"jsonrpc":"2.0","method":"notifications/initialized"}' >/dev/null
curl -sS "$URL" "${H[@]}" -d "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"chats_write\",\"arguments\":{\"action\":\"send_message_text\",\"chat_id\":\"${TO#+}@c.us\",\"text\":\"${MSG//\"/\\\"}\"}}}"; echo
