#!/usr/bin/env bash
# Test your Blueticks API key and (optionally) send one WhatsApp text with curl.
#   ./test-key.sh                       -> checks the key, lists tools, shows the WhatsApp connection
#   ./test-key.sh +9647701234567 "Hi"   -> also sends "Hi" to that number
set -euo pipefail
[ -f .env ] && set -a && . ./.env && set +a
URL="${BLUETICKS_MCP_URL:-https://api.blueticks.co/mcp}"
KEY="${BLUETICKS_API_KEY:?Set BLUETICKS_API_KEY in .env}"
H=(-H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream')

echo "1) initialize"
SID=$(curl -sS -D - -o /tmp/bt_init.json "$URL" "${H[@]}" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test-key","version":"1"}}}' \
  | awk -F': ' 'tolower($1)=="mcp-session-id"{print $2}' | tr -d '\r')
cat /tmp/bt_init.json; echo
grep -q invalid_token /tmp/bt_init.json && { echo "❌ Key rejected. Create a new bt_live_ key on the Blueticks API page."; exit 1; }
[ -n "$SID" ] && H+=(-H "mcp-session-id: $SID")
curl -sS "$URL" "${H[@]}" -d '{"jsonrpc":"2.0","method":"notifications/initialized"}' >/dev/null

call() { curl -sS "$URL" "${H[@]}" -d "{\"jsonrpc\":\"2.0\",\"id\":$1,\"method\":\"tools/call\",\"params\":{\"name\":\"$2\",\"arguments\":$3}}"; echo; }

echo "2) WhatsApp connection (engine)"
call 2 engine '{"action":"status"}'

if [ $# -ge 1 ]; then
  NUM=$(echo "$1" | tr -cd '0-9'); TEXT="${2:-Test message from Blueticks MCP}"
  echo "3) send text to +$NUM"
  call 3 chats_write "{\"action\":\"send_message_text\",\"chat_id\":\"$NUM@c.us\",\"text\":\"$TEXT\"}"
fi
