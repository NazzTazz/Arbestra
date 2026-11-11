import { createElement } from 'react';
import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { VillageState } from '@arbestra/contracts';
import { WorksitePanel } from './PlayerPanels';

type Site = VillageState['village']['worksites'][number];
const target = (status: Site['targets'][number]['status'], reason: string | null, i: number) => ({
  featureId: `00000000-0000-4000-8000-00000000000${i}`,
  cellX: i,
  cellY: 0,
  status,
  reason,
});
const site: Site = {
  poolResource: 'wood',
  id: '00000000-0000-4000-8000-000000000010',
  resourceCode: 'wood',
  mode: 'cut',
  status: 'running',
  workerCap: 5,
  deliveredAmount: 0,
  waitReason: 'navigation-budget',
  nextWakeAt: null,
  createdAt: '2026-11-11T00:00:00.000Z',
  targets: [
    target('abandoned', 'budget', 1),
    target('abandoned', 'budget', 2),
    target('abandoned', 'unreachable', 3),
    target('abandoned', 'stopped', 4),
    target('pending', null, 5),
  ],
  activeExtraction: null,
};

it('shows the search budget wait and the targets given up, by reason (T2b, §8.8)', () => {
  const html = renderToStaticMarkup(
    createElement(WorksitePanel, { worksites: [site], pending: false, onAction: () => {} }),
  );
  expect(html).toContain('En attente : trajet difficile à calculer, nouvel essai dans une minute');
  expect(html).toContain('Abandonnés : 2 trajet introuvable après plusieurs essais · 1 sans chemin');
  const quiet = renderToStaticMarkup(
    createElement(WorksitePanel, {
      worksites: [{ ...site, waitReason: null, targets: [target('pending', null, 5)] }],
      pending: false,
      onAction: () => {},
    }),
  );
  expect(quiet).not.toContain('Abandonnés');
});
