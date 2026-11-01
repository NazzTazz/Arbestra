import { expect, test, type Page } from '@playwright/test';
import { waitForVillage } from './world-interactions';

// The first read of the village goes through V2 alone (lot I.2). Its three
// failures read differently: an expired session goes straight to the login
// screen, a missing village stops with the server's refusal, and a server that
// stays unavailable ends on the "connection impossible" screen, which retries
// by itself and on the player's request.
const BOOTSTRAP = '**/api/worlds/aube/village/bootstrap*';

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByLabel('Adresse e-mail').fill('player@arbestra.local');
  await page.getByLabel('Mot de passe').fill('arbestra');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('link', { name: /Monde de l'Aube/ })).toBeVisible();
}

/** The API calls the page makes, as "METHOD /path". */
function recordApi(page: Page) {
  const calls: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/')) calls.push(`${request.method()} ${url.pathname}`);
  });
  return {
    bootstraps: () => calls.filter((call) => call === 'GET /api/worlds/aube/village/bootstrap').length,
    /** The legacy snapshot read and the legacy stream: neither is ever used. */
    legacy: () => calls.filter((call) => /^GET \/api\/worlds\/aube\/village$|\/events$/.test(call)),
  };
}

test('une session expirée mène directement à l’écran de connexion, sans reprise ni lecture historique', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Parcours d’écran identique sur mobile.');
  await signIn(page);
  const api = recordApi(page);
  await page.route(BOOTSTRAP, (route) =>
    route.fulfill({ status: 401, json: { code: 'UNAUTHENTICATED', message: 'Authentification requise.' } }),
  );
  await page.goto('http://localhost:5274/?world=aube');
  await expect(page.getByText('Connectez-vous pour entrer dans ce monde.')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Connexion au village impossible.')).toHaveCount(0);
  expect(api.bootstraps()).toBe(1);
  expect(api.legacy()).toEqual([]);
});

test('un monde sans village s’arrête sur le refus du serveur, sans les 30 reprises', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Parcours d’écran identique sur mobile.');
  await signIn(page);
  const api = recordApi(page);
  await page.route(BOOTSTRAP, (route) =>
    route.fulfill({
      status: 404,
      json: { code: 'VILLAGE_NOT_FOUND', message: 'Village introuvable dans ce monde.' },
    }),
  );
  await page.goto('http://localhost:5274/?world=aube');
  await expect(page.getByText('Village introuvable dans ce monde.')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Réessayer' })).toBeVisible();
  await expect(page.getByText('Connexion au village impossible.')).toHaveCount(0);
  // Whatever the delay of a retry would be, none is pending: let it pass.
  await page.waitForTimeout(3_000);
  expect(api.bootstraps()).toBe(1);
  expect(api.legacy()).toEqual([]);
});

test('un serveur indisponible finit sur l’écran de connexion, qui réessaie seul puis à la demande du joueur', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Parcours d’écran identique sur mobile.');
  test.setTimeout(240_000);
  await signIn(page);
  const api = recordApi(page);
  let attempts = 0;
  await page.route(BOOTSTRAP, (route) => {
    attempts++;
    return route.fulfill({
      status: 503,
      headers: { 'retry-after': '0' },
      json: { code: 'INTERNAL_ERROR', message: 'Indisponible.' },
    });
  });
  // The back-off (1, 2, 5, 10, 20 then 30 s, 7 attempts) runs on the page's own clock.
  await page.clock.install();
  await page.goto('http://localhost:5274/?world=aube');
  const screen = page.getByText('Connexion au village impossible.');
  await expect.poll(() => attempts, { timeout: 30_000 }).toBe(1);
  // Each failed attempt waits its step: jump over it, then wait for the next attempt.
  while (attempts < 7) {
    const before = attempts;
    await page.clock.fastForward(31_000);
    await expect.poll(() => attempts, { timeout: 15_000 }).toBeGreaterThan(before);
  }
  await expect(screen).toBeVisible();
  expect(attempts).toBe(7);
  await expect(page.getByText('Nouvelle tentative automatique en cours.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Réessayer' })).toBeVisible();
  // The screen tries again by itself at the capped cadence...
  await page.clock.fastForward(31_000);
  await expect.poll(() => attempts, { timeout: 15_000 }).toBe(8);
  await expect(screen).toBeVisible();
  // ...and at once when the player asks.
  await page.getByRole('button', { name: 'Réessayer' }).click();
  await expect.poll(() => attempts, { timeout: 15_000 }).toBe(9);
  await expect(screen).toBeVisible();
  // The server is back: the next attempt opens the village.
  await page.unroute(BOOTSTRAP);
  await page.getByRole('button', { name: 'Réessayer' }).click();
  await waitForVillage(page);
  await expect(screen).toHaveCount(0);
  expect(api.legacy()).toEqual([]);
});
