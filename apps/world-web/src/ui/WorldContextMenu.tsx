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
    y: Math.max(56, Math.min(anchor.y + 12, window.innerHeight - 160)),
  };
}

export function WorldContextMenu({ anchor, children }: WorldContextMenuProps) {
  const menuRef = useRef<HTMLElement>(null);
  const [position, setPosition] = useState(() => clampMenuAnchor(anchor));

  useLayoutEffect(() => {
    const placeMenu = () => {
      const menu = menuRef.current;
      if (!menu) return;
      let rect = menu.getBoundingClientRect();
      const x = Math.max(8, Math.min(anchor.x + 12, window.innerWidth - rect.width - 8));
      const palettes = [...document.querySelectorAll('.command-palette, .mode-toolbar, .world-mode-bar')]
        .map(element => element.getBoundingClientRect())
        .filter(box => box.width && box.left < x + rect.width && box.right > x);
      const bottom = Math.min(window.innerHeight - 46, ...palettes.map(box => box.top - 8));
      menu.style.maxHeight = `${Math.max(100, bottom - 8)}px`;
      rect = menu.getBoundingClientRect();
      const nextPosition = {
        x,
        y: Math.max(8, Math.min(anchor.y + 12, bottom - rect.height)),
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
