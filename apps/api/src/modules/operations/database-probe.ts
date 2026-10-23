import { performance } from 'node:perf_hooks';
import pg from 'pg';
import type { AdminRuntimeSnapshot } from '@arbestra/contracts';
import type { OperationsTelemetry } from './telemetry.js';

/** Dedicated single connection: monitoring cannot occupy the game's ten pool slots. */
export class DatabaseProbe {
  private pool: pg.Pool;
  private flight: Promise<AdminRuntimeSnapshot['database']> | undefined;
  private cached: AdminRuntimeSnapshot['database'] | undefined;
  private checkedAt = 0;

  constructor(
    url: string,
    private readonly telemetry: OperationsTelemetry,
  ) {
    this.pool = new pg.Pool({
      connectionString: url,
      max: 1,
      connectionTimeoutMillis: 1500,
      idleTimeoutMillis: 10_000,
      statement_timeout: 1500,
      query_timeout: 2000,
      application_name: 'arbestra-noc-probe',
    });
    this.pool.on('error', () =>
      telemetry.event(
        'DATABASE_PROBE_INTERRUPTED',
        'La connexion de supervision PostgreSQL a été interrompue.',
        'error',
      ),
    );
  }

  read(): Promise<AdminRuntimeSnapshot['database']> {
    if (this.flight) return this.flight;
    if (this.cached && Date.now() - this.checkedAt < 15_000) return Promise.resolve(this.cached);
    this.flight = this.check().finally(() => {
      this.flight = undefined;
    });
    return this.flight;
  }

  private async check(): Promise<AdminRuntimeSnapshot['database']> {
    const start = performance.now();
    let value: AdminRuntimeSnapshot['database'];
    try {
      await this.pool.query('select 1');
      const latencyMs = performance.now() - start;
      let connections: number | null = null,
        activeQueries: number | null = null;
      let note = 'Sonde réelle ; connexions de cette base visibles par le rôle PostgreSQL. Texte SQL non collecté.';
      try {
        const { rows } = await this.pool.query<{ connections: number; active: number }>(
          "select count(*)::int as connections, count(*) filter(where state = 'active' and pid <> pg_backend_pid())::int as active from pg_stat_activity where datname = current_database()",
        );
        connections = rows[0]!.connections;
        activeQueries = rows[0]!.active;
      } catch {
        note = 'Sonde SQL disponible ; statistiques de connexions non accessibles.';
      }
      value = {
        status: latencyMs > 500 ? 'degraded' : 'available',
        latencyMs,
        connections,
        activeQueries,
        observedAt: new Date().toISOString(),
        note,
      };
    } catch {
      value = {
        status: 'unavailable',
        latencyMs: null,
        observedAt: new Date().toISOString(),
        connections: null,
        activeQueries: null,
        note: 'Échec de la sonde PostgreSQL bornée ; consulter les journaux protégés.',
      };
      if (this.cached?.status !== 'unavailable')
        this.telemetry.event('DATABASE_UNAVAILABLE', 'La sonde PostgreSQL ne répond pas.', 'error');
    }
    this.cached = value;
    this.checkedAt = Date.now();
    return value;
  }
  async close(): Promise<void> {
    await this.flight;
    await this.pool.end();
  }
}
