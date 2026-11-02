#!/usr/bin/env bash
set -euo pipefail
gnome-extensions disable vsphere-desktop-widget@local 2>/dev/null || true
systemctl --user disable --now vsphere-desktop-widget.service 2>/dev/null || true
rm -f "$HOME/.config/systemd/user/vsphere-desktop-widget.service"
systemctl --user daemon-reload
rm -rf "$HOME/.local/share/vsphere-desktop-widget" "$HOME/.local/share/gnome-shell/extensions/vsphere-desktop-widget@local" "$HOME/.cache/vsphere-desktop-widget"
echo 'App removed. Credentials kept in ~/.config/vsphere-desktop-widget/config.json; delete that manually if desired.'
