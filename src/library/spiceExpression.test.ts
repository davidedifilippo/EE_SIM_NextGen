import { describe, expect, it } from 'vitest';
import { evaluateExpression, readParams } from './spiceExpression';

const scope = new Map([['ices', 2e-10], ['ft', 3e8], ['hfe', 450]]);

describe('evaluateExpression', () => {
  it.each([
    ['2+3*4', 14],
    ['(2+3)*4', 20],
    ['-5', -5],
    ['2^3', 8],
    ['2**3', 8],
    ['2^3^2', 512],
    ['-2^2', 4],
    ['10/4', 2.5],
    ['1-2-3', -4],
    ['.5', 0.5],
    ['1e3', 1000],
    ['300Meg', 3e8],
    ['3.5p*2', 7e-12],
    ['Ices/2', 1e-10],
    ['HFE', 450],
    ['  1 + 1 ', 2],
  ])('computes %s', (text, value) => {
    expect(evaluateExpression(text, scope)).toBeCloseTo(value, 15);
  });

  it('knows pi', () => {
    expect(evaluateExpression('1/(2*pi*ft)', scope)).toBeCloseTo(5.3052e-10, 13);
  });

  it.each(['', 'unknown', '2+', '(2', '2)', '2 3', '1/0', 'alert(1)', 'process.exit()', '2;3', '[1]', 'a.b'])('refuses %j', (text) => {
    expect(evaluateExpression(text, scope)).toBeNull();
  });
});

describe('readParams', () => {
  it('reads pairs in order, each able to use the ones before', () => {
    const read = readParams('a=2 b={a*3} c=\'b+1\' d=4k', new Map());
    expect([...read]).toEqual([['a', 2], ['b', 6], ['c', 7], ['d', 4000]]);
  });

  it('adds to the outer values and can override them', () => {
    const read = readParams('x=1 y=5', new Map([['y', 2], ['z', 3]]));
    expect(read.get('y')).toBe(5);
    expect(read.get('z')).toBe(3);
  });

  it('leaves out what cannot be computed', () => {
    expect(readParams('a={nope}', new Map()).has('a')).toBe(false);
  });
});
