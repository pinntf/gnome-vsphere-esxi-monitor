#!/usr/bin/env python3
"""CLI to manage vCenter connection and ESXi host selection."""
import argparse
import getpass
import json
import os
from pathlib import Path
import subprocess
import sys

PATH = Path.home() / '.config/vsphere-desktop-widget/config.json'
SERVICE = 'vsphere-desktop-widget.service'

def load():
    if not PATH.exists():
        return {}
    return json.loads(PATH.read_text())

def save(cfg):
    PATH.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(PATH.parent, 0o700)
    tmp = PATH.with_suffix('.tmp')
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as f:
        json.dump(cfg, f, indent=2)
        f.write('\n')
    os.replace(tmp, PATH)
    os.chmod(PATH, 0o600)

def restart():
    subprocess.run(['systemctl', '--user', 'try-restart', SERVICE], check=False)

def main():
    parser = argparse.ArgumentParser(description='Manage GNOME vSphere ESXi Monitor')
    sub = parser.add_subparsers(dest='cmd', required=True)
    sub.add_parser('setup', help='Configure vCenter connection')
    sub.add_parser('list', help='List host selection and connection (no password)')
    add = sub.add_parser('add', help='Add an ESXi host to display filter')
    add.add_argument('hostname', help='Exact ESXi host name shown in vCenter')
    remove = sub.add_parser('remove', help='Remove a host from display filter')
    remove.add_argument('hostname')
    sub.add_parser('all', help='Display all ESXi hosts discovered in vCenter')
    interval = sub.add_parser('interval', help='Change poll interval (min 20 seconds)')
    interval.add_argument('seconds', type=int)
    args = parser.parse_args()
    cfg = load()
    if args.cmd == 'setup':
        cfg['host'] = input(f"vCenter IP or DNS [{cfg.get('host', '')}]: ").strip() or cfg.get('host', '')
        cfg['user'] = input(f"vCenter username [{cfg.get('user', 'monitor@vsphere.local')}]: ").strip() or cfg.get('user', 'monitor@vsphere.local')
        cfg['password'] = getpass.getpass('vCenter password (leave blank to retain existing): ') or cfg.get('password', '')
        verify = input('Verify vCenter TLS certificate? [Y/n]: ').strip().lower()
        cfg['insecure'] = verify == 'n'
        cfg.setdefault('interval', 30)
        cfg.setdefault('hosts', [])
        if not cfg['host'] or not cfg['password'] or '://' in cfg['host']:
            parser.error('vCenter IP/DNS (without URL scheme) and password are required')
    elif args.cmd == 'list':
        if not cfg:
            print('Not configured. Run: vsphere-widget setup')
            return
        print(f"vCenter: {cfg.get('host', '(unset)')} | User: {cfg.get('user', '(unset)')} | Poll: {cfg.get('interval', 30)}s")
        print('ESXi display filter:')
        for host in cfg.get('hosts', []):
            print(' -', host)
        if not cfg.get('hosts'):
            print(' All hosts (automatically discovered)')
        for host in cfg.get('excluded_hosts', []):
            print(' Hidden:', host)
        return
    elif args.cmd == 'add':
        exclusions = cfg.get('excluded_hosts', [])
        cfg['excluded_hosts'] = [x for x in exclusions if x.lower() != args.hostname.lower()]
        # If using an explicit inclusion filter, add the requested host.
        if cfg.get('hosts') and args.hostname.lower() not in [x.lower() for x in cfg['hosts']]:
            cfg['hosts'].append(args.hostname)
        print('Host enabled (vCenter must contain this host):', args.hostname)
    elif args.cmd == 'remove':
        cfg['hosts'] = [x for x in cfg.get('hosts', []) if x.lower() != args.hostname.lower()]
        excluded = cfg.setdefault('excluded_hosts', [])
        if args.hostname.lower() not in [x.lower() for x in excluded]:
            excluded.append(args.hostname)
        print('Host hidden:', args.hostname)
    elif args.cmd == 'all':
        cfg['hosts'] = []
        cfg['excluded_hosts'] = []
    elif args.cmd == 'interval':
        if args.seconds < 20:
            parser.error('Interval must be >= 20 seconds')
        cfg['interval'] = args.seconds
    save(cfg)
    restart()
    print('Configuration saved:', PATH)

if __name__ == '__main__':
    main()
