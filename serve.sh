#!/bin/bash
# Run the Kana Dojo server and print the addresses to open it from this computer and others on the network.
# Usage: ./serve.sh [port]     (default port 8000)
cd "$(dirname "$0")" || exit 1
PORT="${1:-8000}"
NAME="$(scutil --get LocalHostName 2>/dev/null)"

echo ""
echo "  Kana Dojo"
echo "  This computer: http://localhost:${PORT}"
[ -n "$NAME" ] && echo "  Other devices: http://${NAME}.local:${PORT}"
echo "  Ctrl+C to stop."
echo ""
exec node server/server.js --port "$PORT"
