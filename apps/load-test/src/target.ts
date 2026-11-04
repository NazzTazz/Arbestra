/** Guards of every load-test script (docs/TEST-DE-CHARGE.md §6). A script
 * refuses to run without an explicit `--target local|staging|dedicated`;
 * staging needs a confirmation flag and a dedicated variable naming the
 * world(s); a dedicated test machine needs its own flag and a variable naming
 * its host; nothing may ever designate the alpha (its name, its database or
 * its API port), and a dedicated machine never designates staging either.
 * Pure: the caller passes the URLs and the environment. */
export type LoadTarget = 'local' | 'staging' | 'dedicated';

export class LoadTargetRefused extends Error {}

/** The dedicated variable of a staging run: it must name the targeted world,
 * or list them (comma-separated) when several worlds are played at once. */
export const STAGING_VARIABLE = 'ARBESTRA_LOAD_STAGING';
export const STAGING_CONFIRM_FLAG = '--confirm-staging';
/** A dedicated test machine: the variable must name the host of its API. */
export const DEDICATED_VARIABLE = 'ARBESTRA_LOAD_DEDICATED_HOST';
export const DEDICATED_CONFIRM_FLAG = '--confirm-dedicated';
/** Public domains of the real environments: never a dedicated machine. */
const PRODUCTION_DOMAINS = ['arbestra.world', 'arbestra.fr'];
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
/** VPS layout (docs/DEPLOIEMENT-VPS.md): alpha API on 3100, staging on 3200. */
const ALPHA_API_PORT = '3100';
const STAGING_API_PORT = '3200';
/** The PO's own `pnpm dev` API: never a load-test target. */
const DEV_API_PORT = '3000';
const STAGING_DATABASE = 'arbestra_staging';
const STAGING_HOST = 'staging.arbestra.fr';

export interface TargetInput {
  target: string | undefined;
  databaseUrl?: string | undefined;
  baseUrl?: string | undefined;
  worldSlug?: string | undefined;
  confirmStaging?: boolean;
  confirmDedicated?: boolean;
  env: Readonly<Record<string, string | undefined>>;
}
export interface CheckedTarget {
  target: LoadTarget;
  database?: { host: string; name: string };
  api?: { origin: string };
}

function parse(kind: string, value: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new LoadTargetRefused(`${kind} invalide.`);
  }
}
const mentionsAlpha = (value: string) => {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    /* keep the raw text */
  }
  return /alpha/i.test(value) || /alpha/i.test(decoded);
};
const mentionsStaging = (value: string) => {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    /* keep the raw text */
  }
  return /staging/i.test(value) || /staging/i.test(decoded);
};
const portOf = (url: URL) => url.port || (url.protocol === 'https:' ? '443' : '80');

export function checkTarget(input: TargetInput): CheckedTarget {
  const target = input.target;
  if (target !== 'local' && target !== 'staging' && target !== 'dedicated')
    throw new LoadTargetRefused('Cible obligatoire : --target local, --target staging ou --target dedicated.');
  for (const [label, value] of [
    ['La base', input.databaseUrl],
    ["L'API", input.baseUrl],
    ['Le monde', input.worldSlug],
  ] as const)
    if (value !== undefined && mentionsAlpha(value))
      throw new LoadTargetRefused(`${label} désigne l'alpha : refusé, le test de charge ne vise jamais l'alpha.`);
  if (target === 'dedicated')
    for (const [label, value] of [
      ['La base', input.databaseUrl],
      ["L'API", input.baseUrl],
      ['Le monde', input.worldSlug],
    ] as const)
      if (value !== undefined && mentionsStaging(value))
        throw new LoadTargetRefused(`${label} désigne le staging : refusé, une machine dédiée n'est pas le staging.`);
  const result: CheckedTarget = { target };
  if (input.databaseUrl !== undefined) {
    const url = parse('URL de base', input.databaseUrl);
    if (!/^postgres(ql)?:$/.test(url.protocol)) throw new LoadTargetRefused('La base doit être une URL PostgreSQL.');
    const name = decodeURIComponent(url.pathname.slice(1));
    if (!LOOPBACK.has(url.hostname))
      throw new LoadTargetRefused('La base doit être locale à la machine qui lance le script (127.0.0.1).');
    if (target === 'local' && !/^[a-z0-9_]+_load(_test)?$/.test(name))
      throw new LoadTargetRefused(
        `Base locale « ${name} » refusée : utilisez une base dédiée suffixée _load (arbestra_load), jamais la base de développement ni celle des tests.`,
      );
    if (target === 'dedicated' && !/^[a-z0-9_]+_load$/.test(name))
      throw new LoadTargetRefused(
        `Cible dédiée : base « ${name} » refusée ; utilisez une base suffixée _load (arbestra_load) créée pour le test.`,
      );
    if (target === 'staging' && name !== STAGING_DATABASE)
      throw new LoadTargetRefused(`Cible staging : la base doit être ${STAGING_DATABASE}, pas « ${name} ».`);
    result.database = { host: url.hostname, name };
  }
  if (input.baseUrl !== undefined) {
    const url = parse("URL de l'API", input.baseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
      throw new LoadTargetRefused("L'API doit être une URL HTTP(S).");
    if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== ''))
      throw new LoadTargetRefused("L'URL de l'API est une origine, sans identifiants, chemin ni paramètres.");
    const loopback = LOOPBACK.has(url.hostname),
      port = portOf(url);
    if (loopback && port === ALPHA_API_PORT)
      throw new LoadTargetRefused(`Le port ${ALPHA_API_PORT} est celui de l'API alpha sur le VPS : refusé.`);
    if (target === 'local') {
      if (!loopback) throw new LoadTargetRefused('Cible locale : API sur 127.0.0.1 uniquement.');
      if (port === DEV_API_PORT)
        throw new LoadTargetRefused(
          `Le port ${DEV_API_PORT} est celui du « pnpm dev » du PO : lancez une API dédiée (par exemple sur 3300).`,
        );
      if (port === STAGING_API_PORT)
        throw new LoadTargetRefused(`Le port ${STAGING_API_PORT} est celui du staging : utilisez --target staging.`);
    } else if (target === 'dedicated') {
      if (loopback && (port === STAGING_API_PORT || port === DEV_API_PORT))
        throw new LoadTargetRefused(
          `Le port ${port} est celui du staging ou du pnpm dev : refusé pour une cible dédiée.`,
        );
      if (PRODUCTION_DOMAINS.some((domain) => url.hostname === domain || url.hostname.endsWith('.' + domain)))
        throw new LoadTargetRefused(
          `Cible dédiée : ${url.hostname} est un domaine public d'Arbestra (alpha ou staging) : refusé.`,
        );
    } else if (
      !(url.protocol === 'https:' && url.hostname === STAGING_HOST) &&
      !(loopback && port === STAGING_API_PORT)
    )
      throw new LoadTargetRefused(
        `Cible staging : API https://${STAGING_HOST} ou http://127.0.0.1:${STAGING_API_PORT} uniquement.`,
      );
    result.api = { origin: url.origin };
  }
  if (target === 'staging') {
    if (!input.confirmStaging)
      throw new LoadTargetRefused(`Cible staging : ajoutez ${STAGING_CONFIRM_FLAG} après avoir relu la procédure.`);
    const named = (input.env[STAGING_VARIABLE] ?? '')
      .split(',')
      .map((slug) => slug.trim())
      .filter(Boolean);
    if (!input.worldSlug || !named.includes(input.worldSlug))
      throw new LoadTargetRefused(
        `Cible staging : la variable ${STAGING_VARIABLE} doit nommer le monde visé (--world), ou lister les mondes séparés par des virgules.`,
      );
  }
  if (target === 'dedicated') {
    if (!input.confirmDedicated)
      throw new LoadTargetRefused(`Cible dédiée : ajoutez ${DEDICATED_CONFIRM_FLAG} après avoir relu la procédure.`);
    const host = (input.env[DEDICATED_VARIABLE] ?? '').trim().toLowerCase();
    if (!host)
      throw new LoadTargetRefused(
        `Cible dédiée : la variable ${DEDICATED_VARIABLE} doit nommer l'hôte de la machine de test (celui de l'API).`,
      );
    if (
      PRODUCTION_DOMAINS.some((domain) => host === domain || host.endsWith('.' + domain)) ||
      /alpha|staging/.test(host)
    )
      throw new LoadTargetRefused(`Cible dédiée : ${DEDICATED_VARIABLE} ne peut pas désigner l'alpha ni le staging.`);
    if (input.baseUrl !== undefined && new URL(input.baseUrl).hostname.toLowerCase() !== host)
      throw new LoadTargetRefused(
        `Cible dédiée : ${DEDICATED_VARIABLE} (${host}) ne correspond pas à l'hôte de l'API.`,
      );
  }
  return result;
}
