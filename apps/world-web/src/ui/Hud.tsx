import type { VillageState } from '@arbestra/contracts';
import { NotificationStack, type GameNotification } from './NotificationStack';

const format = (value: number) => Math.floor(value).toLocaleString('fr-FR');

export function Hud({ state, displayedWood, notifications, onPopulation, onJournal }: { state: VillageState; displayedWood: number; notifications: GameNotification[]; onPopulation: () => void; onJournal: () => void }) {
  const stone = state.village.resources.find((resource) => resource.code === 'stone')?.amount ?? 0;
  const population = state.village.population;
  return <header className="top-bar">
    <div className="world-identity"><span className="world-name">{state.world.name}</span><strong>{state.village.name}</strong></div>
    <div className="resource resource--wood" aria-label={`${format(displayedWood)} bois`}><span className="resource-icon resource-icon--wood" aria-hidden="true" /><strong>{format(displayedWood)}</strong><small>+{state.village.woodProductionPerHour}/h</small></div>
    <div className="resource" aria-label={`${format(state.village.carrots)} carottes`}><span className="resource-icon resource-icon--carrot" aria-hidden="true" /><strong>{format(state.village.carrots)}</strong></div>
    <div className="resource" aria-label={`${format(stone)} pierre`}><span aria-hidden="true">◆</span><strong>{format(stone)}</strong></div>
    <button className="population-button" type="button" onClick={onPopulation} aria-label="Gérer les habitants"><span aria-hidden="true">♟</span><strong>{population.total}/{population.housingCapacity}</strong><small>{population.available} libres</small></button>
    <button className="journal-button" type="button" onClick={onJournal} aria-label="Ouvrir le grimoire de l'Oracle"><span aria-hidden="true">◇</span><strong>Grimoire</strong>{state.village.accomplishments.length > 0 ? <small>{state.village.accomplishments.length}</small> : null}</button>
    <NotificationStack notifications={notifications} />
  </header>;
}
