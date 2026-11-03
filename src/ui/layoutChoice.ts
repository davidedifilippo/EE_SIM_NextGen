import { useEffect, useState } from 'react';

export type LayoutChoice = 'auto' | 'phone' | 'full';

/** Below this short side the screen is a phone, in either orientation. A tablet starts at 744 px. */
export const PHONE_SHORT_SIDE = 600;

const LAYOUT_KEY = 'ee-sim-nextgen/layout';

export const resolveLayout = (choice: LayoutChoice, width: number, height: number): 'phone' | 'full' =>
  choice === 'auto' ? (Math.min(width, height) < PHONE_SHORT_SIDE ? 'phone' : 'full') : choice;

/** A private window may refuse the storage: the choice then lasts for the visit. */
export function loadLayoutChoice(storage: Pick<Storage, 'getItem'>): LayoutChoice {
  try {
    const saved = storage.getItem(LAYOUT_KEY);
    return saved === 'phone' || saved === 'full' ? saved : 'auto';
  } catch {
    return 'auto';
  }
}

function saveLayoutChoice(choice: LayoutChoice) {
  try {
    localStorage.setItem(LAYOUT_KEY, choice);
  } catch {
    // Lasts for this visit only
  }
}

/** The layout to show now, following the size of the window unless the viewer picked one. */
export function useLayout(): ['phone' | 'full', (choice: LayoutChoice) => void] {
  const [choice, setChoice] = useState<LayoutChoice>(() => loadLayoutChoice(localStorage));
  const [size, setSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));

  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return [
    resolveLayout(choice, size.width, size.height),
    (next) => {
      // Back to automatic when the pick is what the screen would give anyway
      const stored = next === resolveLayout('auto', window.innerWidth, window.innerHeight) ? 'auto' : next;
      saveLayoutChoice(stored);
      setChoice(stored);
    },
  ];
}
