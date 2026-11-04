import { Element, SpiceDef } from '../model/types';
import { parseSpiceValue } from '../netlist/values';

/** What a logic part computes. An input has no inputs of its own: it gives the level it is set to. */
export type GateKind = 'and' | 'or' | 'nand' | 'nor' | 'xor' | 'not' | 'input' | 'table' | 'clock' | 'dff' | 'counter';

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
  /** For a clock: its frequency. */
  frequency: number;
  /** For a counter: how many states before it starts again, 16 for binary, 10 for decimal. */
  modulus: number;
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
  let frequency = 0;
  if (s.gate === 'clock') {
    const value = parseSpiceValue(String(el.props.frequency ?? ''));
    if (value === null || value <= 0) return null;
    frequency = value;
  }
  const modulus = s.gate === 'counter' ? (String(el.props.modulus ?? '10') === '16' ? 16 : 10) : 0;
  return { vdd, state: s.stateProp !== undefined && String(el.props[s.stateProp]) === '1', table, frequency, modulus };
}

/** A clock is low for the first half of each period, then high: the first rising edge comes after half a period. */
export const clockLevel = (time: number, frequency: number) => (time * frequency) % 1 >= 0.5;

/**
 * A part with a memory, as the real-time engine and the netlist both read it: how many bits of state,
 * which inputs are data, clock and asynchronous set and reset, the next state at a rising edge of the
 * clock, and the outputs for a state. Outputs depend on the state alone.
 */
export interface SequentialSpec {
  stateBits: number;
  data: number[];
  clock: number;
  set: number | null;
  reset: number | null;
  next: (state: number, data: boolean[]) => number;
  outputs: (state: number) => number;
}

export function sequentialSpec(kind: GateKind, modulus: number): SequentialSpec | null {
  if (kind === 'dff') {
    // D, clock, set, reset; Q and its complement
    return { stateBits: 1, data: [0], clock: 1, set: 2, reset: 3, next: (_, [d]) => (d ? 1 : 0), outputs: (q) => (q ? 1 : 2) };
  }
  if (kind === 'counter') {
    // Clock and reset; outputs from the most significant bit down, as D C B A at the input of a decoder
    return {
      stateBits: 4,
      data: [],
      clock: 0,
      set: null,
      reset: 1,
      next: (q) => (q + 1) % modulus,
      outputs: (q) => [3, 2, 1, 0].reduce((bits, bit, j) => bits | (((q >> bit) & 1) << j), 0),
    };
  }
  return null;
}

/**
 * The next state of each bit as a truth table, for ngspice: rows over the state bits, most significant
 * first, then the data inputs. Bit i of a row is the next value of state bit i.
 */
export function nextStateTable(spec: SequentialSpec): number[] {
  const rows = 1 << (spec.stateBits + spec.data.length);
  return Array.from({ length: rows }, (_, row) => {
    const state = row >> spec.data.length;
    const data = spec.data.map((_, k) => ((row >> (spec.data.length - 1 - k)) & 1) === 1);
    return spec.next(state, data);
  });
}

/** The outputs as a truth table over the state bits, most significant first. */
export const outputTable = (spec: SequentialSpec) => Array.from({ length: 1 << spec.stateBits }, (_, state) => spec.outputs(state));

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
    case 'clock':
    case 'dff':
    case 'counter':
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
    case 'clock':
    case 'dff':
    case 'counter':
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
