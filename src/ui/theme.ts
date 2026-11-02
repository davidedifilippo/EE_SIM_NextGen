import { useEffect, useState } from 'react';

export type ThemeChoice = 'auto' | 'light' | 'dark';

export const THEME_CHOICES: { value: ThemeChoice; label: string }[] = [
  { value: 'auto', label: 'Automatico' },
  { value: 'light', label: 'Chiaro' },
  { value: 'dark', label: 'Scuro' },
];

const THEME_KEY = 'ee-sim-nextgen/theme';

export const resolveTheme = (choice: ThemeChoice, isSystemDark: boolean): 'light' | 'dark' => (choice === 'auto' ? (isSystemDark ? 'dark' : 'light') : choice);

/** Follows the system until the viewer picks one. A private window may refuse the storage: the page works anyway. */
export function loadThemeChoice(storage: Pick<Storage, 'getItem'>): ThemeChoice {
  try {
    const saved = storage.getItem(THEME_KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'auto';
  } catch {
    return 'auto';
  }
}

function saveThemeChoice(choice: ThemeChoice) {
  try {
    localStorage.setItem(THEME_KEY, choice);
  } catch {
    // Lasts for this visit only
  }
}

/** The choice of the viewer, kept on the page element where the styles read it. */
export function useTheme(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>(() => loadThemeChoice(localStorage));

  useEffect(() => {
    const system = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme = resolveTheme(choice, system.matches);
    };
    apply();
    system.addEventListener('change', apply);
    return () => system.removeEventListener('change', apply);
  }, [choice]);

  return [
    choice,
    (next) => {
      saveThemeChoice(next);
      setChoice(next);
    },
  ];
}
