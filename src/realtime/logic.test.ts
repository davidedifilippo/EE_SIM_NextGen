import { describe, expect, it } from 'vitest';
import { clockLevel, emptyTable, nextStateTable, outputTable, sequentialSpec, formatTable, gateExpression, gateOutput, GateKind, levelExpression, logicOutputs, parseTable, readLevel, tableExpression, tableRow } from './logic';

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

describe('truth tables', () => {
  it('read and write rows, the first output in bit 0', () => {
    const table = parseTable('00 01 10 11', 2, 2)!;
    expect(table).toEqual([0, 2, 1, 3]);
    expect(formatTable(table, 2)).toBe('00 01 10 11');
    expect(emptyTable(3, 2)).toBe('00 00 00 00 00 00 00 00');
  });

  it('refuse rows of the wrong number or length', () => {
    expect(parseTable('0 1 1', 2, 1)).toBeNull();
    expect(parseTable('0 1 1 2', 2, 1)).toBeNull();
    expect(parseTable('01 1 1 0', 2, 1)).toBeNull();
  });

  it('take the first input as the most significant bit', () => {
    expect(tableRow([true, false])).toBe(2);
    expect(tableRow([false, true, true])).toBe(3);
    const majority = parseTable('0 0 0 1 0 1 1 1', 3, 1)!;
    expect(logicOutputs('table', [true, true, false], false, majority)).toBe(1);
    expect(logicOutputs('table', [true, false, false], false, majority)).toBe(0);
  });

  it('give ngspice the same table, whichever way the expression is written', () => {
    for (const text of ['0 0 0 1 0 1 1 1', '1 1 1 0 1 1 1 1', '0 0 0 0 0 0 0 0', '1 1 1 1 1 1 1 1']) {
      const table = parseTable(text, 3, 1)!;
      for (let row = 0; row < 8; row++) {
        const levels = [(row >> 2) & 1, (row >> 1) & 1, row & 1].map(String);
        expect(evaluate(tableExpression(table, 0, levels))).toBeCloseTo(table[row] & 1, 9);
      }
    }
  });
});

describe('parts with a memory', () => {
  it('a clock starts low and rises after half a period', () => {
    expect(clockLevel(0, 1)).toBe(false);
    expect(clockLevel(0.49, 1)).toBe(false);
    expect(clockLevel(0.5, 1)).toBe(true);
    expect(clockLevel(1.2, 1)).toBe(false);
  });

  it('a decimal counter goes 0 to 9 and back, its outputs from the most significant bit', () => {
    const counter = sequentialSpec('counter', 10)!;
    expect(counter.next(9, [])).toBe(0);
    expect(counter.next(4, [])).toBe(5);
    // 5 = 0101: Q3 Q2 Q1 Q0 = 0 1 0 1, bit j for output j
    expect(counter.outputs(5)).toBe(0b1010);
    expect(sequentialSpec('counter', 16)!.next(9, [])).toBe(10);
  });

  it('a D flip-flop takes D and gives Q and its complement', () => {
    const dff = sequentialSpec('dff', 0)!;
    expect(dff.next(0, [true])).toBe(1);
    expect(dff.next(1, [false])).toBe(0);
    expect(dff.outputs(1)).toBe(1);
    expect(dff.outputs(0)).toBe(2);
  });

  it('writes the same rules as tables for ngspice', () => {
    const dff = sequentialSpec('dff', 0)!;
    // Rows: state, then D
    expect(nextStateTable(dff)).toEqual([0, 1, 0, 1]);
    const counter = sequentialSpec('counter', 10)!;
    expect(nextStateTable(counter).slice(0, 10)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 0]);
    expect(outputTable(counter)[5]).toBe(counter.outputs(5));
  });
});
