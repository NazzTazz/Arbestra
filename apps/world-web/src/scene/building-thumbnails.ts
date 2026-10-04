import { BuildingThumbnailCache } from './building-thumbnail-cache';

// Bump whenever presentation recipes, materials/textures, camera or resolution change.
// This includes the factories used by buildPresentation and public/tiles/garden-4.png.
const THUMBNAIL_REVISION = 'factory-1-png-384x240';

// Keep this module free of Babylon imports: a persistent hit needs only the pixels.
const cache = new BuildingThumbnailCache(THUMBNAIL_REVISION, async (code, level) => {
  const { renderBuildingThumbnail } = await import('./building-thumbnail-renderer');
  return renderBuildingThumbnail(code, level);
});

export function peekBuildingThumbnail(code: string, level = 1): string | undefined {
  return cache.peek(code, level);
}

export function buildingThumbnail(code: string, level = 1): Promise<string> {
  return cache.get(code, level);
}
