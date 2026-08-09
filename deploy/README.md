# Raspberry Pi kiosk setup

Runs DJBoard as a systemd service and shows its read-only `display.html` on
a TV connected via HDMI, in a minimal X session that starts automatically on
boot — no desktop environment required, no smart-TV browser involved (the Pi
is the computer; the TV is just a monitor).

This approach is deliberately desktop-environment-agnostic: Raspberry Pi OS
has switched window managers/compositors across releases (LXDE on X11,
wayfire/labwc on Wayland), which changes where autostart files live. Booting
straight to a console and starting a bare X session with `startx` sidesteps
all of that.

## 1. Get DJBoard running as a service

```bash
git clone <your repo url> ~/djboard
cd ~/djboard
npm install
cp .env.example .env   # fill in AUTH_PASSWORD if wanted

# edit User= and WorkingDirectory= in djboard.service to match your setup,
# and confirm the node path with: which node
sudo cp deploy/djboard.service /etc/systemd/system/djboard.service
sudo systemctl daemon-reload
sudo systemctl enable --now djboard.service

# confirm it's up
curl http://localhost:3113/api/notes
```

## 2. Install a minimal X session + Chromium

```bash
sudo apt update
sudo apt install --no-install-recommends xserver-xorg xinit x11-xserver-utils unclutter chromium-browser
# on some Raspberry Pi OS versions the package is just "chromium" instead —
# if the chromium-browser install fails, use: sudo apt install chromium
```

## 3. Wire up the kiosk script

```bash
chmod +x ~/djboard/deploy/kiosk.sh
cp ~/djboard/deploy/xinitrc ~/.xinitrc
chmod +x ~/.xinitrc
```

Add this to the end of `~/.bash_profile` (create it if it doesn't exist) so
`startx` runs automatically on console login, but only on the physical
console (tty1) — not over SSH:

```bash
if [ -z "$DISPLAY" ] && [ "$(tty)" = "/dev/tty1" ]; then
  startx -- -nocursor
fi
```

## 4. Enable console autologin

```bash
sudo raspi-config nonint do_boot_behaviour B2
```

Or via the menu: `sudo raspi-config` → **System Options** → **Boot / Auto
Login** → **Console Autologin**.

## 5. Reboot

```bash
sudo reboot
```

The Pi should boot straight to a fullscreen, auto-refreshing DJBoard display.
`djboard.service` restarts on crash/reboot; the kiosk script's own `while`
loop relaunches Chromium if it ever closes.

## Editing notes

The TV only ever shows the read-only display. To add/edit notes, open
`http://<pi-ip-address>:3113/` from your phone or laptop on the same network
(or over Tailscale if you want that reachable away from home too).
