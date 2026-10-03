import type { VillageAccomplishment } from '@arbestra/contracts';

const entries: Record<string, { title: string; description: string }> = {
  'first-woodcut': { title: 'La première coupe', description: 'Un premier lot de bois a rejoint les réserves du village.' },
  'first-harvest': {
    title: 'Première récolte',
    description: 'Les premières carottes du Jardin ont rejoint les réserves du village.',
  },
  'cat-eyes': { title: 'Les yeux dans les yeux', description: 'Deux reflets dans le noir. L’Oracle cherchait son chat.' },
  'town-hall-supplies': {
    title: 'Les anciennes réserves',
    description: "2 000 carottes découvertes dans l'Hôtel de ville.",
  },
};

export function OracleJournal({ accomplishments }: { accomplishments: VillageAccomplishment[] }) {
  return <div className="oracle-journal">
    <span>L'Oracle</span>
    <strong>Grimoire du village</strong>
    {accomplishments.length === 0
      ? <p>Le grimoire ne porte encore aucune trace.</p>
      : <ol>{accomplishments.map((accomplishment) => {
        const entry = entries[accomplishment.code] ?? { title: 'Accomplissement', description: 'Une nouvelle page a été écrite.' };
        return <li key={accomplishment.code}>
          <strong>{entry.title}</strong>
          <p>{entry.description}</p>
          <time dateTime={accomplishment.completedAt}>{new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(accomplishment.completedAt))}</time>
        </li>;
      })}</ol>}
  </div>;
}
