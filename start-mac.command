#!/bin/bash
# TeleGlance on macOS: double-click to start the server (port 8787) and the G2 app (port 5173).
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is missing. Install the LTS version from https://nodejs.org and run this again."
  read -r -p "Press Enter to close." _; exit 1
fi

# 1. Server settings: create .env once and fill in a random SERVER_SECRET.
if [ ! -f server/.env ]; then
  cp server/.env.example server/.env
  SECRET=$(openssl rand -hex 32)
  sed -i '' "s/^SERVER_SECRET=.*/SERVER_SECRET=$SECRET/" server/.env
  echo ""
  echo "Created server/.env. Fill in TG_API_ID, TG_API_HASH, OTARI_API_KEY and GROQ_API_KEY,"
  echo "save the file, close TextEdit and press Enter here."
  open -e server/.env
  read -r -p "Press Enter when saved... " _
fi

# 2. Install and build (only the first time or after updates).
echo "Installing packages..."
(cd server && npm install --silent && npm run build --silent) || { echo "Server build failed"; read -r _; exit 1; }
(cd app && npm install --silent) || { echo "App install failed"; read -r _; exit 1; }

IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo localhost)

# 3. Start both; Ctrl+C stops them.
(cd server && npm start) &
SERVER_PID=$!
sleep 2
(cd app && npx vite --host 0.0.0.0 --port 5173) &
APP_PID=$!
trap 'kill $SERVER_PID $APP_PID 2>/dev/null; exit 0' INT TERM

sleep 3
echo ""
echo "TeleGlance is running."
echo "  Server:            http://$IP:8787/health"
echo "  App on this Mac:   http://localhost:5173"
echo "  App for G2 (same Wi-Fi):  cd app && npx evenhub qr --url http://$IP:5173"
echo "  Simulator:         npx evenhub-simulator http://localhost:5173"
echo "Press Ctrl+C to stop."
wait
