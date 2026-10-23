import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Portal avoids clipping by the horizontally scrolling showroom. */
export function RoadVariantMenu({
  anchor,
  id,
  label,
  onClose,
  children,
}: {
  anchor: HTMLButtonElement;
  id: string;
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null),
    close = useRef(onClose);
  close.current = onClose;
  const [position, setPosition] = useState<{
    left: number;
    bottom: number;
    width: number;
    backgroundSize: string;
    backgroundPosition: string;
  } | null>(null);
  useLayoutEffect(() => {
    const showroom = anchor.closest('.construction-showroom');
    const place = () => {
      const item = anchor.getBoundingClientRect(),
        bar = showroom?.getBoundingClientRect();
      const width = Math.min(Math.max(item.width, 260), window.innerWidth - 16),
        left = Math.max(8, Math.min(item.left, window.innerWidth - width - 8));
      setPosition({
        left,
        bottom: window.innerHeight - (bar?.top ?? item.top),
        width,
        backgroundSize: (bar?.width ?? width) + 'px 100%',
        backgroundPosition: -(left - (bar?.left ?? left)) + 'px 0',
      });
    };
    place();
    window.addEventListener('resize', place);
    showroom?.addEventListener('scroll', place);
    return () => {
      window.removeEventListener('resize', place);
      showroom?.removeEventListener('scroll', place);
    };
  }, [anchor]);
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (e.target instanceof Node && !anchor.contains(e.target) && !panel.current?.contains(e.target)) close.current();
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [anchor]);
  const positioned = Boolean(position);
  useEffect(() => {
    if (positioned)
      (
        panel.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]') ??
        panel.current?.querySelector<HTMLButtonElement>('button')
      )?.focus();
  }, [positioned]);
  return position
    ? createPortal(
        <div id={id} ref={panel} className="road-variant-menu" role="group" aria-label={label} style={position}>
          {children}
        </div>,
        document.body,
      )
    : null;
}
