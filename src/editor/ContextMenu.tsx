import React, { useLayoutEffect, useRef, useState } from 'react';
import { Pt } from '../model/types';

export interface MenuItem {
  label: string;
  action: () => void;
  isDanger?: boolean;
}

interface Props {
  /** Where it was opened, on the screen. */
  at: Pt;
  items: MenuItem[];
  onClose: () => void;
}

const SCREEN_MARGIN = 8;

/** A list of actions over everything else: a press anywhere outside it only closes it. */
export const ContextMenu: React.FC<Props> = ({ at, items, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(at);

  // Stays on the screen near the edges: under the point there may be no room for it
  useLayoutEffect(() => {
    const { width, height } = menuRef.current!.getBoundingClientRect();
    setPosition({
      x: Math.max(SCREEN_MARGIN, Math.min(at.x, window.innerWidth - width - SCREEN_MARGIN)),
      y: Math.max(SCREEN_MARGIN, Math.min(at.y, window.innerHeight - height - SCREEN_MARGIN)),
    });
  }, [at]);

  return (
    <div
      className="context-menu-backdrop"
      onPointerDown={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div ref={menuRef} className="context-menu" role="menu" style={{ left: position.x, top: position.y }} onPointerDown={(e) => e.stopPropagation()}>
        {items.map(({ label, action, isDanger }) => (
          <button
            key={label}
            role="menuitem"
            className={isDanger ? 'danger' : ''}
            onClick={() => {
              onClose();
              action();
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
};
