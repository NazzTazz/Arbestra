import manifest from './building-assets-manifest.json';
const baked:Record<string,{url:string;thumbnail?:string}>=manifest;
import { BuildingThumbnailCache } from './building-thumbnail-cache';

// Bump whenever presentation recipes, materials/textures, camera or resolution change.
// This includes the factories used by buildPresentation and public/tiles/garden-4.png.
const THUMBNAIL_REVISION = 'factory-9-market-carrots-png-384x240';
const workerThumbnail=(code:string)=>/^workers:[1-3]$/.test(code)?`/thumbnails/workers-${code.slice(-1)}.png?v=1`:undefined;

// Keep this module free of Babylon imports: a persistent hit needs only the pixels.
const cache = new BuildingThumbnailCache(THUMBNAIL_REVISION, async (code, level) => {
  const { renderBuildingThumbnail } = await import('./building-thumbnail-renderer');
  return renderBuildingThumbnail(code, level);
});

export function peekBuildingThumbnail(code: string, level = 1): string | undefined {
  return workerThumbnail(code)??baked[`${code}-${level}-finished`]?.thumbnail??cache.peek(code, level);
}

export function buildingThumbnail(code: string, level = 1): Promise<string> {
  const thumbnail=workerThumbnail(code)??baked[`${code}-${level}-finished`]?.thumbnail;
  return thumbnail?Promise.resolve(thumbnail):cache.get(code, level);
}
