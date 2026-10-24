#!/usr/bin/python3
"""Serve each world on its own subdomain; move staging to arbestra.fr.

  hosts <environment>  rewrite the environment's web Caddyfile from
                       ops/deploy/sites.py (gate hash kept), then add every
                       world host to the shared gateway.
  env <environment>    set COOKIE_DOMAIN, ADMIN_ORIGIN and WORLD_ORIGIN; needs a
                       release whose API accepts a {world} origin template.

Run as root on the VPS from a directory holding this file, sites.py and
configure-gateway.py. Idempotent; each file is backed up, validated and
restored if the restart fails.
"""
import datetime
import json
from pathlib import Path
import re
import runpy
import shutil
import subprocess
import sys

import sites

CONFIG = Path('/etc/arbestra')
STAMP = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S')


def replace(path, text, check, service):
    before = path.read_text()
    if before == text:
        print(path, 'already up to date')
        return
    backup = path.with_name(path.name + '.pre-world-hosts-' + STAMP)
    shutil.copy2(path, backup)
    backup.chmod(0o600)
    # Keep inode, owner and mode.
    path.write_text(text)
    try:
        if check:
            subprocess.run(check, check=True)
        subprocess.run(['systemctl', 'restart', service], check=True)
    except Exception:
        path.write_text(before)
        subprocess.run(['systemctl', 'restart', service], check=False)
        raise
    print(path, 'updated; backup', backup)


def web(environment):
    path = CONFIG / (environment + '.Caddyfile')
    hashes = re.findall(r'^    arbestra (\S+)$', path.read_text(), flags=re.M)
    if len(hashes) != 1:
        raise ValueError(environment + ': expected exactly one gate hash')
    validate = ['/usr/local/bin/arbestra-caddy', 'validate', '--config', str(path), '--adapter', 'caddyfile']
    replace(path, sites.web_caddyfile(environment, hashes[0]), validate, 'arbestra-web@' + environment)
    runpy.run_path(str(Path(__file__).with_name('configure-gateway.py')))['main']()


def env(environment):
    path = CONFIG / (environment + '.env')
    lines, wanted = path.read_text().splitlines(), sites.environment_settings(environment)
    seen = set()
    for index, line in enumerate(lines):
        key = line.split('=', 1)[0]
        if key in wanted:
            lines[index] = key + '=' + wanted[key]
            seen.add(key)
    lines += [key + '=' + value for key, value in wanted.items() if key not in seen]
    replace(path, '\n'.join(lines) + '\n', None, 'arbestra-api@' + environment)
    access_file = CONFIG / 'private-access.json'
    access = json.loads(access_file.read_text())
    names = sites.hosts(environment)
    access[environment].update(lobby='https://' + names['lobby'], noc='https://' + names['noc'])
    access_file.write_text(json.dumps(access, indent=2) + '\n')
    print(environment, 'origins set for', sites.ENVIRONMENTS[environment]['domain'])


if __name__ == '__main__':
    command, environment = sys.argv[1:3]
    if environment not in sites.ENVIRONMENTS:
        raise ValueError('Unknown environment')
    {'hosts': web, 'env': env}[command](environment)
