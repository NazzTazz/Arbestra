/** Guards of every load-test script (docs/TEST-DE-CHARGE.md §6). A script
 * refuses to run without an explicit `--target local|staging`; staging needs a
 * confirmation flag and a dedicated variable naming the world; nothing may
 * ever designate the alpha (its name, its database or its API port). Pure: the
 * caller passes the URLs and the environment. */
export type LoadTarget = 'local' | 'staging';

export class LoadTargetRefused extends Error {}

/** The dedicated variable of a staging run: it must name the targeted world. */
export const STAGING_VARIABLE = 'ARBESTRA_LOAD_STAGING';
export const STAGING_CONFIRM_FLAG = '--confirm-staging';
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
const portOf = (url: URL) => url.port || (url.protocol === 'https:' ? '443' : '80');

export function checkTarget(input: TargetInput): CheckedTarget {
  const target = input.target;
  if (target !== 'local' && target !== 'staging')
    throw new LoadTargetRefused('Cible obligatoire : --target local ou --target staging.');
  for (const [label, value] of [
    ['La base', input.databaseUrl],
    ["L'API", input.baseUrl],
    ['Le monde', input.worldSlug],
  ] as const)
    if (value !== undefined && mentionsAlpha(value))
      throw new LoadTargetRefused(`${label} désigne l'alpha : refusé, le test de charge ne vise jamais l'alpha.`);
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
    const named = input.env[STAGING_VARIABLE];
    if (!input.worldSlug || !named || named !== input.worldSlug)
      throw new LoadTargetRefused(
        `Cible staging : la variable ${STAGING_VARIABLE} doit valoir le slug du monde visé (--world).`,
      );
  }
  return result;
}
