#!/bin/bash
# Fullscreen kiosk browser pointed at DJBoard's read-only Display mode.
# Launched from ~/.xinitrc — see deploy/README.md for the full setup.
set -u

# disable screen blanking / power management so the TV doesn't go dark
xset s off
xset s noblank
xset -dpms

# hide the mouse cursor when idle (harmless if no mouse is attached)
command -v unclutter >/dev/null && unclutter -idle 0.5 -root &

CHROMIUM=$(command -v chromium-browser || command -v chromium)
URL="http://localhost:3113/display.html"

# if the server has AUTH_PASSWORD set, pass KIOSK_TOKEN (same .env file) so
# this kiosk lands straight on the display instead of the login page —
# --incognito below wipes cookies on every relaunch, so a real login
# wouldn't stick anyway.
ENV_FILE="$HOME/djboard/.env"
if [ -f "$ENV_FILE" ]; then
  KIOSK_TOKEN=$(grep -m1 '^KIOSK_TOKEN=' "$ENV_FILE" | cut -d= -f2-)
  [ -n "${KIOSK_TOKEN:-}" ] && URL="${URL}?kiosk=${KIOSK_TOKEN}"
fi

if [ -z "$CHROMIUM" ]; then
  echo "No chromium binary found (looked for chromium-browser and chromium)" >&2
  exit 1
fi

# wait for the DJBoard server to actually answer before pointing the browser at it
until curl -s -o /dev/null "$URL"; do
  sleep 1
done

# relaunch the browser if it ever crashes or gets closed
while true; do
  "$CHROMIUM" \
    --kiosk \
    --noerrdialogs \
    --disable-infobars \
    --disable-session-crashed-bubble \
    --disable-translate \
    --no-first-run \
    --check-for-update-interval=31536000 \
    --incognito \
    "$URL"
  sleep 2
done
