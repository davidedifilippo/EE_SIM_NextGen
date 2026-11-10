import { describe, expect, it } from 'vitest';
import { controlScale, loadControlSize, loadLayoutChoice, resolveLayout } from './layoutChoice';

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

  it('tells a phone by its screen when the page is laid out wide, as with the desktop version asked', () => {
    expect(resolveLayout('auto', 980, 2180, { width: 412, height: 915 })).toBe('phone');
    expect(resolveLayout('auto', 2180, 980, { width: 915, height: 412 })).toBe('phone');
    // A narrow window on the screen of a computer is still a phone layout, a wide one is not
    expect(resolveLayout('auto', 500, 900, { width: 1920, height: 1080 })).toBe('phone');
    expect(resolveLayout('auto', 1400, 900, { width: 1920, height: 1080 })).toBe('full');
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

describe('controlScale', () => {
  const phone = { width: 412, height: 915 };

  it('grows the controls by as much as the page is wider than the screen', () => {
    expect(controlScale({ width: 980, height: 2180 }, phone)).toBeCloseTo(980 / 412, 5);
    expect(controlScale({ width: 2180, height: 980 }, { width: 915, height: 412 })).toBeCloseTo(2180 / 915, 5);
  });

  it('leaves them alone on a page as wide as its screen, or narrower', () => {
    expect(controlScale({ width: 412, height: 915 }, phone)).toBe(1);
    expect(controlScale({ width: 500, height: 900 }, { width: 1920, height: 1080 })).toBe(1);
    expect(controlScale({ width: 1440, height: 900 }, { width: 1920, height: 1080 })).toBe(1);
  });

  it('knows the width of a turned phone whose screen does not turn its sides', () => {
    expect(controlScale({ width: 844, height: 390 }, { width: 390, height: 844 })).toBe(1);
  });

  it('applies the pick of the viewer, within limits', () => {
    expect(controlScale({ width: 412, height: 915 }, phone, 1.5)).toBe(1.5);
    expect(controlScale({ width: 980, height: 2180 }, phone, 2)).toBe(4);
    expect(controlScale({ width: 412, height: 915 }, phone, 0.75)).toBe(0.75);
  });

  it('reads a saved size and ignores anything else', () => {
    expect(loadControlSize({ getItem: () => '1.5' })).toBe(1.5);
    expect(loadControlSize({ getItem: () => null })).toBe(1);
    expect(loadControlSize({ getItem: () => '7' })).toBe(1);
  });
});
