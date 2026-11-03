import { describe, expect, it } from 'vitest';
import { loadLayoutChoice, resolveLayout } from './layoutChoice';

describe('resolveLayout', () => {
  it('gives phones the phone layout in both orientations', () => {
    expect(resolveLayout('auto', 375, 812)).toBe('phone');
    expect(resolveLayout('auto', 844, 390)).toBe('phone');
    expect(resolveLayout('auto', 412, 915)).toBe('phone');
  });

  it('leaves tablets and computers on the full layout', () => {
    expect(resolveLayout('auto', 744, 1133)).toBe('full');
    expect(resolveLayout('auto', 1024, 768)).toBe('full');
    expect(resolveLayout('auto', 1440, 900)).toBe('full');
  });

  it('follows a choice of the viewer whatever the screen', () => {
    expect(resolveLayout('full', 375, 812)).toBe('full');
    expect(resolveLayout('phone', 1440, 900)).toBe('phone');
  });
});

describe('loadLayoutChoice', () => {
  const holding = (value: string | null) => ({ getItem: () => value });

  it('reads a saved choice and ignores anything else', () => {
    expect(loadLayoutChoice(holding('phone'))).toBe('phone');
    expect(loadLayoutChoice(holding('full'))).toBe('full');
    expect(loadLayoutChoice(holding(null))).toBe('auto');
    expect(loadLayoutChoice(holding('tablet'))).toBe('auto');
  });

  it('falls back on automatic without storage', () => {
    const refusing = {
      getItem: () => {
        throw new Error('denied');
      },
    };
    expect(loadLayoutChoice(refusing)).toBe('auto');
  });
});
