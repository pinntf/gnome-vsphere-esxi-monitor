#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
APP="$HOME/.local/share/vsphere-desktop-widget"
CONFIG="$HOME/.config/vsphere-desktop-widget"
EXT="$HOME/.local/share/gnome-shell/extensions/vsphere-desktop-widget@local"
UNIT="$HOME/.config/systemd/user/vsphere-desktop-widget.service"
if [ "$(id -u)" -eq 0 ]; then echo 'Run as your normal desktop user, not root.' >&2; exit 1; fi
command -v python3 >/dev/null || { echo 'Python 3 is required'; exit 1; }
mkdir -p "$APP" "$CONFIG" "$(dirname "$UNIT")" "$EXT" "$HOME/.local/bin"
chmod 700 "$CONFIG"
python3 -m venv "$APP/venv"
"$APP/venv/bin/python" -m pip install --upgrade pyvmomi
install -m 700 "$ROOT/collector.py" "$APP/collector.py"
install -m 700 "$ROOT/vsphere-widget.py" "$HOME/.local/bin/vsphere-widget"
cp "$ROOT/extension/"* "$EXT/"
if [ ! -s "$CONFIG/config.json" ]; then
  "$HOME/.local/bin/vsphere-widget" setup
else
  echo "Existing vCenter configuration preserved: $CONFIG/config.json"
fi
cat > "$UNIT" <<EOF
[Unit]
Description=vSphere ESXi Desktop Widget Metrics Collector
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=$APP/venv/bin/python $APP/collector.py
Restart=always
RestartSec=15

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now vsphere-desktop-widget.service
systemctl --user restart vsphere-desktop-widget.service
printf '\nEnable the GNOME extension: gnome-extensions enable vsphere-desktop-widget@local\n'
printf 'Log out and back in if the extension is not detected.\n'
