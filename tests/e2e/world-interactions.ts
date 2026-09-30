import { expect, type Page } from '@playwright/test';

export async function cellPoint(page: Page, cell: { cellX: number; cellY: number }) {
  const canvas = page.getByTestId('village-canvas');
  const id = `${cell.cellX}:${cell.cellY}`;
  await expect.poll(async () => canvas.evaluate((element, key) => {
    const positions = JSON.parse(element.dataset.cellScreens ?? '[]') as Array<{ id: string }>;
    return positions.some((position) => position.id === key);
  }, id)).toBe(true);
  const point = await canvas.evaluate((element, key) => {
    const positions = JSON.parse(element.dataset.cellScreens!) as Array<{ id: string; x: number; y: number }>;
    const position = positions.find((item) => item.id === key)!;
    const box = element.getBoundingClientRect();
    return { x: box.x + box.width * position.x, y: box.y + box.height * position.y };
  }, id);
  const viewport = page.viewportSize()!;
  expect(point.x).toBeGreaterThan(0); expect(point.x).toBeLessThan(viewport.width);
  expect(point.y).toBeGreaterThan(40); expect(point.y).toBeLessThan(viewport.height);
  return point;
}

export async function clickCell(page: Page, cell: { cellX: number; cellY: number }, isMobile: boolean) {
  const point = await cellPoint(page, cell);
  if (isMobile) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
}

export async function selectRectangle(page: Page, first: { cellX: number; cellY: number }, last: { cellX: number; cellY: number }, isMobile: boolean) {
  const a = await cellPoint(page, first), b = await cellPoint(page, last);
  if (isMobile) { await page.touchscreen.tap(a.x, a.y); await page.touchscreen.tap(b.x, b.y); }
  else { await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 2 }); await page.mouse.up(); }
}
