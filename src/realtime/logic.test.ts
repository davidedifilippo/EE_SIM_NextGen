import { describe, expect, it } from 'vitest';
import { gateExpression, gateOutput, GateKind, levelExpression, readLevel } from './logic';

const GATES: GateKind[] = ['and', 'or', 'nand', 'nor', 'xor'];
const TABLES: Record<string, boolean[]> = {
  and: [false, false, false, true],
  or: [false, true, true, true],
  nand: [true, true, true, false],
  nor: [true, false, false, false],
  xor: [false, true, true, false],
};
const PAIRS = [
  [false, false],
  [false, true],
  [true, false],
  [true, true],
];

describe('gateOutput', () => {
  it.each(GATES)('%s follows its truth table', (kind) => {
    expect(PAIRS.map((pair) => gateOutput(kind, pair))).toEqual(TABLES[kind]);
  });

  it('inverts and gives the level of an input', () => {
    expect(gateOutput('not', [false])).toBe(true);
    expect(gateOutput('not', [true])).toBe(false);
    expect(gateOutput('input', [], true)).toBe(true);
    expect(gateOutput('input', [], false)).toBe(false);
  });
});

describe('readLevel', () => {
  it('reads clear levels whatever came before', () => {
    expect(readLevel(4.9, 5, false)).toBe(true);
    expect(readLevel(0.1, 5, true)).toBe(false);
  });

  it('keeps the last level inside the band around half the supply', () => {
    expect(readLevel(2.5, 5, true)).toBe(true);
    expect(readLevel(2.5, 5, false)).toBe(false);
    expect(readLevel(2.7, 5, false)).toBe(false);
    expect(readLevel(2.8, 5, false)).toBe(true);
    expect(readLevel(2.3, 5, true)).toBe(true);
    expect(readLevel(2.2, 5, true)).toBe(false);
  });
});

/** The expressions use only arithmetic and tanh, which JavaScript has too. */
const evaluate = (expression: string): number => new Function(`return ${expression.replace(/tanh/g, 'Math.tanh')};`)();

describe('gateExpression', () => {
  const value = (kind: GateKind, a: number, b: number) => {
    const expression = gateExpression(kind, [levelExpression('va', 5), levelExpression('vb', 5)]);
    return evaluate(expression.replace(/va/g, String(a)).replace(/vb/g, String(b)));
  };

  it.each(GATES)('%s gives the same table as the real-time engine', (kind) => {
    const outputs = PAIRS.map(([a, b]) => value(kind, a ? 5 : 0, b ? 5 : 0));
    outputs.forEach((out, k) => expect(out).toBeCloseTo(TABLES[kind][k] ? 1 : 0, 6));
  });

  it('passes half way at half the supply', () => {
    expect(evaluate(levelExpression('2.5', 5))).toBeCloseTo(0.5, 9);
  });
});
