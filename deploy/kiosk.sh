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
