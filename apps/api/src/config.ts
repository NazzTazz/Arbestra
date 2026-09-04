import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

try {
  loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

export interface AppConfig {
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

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const databaseUrl = environment.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const cookieDomain = environment.COOKIE_DOMAIN;

  return {
    databaseUrl,
    host: environment.HOST ?? '127.0.0.1',
    port: Number(environment.PORT ?? 3000),
    isProduction: environment.NODE_ENV === 'production',
    cookieName: environment.COOKIE_NAME ?? 'arbestra_session',
    ...(cookieDomain ? { cookieDomain } : {}),
    sessionTtlDays: Number(environment.SESSION_TTL_DAYS ?? 30),
    constructionDurationOverrideMs: environment.CONSTRUCTION_DURATION_MS ? Number(environment.CONSTRUCTION_DURATION_MS) : null,
    scheduledTaskPollIntervalMs: Number(environment.SCHEDULED_TASK_POLL_INTERVAL_MS ?? 250),
  };
}
