#!/usr/bin/python3
"""Append only the Arbestra sites to the existing gateway; validate before reload."""
import datetime
from pathlib import Path
import re
import subprocess

import sites as hosts


def main():
    path = Path('/opt/gateway/caddy/Caddyfile')
    before = path.read_text()
    start, end = '# BEGIN ARBESTRA NATIVE', '# END ARBESTRA NATIVE'
    if (start in before) != (end in before):
        raise ValueError('Unbalanced Arbestra marker')
    sites = []
    # One host per world: rerun after opening a world (open-rc1-world.py).
    for environment, settings in hosts.ENVIRONMENTS.items():
        domains = hosts.gateway_hosts(environment, hosts.world_slugs(environment))
        sites.append(', '.join(domains) + ' {\n  reverse_proxy 172.18.0.1:' + str(settings['port'] + 1) + '\n}\n')
    block = start + '\n' + '\n'.join(sites) + end
    after = re.sub(re.escape(start) + r'.*?' + re.escape(end), lambda _: block, before, flags=re.S) if start in before else before.rstrip() + '\n\n' + block + '\n'
    if after == before:
        print('Gateway already configured.')
        return
    backup = path.with_name('Caddyfile.pre-arbestra-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S'))
    backup.write_text(before)
    backup.chmod(0o600)
    # Keep inode: the running gateway has this file bind-mounted read-only.
    path.write_text(after)
    base = ['docker', 'exec', 'wai-gateway-caddy-1', 'caddy']
    try:
        subprocess.run([*base, 'validate', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'], check=True)
        subprocess.run([*base, 'reload', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'], check=True)
    except Exception:
        path.write_text(before)
        subprocess.run([*base, 'reload', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'], check=True)
        raise
    print('Arbestra gateway configured; existing sites preserved.')


if __name__ == '__main__':
    main()
