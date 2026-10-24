"""Public host names of each Arbestra environment.

Each world is served on its own subdomain, named after its slug
(alpha.arbestra.world, staging.arbestra.fr); the lobby and the NOC take reserved labels. Shared
by the bootstrap, the gateway configuration and the host repairs.
"""
import re
import subprocess

ENVIRONMENTS = {
    'alpha': {
        'port': 3100,
        'domain': 'arbestra.world',
        'legacy_world': 'alpha.arbestra.world',
        # The world was named alpha-rc1 until 24 October.
        'redirects': {'alpha-rc1.arbestra.world': 'alpha.arbestra.world'},
    },
    'staging': {
        'port': 3200,
        'domain': 'arbestra.fr',
        # Former staging hosts, before staging moved to its own domain.
        'legacy_world': 'beta.arbestra.world',
        'redirects': {
            'play-beta.arbestra.world': 'play.arbestra.fr',
            'noc-beta.arbestra.world': 'noc.arbestra.fr',
            'beta-rc1.arbestra.fr': 'staging.arbestra.fr',
        },
    },
}
# Labels a world slug can never take: they name other sites.
RESERVED = {'play', 'noc', 'www', 'api', 'beta', 'play-beta', 'noc-beta', 'start'}
SLUG = re.compile(r'[a-z0-9]+(?:-[a-z0-9]+)*')


def hosts(environment):
    domain = ENVIRONMENTS[environment]['domain']
    return {'lobby': 'play.' + domain, 'noc': 'noc.' + domain, 'world': '{world}.' + domain}


def world_host(environment, slug):
    if not SLUG.fullmatch(slug) or len(slug) > 63 or slug in RESERVED:
        raise ValueError('World slug cannot be a host name: ' + slug)
    return slug + '.' + ENVIRONMENTS[environment]['domain']


def world_slugs(environment):
    """Read as postgres on the VPS; the slugs come from the environment's database."""
    output = subprocess.check_output(
        ['runuser', '-u', 'postgres', '--', 'psql', '-d', 'arbestra_' + environment, '-Atc', 'SELECT slug FROM worlds ORDER BY slug'],
        text=True,
    )
    return [slug for slug in output.split() if not slug.startswith('candidate-')]


def gateway_hosts(environment, slugs):
    """Every name the shared gateway must terminate TLS for."""
    names = [*hosts(environment).values()][:2]
    names += [world_host(environment, slug) for slug in slugs]
    names += [ENVIRONMENTS[environment]['legacy_world'], *ENVIRONMENTS[environment]['redirects']]
    # The alpha world now owns the former shared host.
    return list(dict.fromkeys(names))


WEB_TEMPLATE = '''{
  auto_https off
  admin off
  servers {
    trusted_proxies static 172.18.0.3/32
    trusted_proxies_strict
    client_ip_headers X-Forwarded-For
  }
}
http://:WEB_PORT {
  bind 172.18.0.1
  basic_auth @noc {
    arbestra GATE_HASH
  }
  header {
    X-Robots-Tag "noindex, nofollow"
    X-Content-Type-Options nosniff
    Referrer-Policy same-origin
    Cache-Control "private, no-store"
    -Server
  }
  encode zstd gzip
  # The lobby, the NOC and every world page are subdomains of one domain; the
  # former shared host still loads its scripts (modules send Origin) to redirect.
  @foreignOrigin {
    header Origin *
    not header_regexp Origin ^https://([a-z0-9-]+\\.DOMAIN_PATTERN|LEGACY_PATTERN)$
  }
  # Cross-site calls are refused on the API only: a player following a link
  # (Discord, search engine) must still load the pages.
  @crossSite {
    header Sec-Fetch-Site cross-site
    path /api/*
  }
  @adminOnPlayer {
    path /api/admin /api/admin/*
    not host NOC
  }
  @lobby host LOBBY
  @noc host NOC
  # A world host, or the former shared host whose client redirects ?world=.
  @world host *.DOMAIN LEGACY_WORLD
  route {
  respond @foreignOrigin 403
  respond @crossSite 403
  respond @adminOnPlayer 404
REDIRECTS  handle /api/* {
    reverse_proxy 127.0.0.1:API_PORT {
      header_up X-Forwarded-Proto https
      header_up X-Forwarded-Host {http.request.host}
      header_up X-Forwarded-For {client_ip}
      header_up -Authorization
      flush_interval -1
    }
  }
  handle @lobby {
    root * /srv/arbestra/ENVIRONMENT/current/web/play
    try_files {path} /index.html
    file_server
  }
  handle @noc {
    root * /srv/arbestra/ENVIRONMENT/current/web/admin
    try_files {path} /index.html
    file_server
  }
  handle @world {
    # Allows the JS Self-Profiling API (in-page profiles of the 3D client).
    header Document-Policy js-profiling
    root * /srv/arbestra/ENVIRONMENT/current/web/world
    try_files {path} /index.html
    file_server
  }
  handle {
    respond 404
  }
  }
}
'''


def web_caddyfile(environment, gate_hash):
    settings, names = ENVIRONMENTS[environment], hosts(environment)
    redirects = ''
    for index, (old, new) in enumerate(settings['redirects'].items()):
        redirects += f'  @moved{index} host {old}\n  redir @moved{index} https://{new}{{uri}} permanent\n'
    config = WEB_TEMPLATE
    for old, new in [
        ('WEB_PORT', str(settings['port'] + 1)),
        ('API_PORT', str(settings['port'])),
        ('GATE_HASH', gate_hash),
        ('ENVIRONMENT', environment),
        ('LOBBY', names['lobby']),
        ('NOC', names['noc']),
        ('LEGACY_WORLD', settings['legacy_world']),
        ('DOMAIN_PATTERN', re.escape(settings['domain'])),
        ('LEGACY_PATTERN', re.escape(settings['legacy_world'])),
        ('DOMAIN', settings['domain']),
        ('REDIRECTS', redirects),
    ]:
        config = config.replace(old, new)
    return config


def environment_settings(environment):
    """Host-dependent keys of /etc/arbestra/<environment>.env."""
    names = hosts(environment)
    return {
        'COOKIE_DOMAIN': '.' + ENVIRONMENTS[environment]['domain'],
        'ADMIN_ORIGIN': 'https://' + names['noc'],
        'WORLD_ORIGIN': 'https://' + names['world'],
    }
