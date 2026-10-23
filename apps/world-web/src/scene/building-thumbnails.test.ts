import { expect, it, vi } from 'vitest';
import { buildingThumbnail, peekBuildingThumbnail } from './building-thumbnails';

const { render } = vi.hoisted(() => ({
  render: vi.fn(() => {
    throw Error('A HUD carrot must not start a 3D renderer');
  }),
}));
vi.mock('./building-thumbnail-renderer', () => ({ renderBuildingThumbnail: render }));

it('provides the market carrot immediately for Population without a 3D render', async () => {
  expect(peekBuildingThumbnail('resource:carrot')).toBe('/thumbnails/carrot.png?v=1');
  await expect(buildingThumbnail('resource:carrot')).resolves.toBe('/thumbnails/carrot.png?v=1');
  expect(render).not.toHaveBeenCalled();
});
