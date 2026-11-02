import { describe, expect, it } from 'vitest';
import { loadThemeChoice, resolveTheme } from './theme';

describe('resolveTheme', () => {
  it('follows the system only on automatic', () => {
    expect(resolveTheme('auto', true)).toBe('dark');
    expect(resolveTheme('auto', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('loadThemeChoice', () => {
  const holding = (value: string | null) => ({ getItem: () => value });

  it('reads a saved choice', () => {
    expect(loadThemeChoice(holding('dark'))).toBe('dark');
    expect(loadThemeChoice(holding('light'))).toBe('light');
  });

  it('falls back on automatic with nothing valid or no storage', () => {
    expect(loadThemeChoice(holding(null))).toBe('auto');
    expect(loadThemeChoice(holding('purple'))).toBe('auto');
    const refusing = {
      getItem: () => {
        throw new Error('denied');
      },
    };
    expect(loadThemeChoice(refusing)).toBe('auto');
  });
});
