import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  /** Opened by a finger held still, which is still on the screen when the menu appears. */
  byFinger?: boolean;
  onClose: () => void;
}

const SCREEN_MARGIN = 8;
/** Beside the finger, not under it: the item there would light up, and the release could choose it. */
const FINGER_OFFSET = 18;
/** After the finger that opened the menu lifts, the click the browser makes of that release still arrives. */
const RELEASE_CLICK_MS = 400;

/** A list of actions over everything else: a press anywhere outside it only closes it. */
export const ContextMenu: React.FC<Props> = ({ at, items, byFinger = false, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(at);
  /** When the items start to listen: never, until the finger that opened the menu has lifted. */
  const readyAtRef = useRef(byFinger ? Infinity : 0);

  useEffect(() => {
    if (!byFinger) return;
    const onLift = () => {
      readyAtRef.current = performance.now() + RELEASE_CLICK_MS;
    };
    window.addEventListener('pointerup', onLift, { once: true });
    window.addEventListener('pointercancel', onLift, { once: true });
    return () => {
      window.removeEventListener('pointerup', onLift);
      window.removeEventListener('pointercancel', onLift);
    };
  }, [byFinger]);

  // Stays on the screen near the edges: under the point there may be no room for it
  useLayoutEffect(() => {
    const { width, height } = menuRef.current!.getBoundingClientRect();
    // On a phone layout the menu may be drawn larger: its place is then written in its own, larger pixels
    const scale = Number(getComputedStyle(menuRef.current!).zoom) || 1;
    const offset = (byFinger ? FINGER_OFFSET : 0) * scale;
    setPosition({
      x: Math.max(SCREEN_MARGIN, Math.min(at.x + offset, window.innerWidth - width - SCREEN_MARGIN)) / scale,
      y: Math.max(SCREEN_MARGIN, Math.min(at.y + offset, window.innerHeight - height - SCREEN_MARGIN)) / scale,
    });
  }, [at, byFinger]);

  return (
    <div
      className="context-menu-backdrop"
      onPointerDown={onClose}
      // Android ends a long press with this event, where the finger is: over this backdrop now
      onContextMenu={(e) => e.preventDefault()}
    >
      <div ref={menuRef} className="context-menu" role="menu" style={{ left: position.x, top: position.y }} onPointerDown={(e) => e.stopPropagation()}>
        {items.map(({ label, action, isDanger }) => (
          <button
            key={label}
            role="menuitem"
            className={isDanger ? 'danger' : ''}
            onClick={() => {
              if (performance.now() < readyAtRef.current) return;
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
