#!/usr/bin/env python3
"""Read physical ESXi host metrics from vCenter and atomically write a JSON cache."""
import json
import os
import ssl
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from pyVim.connect import SmartConnect, Disconnect
from pyVmomi import vim

BASE = Path.home() / '.config' / 'vsphere-desktop-widget'
CONFIG = BASE / 'config.json'
CACHE = Path.home() / '.cache' / 'vsphere-desktop-widget' / 'hosts.json'


def write_cache(payload):
    CACHE.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    target = CACHE.with_suffix('.tmp')
    with target.open('w', encoding='utf-8') as stream:
        json.dump(payload, stream, ensure_ascii=False)
    os.chmod(target, 0o600)
    os.replace(target, CACHE)



def _sensor_values(host):
    """Retrieve optional ESXi hardware sensors; never infer OK when unavailable."""
    health = host.runtime.healthSystemRuntime
    info = health.systemHealthInfo if health else None
    return getattr(info, 'numericSensorInfo', None) or []


def read_hardware(host):
    import re
    cpu = {}
    health = {'fans': 'unknown', 'power': 'unknown'}
    groups = {'fans': [], 'power': []}
    try:
        sensors = _sensor_values(host)
        for sensor in sensors:
            name = str(getattr(sensor, 'name', '') or '')
            kind = str(getattr(sensor, 'sensorType', '') or '').lower()
            units = str(getattr(sensor, 'baseUnits', '') or '').lower()
            lname = name.lower()
            unit_key = units.replace(' ', '').replace('_', '').replace('-', '')
            if ('temperature' in kind or 'temp' in lname) and (
                'celsius' in unit_key or unit_key in ('degreec','degreesc','degc','°c')
            ):
                match = re.search(r'(?:processor\s*(\d+)|\bcpu\s*(\d+))', lname)
                if match:
                    reading = getattr(sensor, 'currentReading', None)
                    modifier = getattr(sensor, 'unitModifier', 0)
                    if reading is not None and modifier is not None:
                        val = float(reading) * 10 ** int(modifier)
                        if -20 <= val <= 130:
                            num = int(next(x for x in match.groups() if x is not None))
                            cpu[num] = max(val, cpu.get(num, -999))
            if 'fan' in kind or 'fan' in lname:
                groups['fans'].append(sensor)
            if 'power' in kind or any(x in lname for x in ('psu', 'power supply')):
                groups['power'].append(sensor)
        for key, items in groups.items():
            if not items:
                continue
            states = [str(getattr(getattr(item, 'healthState', None), 'key', '') or '').lower()
                      for item in items]
            if any(x in ('red', 'yellow') for x in states):
                health[key] = 'critical' if 'red' in states else 'warning'
            elif states and all(x == 'green' for x in states):
                health[key] = 'ok'
            else:
                health[key] = 'unknown'
    except Exception:
        pass
    return {f'cpu{i}_temp_c': round(cpu[i], 1) if i in cpu else None for i in (1,2)}, health


def fetch(cfg):
    if cfg.get('insecure', False):
        ctx = ssl._create_unverified_context()
    else:
        ctx = ssl.create_default_context(cafile=cfg.get('ca_file') or None)
    si = SmartConnect(host=cfg['host'], user=cfg['user'], pwd=cfg['password'], sslContext=ctx)
    try:
        content = si.RetrieveContent()
        view = content.viewManager.CreateContainerView(content.rootFolder, [vim.HostSystem], True)
        try:
            hosts = list(view.view)
        finally:
            view.Destroy()
        output = []
        for host in hosts:
            try:
                summary = host.summary
                state = str(summary.runtime.connectionState).split('.')[-1]
                hw, stats = summary.hardware, summary.quickStats
                cpu_total = hw.cpuMhz * hw.numCpuCores if hw else None
                cpu_used = stats.overallCpuUsage if stats else None
                memory_total = hw.memorySize / 1048576 if hw else None
                memory_used = stats.overallMemoryUsage if stats else None
                cpu_pct = round(100 * cpu_used / cpu_total, 1) if cpu_used is not None and cpu_total else None
                ram_pct = round(100 * memory_used / memory_total, 1) if memory_used is not None and memory_total else None
                temps, hardware_health = read_hardware(host) if state == 'connected' else ({'cpu1_temp_c': None, 'cpu2_temp_c': None}, {'fans': 'unknown', 'power': 'unknown'})
                cpu_temp = max((v for v in temps.values() if v is not None), default=None)
                output.append(dict(name=host.name, state=state, cpu=cpu_pct, ram=ram_pct,
                                   cpu_temp_c=cpu_temp, **temps, hardware_health=hardware_health,
                                   ram_used_gb=round(memory_used / 1024, 1) if memory_used is not None else None,
                                   ram_total_gb=round(memory_total / 1024, 1) if memory_total else None,
                                   cores=hw.numCpuCores if hw else None))
            except Exception as exc:
                output.append(dict(name=host.name, state='error', cpu=None, ram=None, error=str(exc)))
        selected = cfg.get('hosts', [])
        if selected:
            allowed = {str(x).lower() for x in selected}
            output = [item for item in output if item['name'].lower() in allowed]
        excluded = {str(x).lower() for x in cfg.get('excluded_hosts', [])}
        output = [item for item in output if item['name'].lower() not in excluded]
        return sorted(output, key=lambda x: x['name'].lower())
    finally:
        Disconnect(si)


def main():
    while True:
        try:
            cfg = json.loads(CONFIG.read_text(encoding='utf-8'))
            hosts = fetch(cfg)
            write_cache(dict(updated=datetime.now(timezone.utc).isoformat(), hosts=hosts, error=None))
            interval = max(20, int(cfg.get('interval', 30)))
        except Exception as exc:
            print(f'vSphere polling error: {exc}', file=sys.stderr, flush=True)
            # Do not display outdated measurements as live after a failed poll.
            write_cache(dict(updated=datetime.now(timezone.utc).isoformat(), hosts=[], error=str(exc)))
            interval = 30
        time.sleep(interval)


if __name__ == '__main__':
    main()
