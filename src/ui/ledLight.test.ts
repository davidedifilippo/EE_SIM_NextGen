import { describe, expect, it } from 'vitest';
import { ledLight, ledPercent, ledRated } from './ledLight';

describe('the light of a LED against its rated current', () => {
  it('reads 100% at its rated current, and follows the mean current of a PWM', () => {
    const rated = ledRated('20');
    expect(ledPercent(0.02, rated)).toBeCloseTo(100, 6);
    // A PWM at a quarter of 20 mA
    expect(ledPercent(0.005, rated)).toBeCloseTo(25, 6);
    expect(ledPercent(0.03, rated)).toBeCloseTo(150, 6);
  });

  it('takes the common 20 mA when the rating is missing or not a number', () => {
    expect(ledRated(undefined)).toBe(0.02);
    expect(ledRated('abc')).toBe(0.02);
    expect(ledRated('10')).toBe(0.01);
  });

  it('draws a quarter of the current as half the light, and every step as a change', () => {
    const rated = 0.02;
    expect(ledLight(0.005, rated)).toBeCloseTo(0.5, 6);
    expect(ledLight(0.02, rated)).toBe(1);
    expect(ledLight(0.04, rated)).toBe(1);
    expect(ledLight(0.01, rated)).toBeGreaterThan(ledLight(0.005, rated));
  });
});
