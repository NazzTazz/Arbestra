import { useEffect, useState } from 'react';
import type { StarterInstallation } from '@arbestra/contracts';
import { useRef } from 'react';
import { villageRoute } from './starter-route';
import './placement.css';
export function StarterResume({ slug, villageId }: { slug: string; villageId: string }) {
  const [remaining, setRemaining] = useState(0);
  const read = useRef<{ key: string; promise: Promise<{ installation: StarterInstallation | null } | null> } | null>(
    null,
  );
  useEffect(() => {
    let live = true;
    const key = slug + ':' + villageId;
    if (read.current?.key !== key)
      read.current = {
        key,
        promise: fetch('/api/worlds/' + encodeURIComponent(slug) + '/starter').then((r) =>
          r.ok ? timedJson<{ installation: StarterInstallation | null }>(r) : null,
        ),
      };
    void read.current.promise
      .then((r) => {
        if (live) setRemaining(r?.installation?.villageId === villageId ? r.installation.remaining.length : 0);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [slug, villageId]);
  return remaining ? (
    <a className="starter-resume" href={villageRoute(slug, true)}>
      Kit de départ : {remaining} éléments à poser
    </a>
  ) : null;
}
import { timedFetch as fetch, timedJson } from '../dev/statistics';
