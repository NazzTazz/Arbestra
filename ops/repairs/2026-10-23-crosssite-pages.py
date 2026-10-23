#!/usr/bin/python3
"""Let players open Arbestra pages from a link on another site.

The per-environment web Caddyfile refused every request carrying
Sec-Fetch-Site: cross-site, page navigations included (403 when following a
Discord or search-engine link). Restrict that rule to /api/*, as the bootstrap
template now does. Idempotent; backs up, validates, reloads, and restores the
previous file if validation or reload fails.

Run as root on the VPS:  python3 2026-10-23-crosssite-pages.py
"""
import datetime
from pathlib import Path
import subprocess

OLD = '  @crossSite header Sec-Fetch-Site cross-site\n'
NEW = (
    '  # Cross-site calls are refused on the API only: a player following a link\n'
    '  # (Discord, search engine) must still load the pages.\n'
    '  @crossSite {\n'
    '    header Sec-Fetch-Site cross-site\n'
    '    path /api/*\n'
    '  }\n'
)


def main():
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S')
    for environment in ('staging', 'alpha'):
        path = Path('/etc/arbestra') / (environment + '.Caddyfile')
        before = path.read_text()
        if NEW in before:
            print(environment, 'already restricted to /api/*')
            continue
        if before.count(OLD) != 1:
            raise ValueError(environment + ': expected exactly one cross-site rule')
        backup = path.with_name(path.name + '.pre-crosssite-' + stamp)
        backup.write_text(before)
        backup.chmod(0o600)
        path.write_text(before.replace(OLD, NEW))
        try:
            subprocess.run(['/usr/local/bin/arbestra-caddy', 'validate', '--config', str(path), '--adapter', 'caddyfile'], check=True)
            subprocess.run(['systemctl', 'restart', 'arbestra-web@' + environment], check=True)
        except Exception:
            path.write_text(before)
            subprocess.run(['systemctl', 'restart', 'arbestra-web@' + environment], check=False)
            raise
        print(environment, 'cross-site rule restricted to /api/*; backup', backup)


if __name__ == '__main__':
    main()
