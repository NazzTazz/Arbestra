import type { AdminJourneyEvent } from '@arbestra/contracts';

export const journeyLink = (accountId: string, scope?: { worldId: string; villageId: string }) =>
  `#/journeys/${encodeURIComponent(accountId)}` +
  (scope ? `?worldId=${encodeURIComponent(scope.worldId)}&villageId=${encodeURIComponent(scope.villageId)}` : '');

/** Readable names of journal types (commands, deferred completions, accomplishments). */
const typeLabels: Record<string, string> = {
  buildings: 'Construction',
  'buildings.upgrade': 'Amélioration',
  'buildings.expansions': 'Agrandissement',
  'buildings.discover-supplies': 'Découverte de réserves',
  'harvest-intents': 'Récolte ou coupe',
  'harvest-intents.cancel': 'Annulation de récolte',
  'extraction-pools': 'Réserves d’extraction',
  'market.trades': 'Marché',
  processing: 'Atelier',
  infrastructure: 'Voirie',
  exploitation: 'Exploitation',
  science: 'Science',
  leveling: 'Nivellement',
  terraform: 'Terrassement',
  'population.gestures': 'Geste de population',
  worksites: 'Chantier',
  'discover-cat-eyes': 'Yeux du chat',
  starter: 'Installation de départ',
  'building.complete': 'Fin de construction',
  'leveling.complete': 'Fin de nivellement',
  'market.complete': 'Échange livré',
  'science.complete': 'Science achevée',
  accomplishment: 'Accomplissement',
};
export const journeyTypeLabel = (type: string) => typeLabels[type] ?? type;

export const sourceLabels: Record<AdminJourneyEvent['source'], string> = {
  action: 'Action du joueur',
  deferred: 'Fin différée',
  automatic: 'Automatique',
};
/** Outcome label and the existing badge colour class it borrows. */
export const outcomeLabels: Record<AdminJourneyEvent['outcome'], { label: string; tone: string }> = {
  accepted: { label: 'Accepté', tone: 'completed' },
  pending: { label: 'Accepté, résultat différé', tone: 'pending' },
  rejected: { label: 'Refusé', tone: 'rejected' },
  error: { label: 'Erreur serveur', tone: 'failed' },
  interrupted: { label: 'Interrompu', tone: 'degraded' },
  completed: { label: 'Achevé', tone: 'completed' },
};

export interface JourneyFilter {
  session: string;
  source: string;
  outcome: string;
  type: string;
}
export const emptyJourneyFilter: JourneyFilter = { session: '', source: '', outcome: '', type: '' };
/** `session`: an index, or `none` for events outside any session. `outcome`:
 * one outcome, or `problems` for refusals, errors and interruptions. */
export function filterJourney(events: AdminJourneyEvent[], filter: JourneyFilter): AdminJourneyEvent[] {
  return events.filter(
    (event) =>
      (!filter.session ||
        (filter.session === 'none' ? event.session === null : String(event.session) === filter.session)) &&
      (!filter.source || event.source === filter.source) &&
      (!filter.type || event.type === filter.type) &&
      (!filter.outcome ||
        (filter.outcome === 'problems'
          ? event.outcome === 'rejected' || event.outcome === 'error' || event.outcome === 'interrupted'
          : event.outcome === filter.outcome)),
  );
}

/** « +12 min 30 s » from the session start; null outside a session. */
export function sinceSessionStart(at: string, startedAt: string | undefined): string | null {
  if (!startedAt) return null;
  const seconds = Math.max(0, Math.round((Date.parse(at) - Date.parse(startedAt)) / 1000));
  if (seconds < 60) return `+${seconds} s`;
  if (seconds < 3600) return `+${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')} s`;
  return `+${Math.floor(seconds / 3600)} h ${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')} min`;
}
