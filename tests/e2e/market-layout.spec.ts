import { expect, test, type Route } from '@playwright/test';

test.use({ baseURL: 'http://localhost:5274' });
for (const empty of [false, true])
  test(`la fiche du marché reste stable pendant les actualisations (${empty ? 'sans offres' : 'avec une offre'})`, async ({
    page,
    isMobile,
  }, testInfo) => {
    test.setTimeout(120000);
    const waiting: Route[] = [];
    let hold = false;
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const payload = {
      offers: empty
        ? []
        : [
            {
              id: 'layout-offer',
              villageId: 'other-village',
              villageName: 'Village voisin',
              requestedResource: 'wood',
              requestedAmount: 100,
              offeredResource: 'carrot',
              offeredAmount: 250,
              maxTravelSeconds: 600,
              status: 'open',
              createdAt: '2026-10-18T00:00:00Z',
              oracleAt: '2026-10-18T00:10:00Z',
              oracleEligible: true,
            },
          ],
      nextCursor: null,
    };
    const touch = async (locator: ReturnType<typeof page.getByRole>) => {
      if (isMobile) await locator.tap();
      else await locator.click();
    };
    await page.route('**/api/worlds/layout-fixture/villages/layout-village/market/offers?*', (route) => {
      if (hold) {
        waiting.push(route);
        return;
      }
      return route.fulfill({ json: payload });
    });
    try {
      await page.goto('/tests/market-layout.html');
      const panel = page.getByRole('region', { name: 'Place de marché' }),
        loading = panel.getByText('Préparation du marché…', { exact: true });
      await touch(panel.getByRole('button', { name: 'Consulter les offres' }));
      await touch(panel.getByRole('button', { name: 'Carottes', exact: true }));
      await expect(panel.locator('.market-resource img')).toHaveCount(5, { timeout: 60000 });
      await page.evaluate(() => document.fonts.ready);
      const measure = () =>
        panel.evaluate((el) => {
          const menu = el.closest('.world-context-menu') as HTMLElement,
            rect = menu.getBoundingClientRect();
          return {
            top: rect.top,
            height: rect.height,
            scrollHeight: menu.scrollHeight,
            headings: [...el.querySelectorAll('h4')].map((h) => h.getBoundingClientRect().top),
          };
        });
      for (const tab of ['Consulter les offres', 'Mes offres']) {
        hold = false;
        await touch(panel.getByRole('button', { name: tab }));
        await expect(loading).not.toBeVisible();
        if (empty) await expect(panel.getByText(/^Aucune offre/)).toBeVisible();
        else await expect(panel.getByText('Village voisin', { exact: false })).toBeVisible();
        await page.evaluate(() => window.dispatchEvent(new Event('resize')));
        await page.evaluate(
          () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
        );
        const before = await measure();
        hold = true;
        for (let cycle = 0; cycle < 3; cycle++) {
          await touch(page.getByRole('button', { name: 'Simuler une révision' }));
          await expect.poll(() => waiting.length).toBe(1);
          await expect(loading).toBeVisible();
          expect(await measure()).toEqual(before);
          await waiting.shift()!.fulfill({ json: payload });
          await expect(loading).not.toBeVisible();
          expect(await measure()).toEqual(before);
        }
      }
      await page.screenshot({ path: testInfo.outputPath('market-stable.png') });
      expect(errors).toEqual([]);
    } finally {
      await Promise.allSettled(waiting.map((route) => route.abort()));
    }
  });
