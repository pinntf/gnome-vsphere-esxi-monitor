# GNOME vSphere ESXi Monitor

A draggable GNOME desktop widget for **physical ESXi host monitoring via vCenter**, not virtual machine monitoring. Displays CPU and RAM load, memory usage, host connectivity, CPU temperatures (when supported by hardware sensors), and fan/power-supply health.

## Requirements

- GNOME Shell 46–50 (declared extension versions; check compatibility on your installation)
- Linux, Python 3 with `venv`, `pip`, user-level systemd
- Access to VMware vCenter with read-only inventory and host metrics permissions
- Trusted vCenter TLS certificate recommended

### Dependencies

```bash
# Ubuntu / Debian
sudo apt install python3 python3-venv python3-pip
# Fedora
sudo dnf install python3 python3-pip
# Arch Linux
sudo pacman -S python python-pip
```

## Install

```bash
git clone git@github.com:pinntf/gnome-vsphere-esxi-monitor.git
cd gnome-vsphere-esxi-monitor
bash install.sh
```

The installer prompts for the vCenter IP/DNS, vCenter username, password, and TLS certificate verification preference. Run as your **regular desktop user**, not with sudo. It automatically discovers physical ESXi hosts from vCenter. You do not have to enter each host's IP during installation. Existing settings are retained on upgrade.

Enable the extension after logging out and back in if necessary:

```bash
gnome-extensions enable vsphere-desktop-widget@local
```

## Manage vCenter and hosts

```bash
~/.local/bin/vsphere-widget setup           # Change vCenter connection/credentials
~/.local/bin/vsphere-widget list            # Show settings and host selection
~/.local/bin/vsphere-widget remove esxi-01  # Hide an ESXi host
~/.local/bin/vsphere-widget add esxi-01     # Show a previously hidden host
~/.local/bin/vsphere-widget all             # Show all vCenter hosts
~/.local/bin/vsphere-widget interval 30     # Poll every 30 seconds (minimum 20)
```

Host names must match names reported by vCenter. Newly added ESXi hosts in vCenter appear automatically unless hidden. You can also manually edit the configuration and restart the service.

Configuration: `~/.config/vsphere-desktop-widget/config.json` (mode `0600`)

Widget position: `~/.config/vsphere-desktop-widget/position.json`

Metrics cache: `~/.cache/vsphere-desktop-widget/hosts.json`

User service: `~/.config/systemd/user/vsphere-desktop-widget.service`

## Service and logs

```bash
systemctl --user status vsphere-desktop-widget.service
systemctl --user restart vsphere-desktop-widget.service
journalctl --user -u vsphere-desktop-widget.service -f
```

## Remove

```bash
bash uninstall.sh
```

Uninstall preserves your vCenter credentials and widget position for reinstallations. For a **full reset**, also delete `~/.config/vsphere-desktop-widget` manually after uninstalling.

## Security

Credentials are stored locally in a file readable by your user (`0600`), **not encrypted at rest**. Keep this file out of Git. Prefer a dedicated read-only vCenter account and a trusted TLS certificate. Disabling TLS verification exposes the connection to interception; use only for isolated testing.

## Notes

- Physical hosts are enumerated through vCenter; host discovery is automatic.
- Hardware sensor availability depends on server, ESXi and management instrumentation.
- Temperature colors use **generic display thresholds**, not CPU model-specific safe operating limits. Validate limits for your hardware before relying on alerts.
- GNOME desktop widget appears behind normal windows and can be dragged; its position is retained.
- The extension accesses only cached metrics, never the vCenter password.
- Original system service, extension UUID and directory names are preserved to support upgrades.
