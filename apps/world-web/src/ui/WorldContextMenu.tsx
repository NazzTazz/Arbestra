import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export interface ScreenAnchor {
  x: number;
  y: number;
}

interface WorldContextMenuProps {
  anchor: ScreenAnchor;
  children: ReactNode;
}

export function clampMenuAnchor(anchor: ScreenAnchor): ScreenAnchor {
  const menuWidth = Math.min(272, window.innerWidth - 16);
  return {
    x: Math.max(8, Math.min(anchor.x + 12, window.innerWidth - menuWidth - 8)),
    y: Math.max(48, Math.min(anchor.y + 12, window.innerHeight - 48)),
  };
}

export function WorldContextMenu({ anchor, children }: WorldContextMenuProps) {
  const menuRef = useRef<HTMLElement>(null);
  const [position, setPosition] = useState(() => clampMenuAnchor(anchor));

  useLayoutEffect(() => {
    const placeMenu = () => {
      const menu = menuRef.current;
      if (!menu) return;
      const rect = menu.getBoundingClientRect();
      const nextPosition = {
        x: Math.max(8, Math.min(anchor.x + 12, window.innerWidth - rect.width - 8)),
        y: Math.max(48, Math.min(anchor.y + 12, window.innerHeight - rect.height - 8)),
      };
      setPosition((current) => current.x === nextPosition.x && current.y === nextPosition.y ? current : nextPosition);
    };
    placeMenu();
    window.addEventListener('resize', placeMenu);
    return () => window.removeEventListener('resize', placeMenu);
  }, [anchor, children]);

  return (
    <aside
      ref={menuRef}
      className="world-context-menu"
      data-testid="world-context-menu"
      style={{ left: position.x, top: position.y }}
      aria-live="polite"
    >
      {children}
    </aside>
  );
}
