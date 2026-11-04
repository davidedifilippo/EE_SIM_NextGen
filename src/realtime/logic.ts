import { Element, SpiceDef } from '../model/types';
import { parseSpiceValue } from '../netlist/values';

/** What a logic part computes. An input has no inputs of its own: it gives the level it is set to. */
export type GateKind = 'and' | 'or' | 'nand' | 'nor' | 'xor' | 'not' | 'input' | 'table';

/** Behind each output, as the push-pull stage of a CMOS gate: enough to light a LED through its resistor. */
export const LOGIC_OUTPUT_RESISTANCE = 100;
/** Each input, to ground: it takes almost nothing from what drives it. */
export const LOGIC_INPUT_RESISTANCE = 1e6;
/** Band around half the supply where an input keeps the level it had, as a fraction of the supply. */
export const LOGIC_HYSTERESIS = 0.1;
/** Width of the step from 0 to 1 in the netlist, as a fraction of the supply: smooth, for Newton. */
export const LOGIC_EDGE_WIDTH = 0.02;

export interface LogicParams {
  vdd: number;
  /** For an input: the level it is set to. */
  state: boolean;
  /** For a truth table: the outputs of each row, one bit per output, the first output in bit 0. */
  table: number[] | null;
}

/** Most inputs and outputs of a truth table: 64 rows still fit on a phone, 8 outputs drive a display. */
export const MAX_TABLE_INPUTS = 6;
export const MAX_TABLE_OUTPUTS = 8;

/**
 * Rows of a truth table as text: one group of 0 and 1 per row, one digit per output, rows in the
 * order of the inputs read as a binary number with the first input as the most significant bit.
 */
export function parseTable(text: string, inputs: number, outputs: number): number[] | null {
  const rows = text.trim().split(/\s+/).filter(Boolean);
  if (rows.length !== 1 << inputs || rows.some((row) => !new RegExp(`^[01]{${outputs}}$`).test(row))) return null;
  return rows.map((row) => [...row].reduce((bits, digit, j) => (digit === '1' ? bits | (1 << j) : bits), 0));
}

export function formatTable(table: number[], outputs: number): string {
  return table.map((bits) => Array.from({ length: outputs }, (_, j) => ((bits >> j) & 1 ? '1' : '0')).join('')).join(' ');
}

/** A table of the given size with every output at 0. */
export const emptyTable = (inputs: number, outputs: number) => Array.from({ length: 1 << inputs }, () => '0'.repeat(outputs)).join(' ');

/** Row of the table for a set of input levels: the first input is the most significant bit. */
export const tableRow = (levels: boolean[]) => levels.reduce((row, level) => (row << 1) | (level ? 1 : 0), 0);

export function logicParams(el: Element, s: Extract<SpiceDef, { kind: 'logic' }>): LogicParams | null {
  const vdd = parseSpiceValue(String(el.props[s.vddProp] ?? ''));
  if (vdd === null || vdd <= 0) return null;
  let table: number[] | null = null;
  if (s.gate === 'table') {
    table = parseTable(s.fixedTable ?? String(el.props[s.tableProp ?? ''] ?? ''), s.inputs.length, s.outputs.length);
    if (!table) return null;
  }
  return { vdd, state: s.stateProp !== undefined && String(el.props[s.stateProp]) === '1', table };
}

/** All the outputs of a logic part at once, one bit per output. */
export function logicOutputs(kind: GateKind, inputs: boolean[], state: boolean, table: number[] | null): number {
  if (kind === 'table') return table ? table[tableRow(inputs)] : 0;
  return gateOutput(kind, inputs, state) ? 1 : 0;
}

/** The level an input reads, keeping the last one inside the band: a slow or noisy edge does not chatter. */
export function readLevel(voltage: number, vdd: number, previous: boolean): boolean {
  if (voltage > vdd * (0.5 + LOGIC_HYSTERESIS / 2)) return true;
  if (voltage < vdd * (0.5 - LOGIC_HYSTERESIS / 2)) return false;
  return previous;
}

export function gateOutput(kind: GateKind, inputs: boolean[], state = false): boolean {
  const [a = false, b = false] = inputs;
  switch (kind) {
    case 'and':
      return a && b;
    case 'or':
      return a || b;
    case 'nand':
      return !(a && b);
    case 'nor':
      return !(a || b);
    case 'xor':
      return a !== b;
    case 'not':
      return !a;
    case 'input':
      return state;
    case 'table':
      return false;
  }
}

/**
 * The same function for ngspice, on levels that are expressions between 0 and 1. Products and
 * complements of smooth steps: the output passes from 0 to 1 without corners.
 */
export function gateExpression(kind: GateKind, levels: string[], state = false): string {
  const [a = '0', b = '0'] = levels;
  switch (kind) {
    case 'and':
      return `${a}*${b}`;
    case 'or':
      return `(1-(1-${a})*(1-${b}))`;
    case 'nand':
      return `(1-${a}*${b})`;
    case 'nor':
      return `(1-${a})*(1-${b})`;
    case 'xor':
      return `(${a}+${b}-2*${a}*${b})`;
    case 'not':
      return `(1-${a})`;
    case 'input':
      return state ? '1' : '0';
    case 'table':
      return '0';
  }
}

/**
 * One output of a truth table for ngspice, on levels between 0 and 1: the sum of the rows where it is
 * 1, each the product of its inputs or their complements. With more rows at 1, the complement of the
 * rows at 0, which is shorter.
 */
export function tableExpression(table: number[], output: number, levels: string[]): string {
  const ones = table.map((bits, row) => ((bits >> output) & 1 ? row : -1)).filter((row) => row >= 0);
  if (ones.length === 0) return '0';
  if (ones.length === table.length) return '1';
  const useZeros = ones.length > table.length / 2;
  const rows = useZeros ? table.map((_, row) => row).filter((row) => !ones.includes(row)) : ones;
  const n = levels.length;
  const term = (row: number) => levels.map((level, k) => ((row >> (n - 1 - k)) & 1 ? level : `(1-${level})`)).join('*');
  const sum = rows.map(term).join('+');
  return useZeros ? `(1-(${sum}))` : `(${sum})`;
}

/** The smooth level of an input voltage for ngspice: 0 well below half the supply, 1 well above. */
export const levelExpression = (voltage: string, vdd: number) => `(0.5+0.5*tanh((${voltage}-${vdd / 2})/${vdd * LOGIC_EDGE_WIDTH}))`;
