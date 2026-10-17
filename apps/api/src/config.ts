import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';

try {
  loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

export interface AppConfig {
  readonly nocHttpSlowMs?: number;
  readonly nocHttpLogMode?: 'anomalies' | 'off';
  readonly adminAccountIds?: readonly string[];
  readonly adminOrigin?: string;
  readonly worldOrigin?: string;
  readonly trustedProxyCidrs?: readonly string[];
  readonly expeditionWorkerEnabled?:boolean;
  readonly expeditionWorkerCount?:1|2;
  readonly worldGeneratorOperatorEmails?: readonly string[];
  readonly databaseUrl: string;
  readonly host: string;
  readonly port: number;
  readonly isProduction: boolean;
  readonly cookieName: string;
  readonly cookieDomain?: string;
  readonly sessionTtlDays: number;
  readonly constructionDurationOverrideMs: number | null;
  readonly scheduledTaskPollIntervalMs: number;
}

function adminAccountIds(value: string | undefined): readonly string[] {
  if (!value?.trim()) return [];
  const values = value.split(',').map(id => id.trim().toLowerCase());
  if (values.some(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))) {
    throw new Error('ADMIN_ACCOUNT_IDS must contain only canonical account UUIDs');
  }
  return [...new Set(values)];
}

function adminOrigin(value: string | undefined, production: boolean, enabled: boolean): string | undefined {
  if (!value) {
    if (enabled) throw new Error('ADMIN_ORIGIN is required when ADMIN_ACCOUNT_IDS is configured');
    return undefined;
  }
  let origin: URL;
  try { origin = new URL(value); } catch { throw new Error('ADMIN_ORIGIN must be an absolute HTTP(S) origin'); }
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password ||
      origin.pathname !== '/' || origin.search || origin.hash || (production && origin.protocol !== 'https:')) {
    throw new Error('ADMIN_ORIGIN must be an origin without credentials, path, query or fragment, using HTTPS in production');
  }
  return origin.origin;
}

function trustedProxyCidrs(value: string | undefined): readonly string[] {
  if (!value?.trim()) return [];
  const entries = value.split(',').map(entry => entry.trim());
  for (const entry of entries) {
    const [address, prefix, ...extra] = entry.split('/');
    const family = isIP(address ?? '');
    if (!family || extra.length || (prefix !== undefined && (!/^\d+$/.test(prefix) ||
        Number(prefix) < 1 || Number(prefix) > (family === 4 ? 32 : 128)))) {
      throw new Error('TRUSTED_PROXY_CIDRS must contain explicit IP addresses or restricted CIDRs');
    }
  }
  return [...new Set(entries)];
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const databaseUrl = environment.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const cookieDomain = environment.COOKIE_DOMAIN;
  const isProduction = environment.NODE_ENV === 'production';
  const admins = adminAccountIds(environment.ADMIN_ACCOUNT_IDS);
  const origin = adminOrigin(environment.ADMIN_ORIGIN, isProduction, admins.length > 0);
  const worldOrigin = adminOrigin(environment.WORLD_ORIGIN, isProduction, false);
  const slowText = environment.NOC_HTTP_SLOW_MS ?? '2000';
  if (!/^\d+$/.test(slowText) || Number(slowText) < 250 || Number(slowText) > 60_000) {
    throw new Error('NOC_HTTP_SLOW_MS must be an integer between 250 and 60000');
  }
  const logMode = environment.NOC_HTTP_LOG_MODE ?? 'anomalies';
  if (logMode !== 'anomalies' && logMode !== 'off') throw new Error('NOC_HTTP_LOG_MODE must be anomalies or off');
  if(environment.EXPEDITION_WORKERS&&!/^[12]$/.test(environment.EXPEDITION_WORKERS))throw Error('EXPEDITION_WORKERS must be 1 or 2');

  return {
    nocHttpSlowMs: Number(slowText),
    nocHttpLogMode: logMode,
    adminAccountIds: admins,
    ...(origin ? { adminOrigin: origin } : {}),
    ...(worldOrigin ? { worldOrigin } : {}),
    trustedProxyCidrs: trustedProxyCidrs(environment.TRUSTED_PROXY_CIDRS),
    databaseUrl,
    expeditionWorkerCount:environment.EXPEDITION_WORKERS==='2'?2:1,
    worldGeneratorOperatorEmails:(environment.WORLD_GENERATOR_OPERATOR_EMAILS??'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean),
    host: environment.HOST ?? '127.0.0.1',
    port: Number(environment.PORT ?? 3000),
    isProduction,
    cookieName: environment.COOKIE_NAME ?? 'arbestra_session',
    ...(cookieDomain ? { cookieDomain } : {}),
    sessionTtlDays: Number(environment.SESSION_TTL_DAYS ?? 30),
    constructionDurationOverrideMs: environment.CONSTRUCTION_DURATION_MS ? Number(environment.CONSTRUCTION_DURATION_MS) : null,
    scheduledTaskPollIntervalMs: Number(environment.SCHEDULED_TASK_POLL_INTERVAL_MS ?? 250),
  };
}
