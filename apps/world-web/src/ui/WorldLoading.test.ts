import { createElement } from 'react';
import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorldLoading } from './WorldLoading';

it('says the connection is impossible, what the game does about it, and offers a retry', () => {
  const lost = renderToStaticMarkup(
    createElement(WorldLoading, {
      worldName: 'Aube',
      error: 'Connexion au village impossible.',
      detail: 'Nouvelle tentative automatique en cours.',
      onRetry: () => {},
      lobbyUrl: 'http://lobby',
    }),
  );
  expect(lost).toContain('Connexion au village impossible.');
  expect(lost).toContain('Nouvelle tentative automatique en cours.');
  expect(lost).toContain('Réessayer');
  expect(lost).toContain('Retour aux mondes');
  // A problem never shows the loading pulse.
  expect(lost).not.toContain('world-loading-pulse');
});

it('shows a detail only next to a problem', () => {
  const loading = renderToStaticMarkup(
    createElement(WorldLoading, { worldName: 'Aube', detail: 'Ne doit pas apparaître.' }),
  );
  expect(loading).not.toContain('Ne doit pas apparaître.');
  expect(loading).toContain('world-loading-pulse');
});
