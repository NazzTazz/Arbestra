import { useCallback, useRef, useState } from 'react';
import { appendResourceFeedback, resourceChanges, type ResourceFeedback } from './resource-feedback';

export function useResourceFeedback() {
  const [items, setItems] = useState<ResourceFeedback[]>([]);
  const sequence = useRef(0);
  const showChanges = useCallback(
    (previous: Parameters<typeof resourceChanges>[0], next: Parameters<typeof resourceChanges>[1]) => {
      const context = next.world.id + ':' + next.village.id;
      const additions = resourceChanges(previous, next).map((change) => ({
        ...change,
        id: sequence.current++,
        context,
      }));
      setItems((current) => appendResourceFeedback(current, additions, context));
    },
    [],
  );
  const dismiss = useCallback((id: number) => setItems((current) => current.filter((item) => item.id !== id)), []);
  return { items, showChanges, dismiss };
}
