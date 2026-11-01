import { describe, expect, it } from 'vitest';
import { startsHidden } from './DcSweepChart';

const x = [0, 1, 2];

describe('startsHidden', () => {
  it('hides the swept voltage repeated on its own node', () => {
    expect(startsHidden([[0, 1, 2]], x)).toBe(true);
    expect(startsHidden([[0, 1, 2], [0, 1, 2]], x)).toBe(true);
  });

  it('hides what stays at zero', () => {
    expect(startsHidden([[0, 0, 0]], x)).toBe(true);
  });

  it('hides the flat lines of the second generator, in a family only', () => {
    expect(startsHidden([[2, 2, 2], [3, 3, 3]], x)).toBe(true);
    expect(startsHidden([[2, 2, 2]], x)).toBe(false);
  });

  it('keeps a real curve', () => {
    expect(startsHidden([[0, 0.5, 1]], x)).toBe(false);
    expect(startsHidden([[0, 1, 1], [0, 2, 2]], x)).toBe(false);
  });
});
