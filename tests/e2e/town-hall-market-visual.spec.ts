import { expect, test } from '@playwright/test';
import { createDatabase } from '../../apps/api/src/database/connection';
import { DEVELOPMENT_IDS as ids } from '../../apps/api/src/database/seed';
import { testDatabaseUrl } from '../../apps/api/src/database/test-environment';
import type { Engine as BabylonEngine } from '@babylonjs/core/Engines/engine';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { openVillage } from './world-interactions';

test('l’hôtel de ville niveau 2 affiche la maquette validée dans le village', async ({ page, isMobile }, testInfo) => {
  test.skip(isMobile, 'Recette visuelle desktop.');
  test.setTimeout(300000);
  const db = createDatabase(testDatabaseUrl()),
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await db
      .updateTable('buildings')
      .set({ level: 2 })
      .where('worldId', '=', ids.world)
      .where('villageId', '=', ids.village)
      .where('id', '=', ids.townHall)
      .execute();
    const canvas = await openVillage(page);
    await page.getByRole('button', { name: 'Vue libre', exact: true }).click();
    const inspect = () =>
      page.evaluate(async () => {
        const module = '/node_modules/.vite/deps/@babylonjs_core_Engines_engine.js';
        const { Engine } = await import(module);
        const scene = (Engine.Instances as BabylonEngine[])
          .flatMap((e) => e.scenes)
          .find((s) => s.getMeshByName('market-storefront-straight'));
        if (!scene) return null;
        const pane = scene.getMeshByName('market-storefront-straight')!,
          bounds = pane.getBoundingInfo().boundingBox;
        const reflection = (pane.material as StandardMaterial).reflectionTexture!;
        // The baked shell's instances carry their building's name as a prefix.
        const baked = (name: string) => scene.meshes.find((m) => m.name.endsWith('-' + name));
        const hall = pane.parent!.parent!.parent!.parent!;
        return {
          pavilion: !!baked('hall-market-clock-pavilion'),
          display: !!baked('market-resource-display'),
          asset: (hall.metadata as { assetState?: string } | null)?.assetState,
          curve: !!scene.getMeshByName('market-storefront-curved'),
          thickness: bounds.maximum.x - bounds.minimum.x,
          reflection: reflection.isCube,
          renderTarget: reflection.isRenderTarget,
          probes: scene.reflectionProbes?.length ?? 0,
          parent: pane.parent!.parent!.parent!.name,
        };
      });
    await expect.poll(inspect, { timeout: 60000 }).not.toBeNull();
    const proof = await inspect();
    expect(proof).toMatchObject({
      pavilion: true,
      display: true,
      curve: true,
      asset: 'ready',
      reflection: true,
      renderTarget: false,
      probes: 0,
    });
    expect(proof!.thickness).toBeCloseTo(0.056, 5);
    expect(proof!.parent).toMatch(/^(factory-|town-hall-)/);
    await page.screenshot({ path: testInfo.outputPath('hall-2-village.png') });
    await page.getByRole('button', { name: 'Exploitation', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-world-interaction-ready', 'true', { timeout: 40000 });
    const point = await canvas.evaluate((el, id) => {
      const p = (JSON.parse(el.dataset.buildingScreens ?? '[]') as { id: string; x: number; y: number }[]).find(
          (p) => p.id === id,
        )!,
        r = el.getBoundingClientRect();
      return { x: r.x + r.width * p.x, y: r.y + r.height * p.y };
    }, ids.townHall);
    await page.mouse.click(point.x, point.y);
    await expect(page.getByRole('region', { name: 'Place de marché' })).toBeVisible({ timeout: 20000 });
    expect(errors).toEqual([]);
  } finally {
    await db.destroy();
  }
});
