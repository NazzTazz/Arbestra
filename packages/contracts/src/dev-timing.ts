/** Closed, numeric-only development instrumentation. No SQL, parameters or account data. */
export const DEV_TIMING_HEADER = 'x-arbestra-dev-timing';
export const DEV_TIMING_PHASES = {
  request: 'Serveur · avant envoi',
  auth: 'Authentification',
  village: 'Lecture village · transaction comprise',
  ownership: 'Vérification du village',
  economy: 'Préparation économique',
  village_lock: 'Acquisition du verrou village',
  navigation_lock: 'Acquisition du verrou navigation',
  reconcile: 'Transitions économiques dues',
  admission: 'Finalisation / admission économique',
  snapshot: 'Assemblage du snapshot',
  snapshot_ground: 'Terrain du snapshot',
  snapshot_reads: 'Lectures initiales du snapshot',
  resources: 'Projection des ressources',
  population: 'Lectures population / récoltes',
  features: 'Ressources naturelles visibles',
  science: 'État scientifique',
  infrastructure: 'Infrastructure / accès',
  navigation: 'Calcul du réseau de trajets',
  navigation_queue: 'Attente / démarrage du worker trajets',
  navigation_input: 'Encodage / transfert vers le worker trajets',
  sync: 'Contrôle de cohérence avant réponse',
  terrain: 'Lecture terrain · transaction comprise',
  knowledge: 'Connaissance géographique',
  chunks: 'Assemblage des chunks',
  rc1_ground: 'Terrain RC1 / éditions locales',
  rc1_source: 'Source RC1 / identité',
  rc1_parse: 'Décodage JSON de la source',
  rc1_checksum: 'Vérification du checksum',
  rc1_field: 'Construction du champ de terrain',
  rc1_geometry: 'Géométrie des ressources RC1',
  serialize: 'Sérialisation JSON / validation différée',
  pool: 'Acquisition des connexions',
  sql: 'Appels du driver SQL',
} as const;
export type DevTimingPhase = keyof typeof DEV_TIMING_PHASES;
export interface DevTimingMetric {
  phase: DevTimingPhase;
  durationMs: number;
  selfMs: number;
  count: number;
}

export function parseDevServerTiming(header: string | null): DevTimingMetric[] {
  if (!header || header.length > 12_000) return [];
  const values = new Map<string, { duration: number; count: number }>();
  for (const entry of header.split(',')) {
    const match = /^\s*arb_([a-z0-9_]+);dur=([\d.]+);desc="(\d+)"\s*$/.exec(entry);
    if (!match) continue;
    const duration = Number(match[2]),
      count = Number(match[3]);
    if (
      !Number.isFinite(duration) ||
      duration < 0 ||
      duration > 86_400_000 ||
      !Number.isSafeInteger(count) ||
      count < 1
    )
      continue;
    values.set(match[1]!, { duration, count });
  }
  return (Object.keys(DEV_TIMING_PHASES) as DevTimingPhase[]).flatMap((phase) => {
    const inclusive = values.get(phase),
      self = values.get(phase + '_self');
    return inclusive && self && self.count === inclusive.count && self.duration <= inclusive.duration + 0.002
      ? [{ phase, durationMs: inclusive.duration, selfMs: self.duration, count: inclusive.count }]
      : [];
  });
}
