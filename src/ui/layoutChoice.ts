import { useEffect, useState } from 'react';

export type LayoutChoice = 'auto' | 'phone' | 'full';

/** Below this short side the screen is a phone, in either orientation. A tablet starts at 744 px. */
export const PHONE_SHORT_SIDE = 600;

const LAYOUT_KEY = 'ee-sim-nextgen/layout';

export interface Size {
  width: number;
  height: number;
}

/**
 * The window can be wider than the screen it is on: a phone asked for the desktop version of a site lays
 * the page out on some 980 px, whatever the page declares. The screen itself then tells a phone.
 */
export const resolveLayout = (choice: LayoutChoice, width: number, height: number, screen: Size = { width, height }): 'phone' | 'full' =>
  choice === 'auto' ? (Math.min(width, height, screen.width, screen.height) < PHONE_SHORT_SIDE ? 'phone' : 'full') : choice;

/** What the viewer may pick for the size of the controls of the phone layout, over what the screen asks. */
export const CONTROL_SIZES = [0.75, 1, 1.25, 1.5, 1.75, 2];
const [MIN_CONTROL_SCALE, MAX_CONTROL_SCALE] = [0.75, 4];
/** A window this little wider than the screen is a rounding of the browser, not a page laid out wide. */
const WIDE_PAGE = 1.15;

/**
 * How much the controls of the phone layout grow: by as much as the page is wider than the screen, so that
 * a button keeps the size of a finger, times the pick of the viewer. Some phones do not turn the sides of
 * the screen with the device: the window says which side is the width.
 */
export function controlScale(window: Size, screen: Size, multiplier = 1): number {
  const screenWidth = window.width > window.height ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
  const wide = screenWidth > 0 ? window.width / screenWidth : 1;
  const auto = wide > WIDE_PAGE ? wide : 1;
  return Math.max(MIN_CONTROL_SCALE, Math.min(MAX_CONTROL_SCALE, auto * multiplier));
}

const CONTROL_SIZE_KEY = 'ee-sim-nextgen/control-size';

/** The saved pick, 1 for none or for anything that is not one of the sizes. */
export function loadControlSize(storage: Pick<Storage, 'getItem'>): number {
  try {
    const saved = Number(storage.getItem(CONTROL_SIZE_KEY));
    return CONTROL_SIZES.includes(saved) ? saved : 1;
  } catch {
    return 1;
  }
}

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
    resolveLayout(choice, size.width, size.height, window.screen),
    (next) => {
      // Back to automatic when the pick is what the screen would give anyway
      const stored = next === resolveLayout('auto', window.innerWidth, window.innerHeight, window.screen) ? 'auto' : next;
      saveLayoutChoice(stored);
      setChoice(stored);
    },
  ];
}

/** The scale of the controls of the phone layout now, the pick of the viewer, and how to change it. */
export function useControlScale(): { scale: number; size: number; setSize: (size: number) => void } {
  const [size, setSizeState] = useState(() => loadControlSize(localStorage));
  const [page, setPage] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));

  useEffect(() => {
    const onResize = () => setPage({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return {
    scale: controlScale(page, window.screen, size),
    size,
    setSize: (next) => {
      try {
        localStorage.setItem(CONTROL_SIZE_KEY, String(next));
      } catch {
        // Lasts for this visit only
      }
      setSizeState(next);
    },
  };
}
