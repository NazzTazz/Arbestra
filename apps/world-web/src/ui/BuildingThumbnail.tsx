import { useEffect, useState } from 'react';
import { buildingThumbnail, peekBuildingThumbnail } from '../scene/building-thumbnails';

export function BuildingThumbnail({ code, level = 1 }: { code: string; level?: number }) {
  const [image, setImage] = useState<{ key: string; src: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const key = `${code}:${level}`;
  const src = peekBuildingThumbnail(code, level) ?? (image?.key === key ? image.src : undefined);
  useEffect(() => {
    let live = true; setFailed(false);
    void buildingThumbnail(code, level)
      .then(src => { if (live) setImage({ key, src }); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [code, level, key]);
  return <span className="building-thumbnail" aria-hidden="true">
    {src ? <img src={src} alt="" draggable={false} /> : <small>{failed ? 'Aperçu indisponible' : 'Préparation de l’aperçu…'}</small>}
  </span>;
}
