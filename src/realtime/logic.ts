import { Element, SpiceDef } from '../model/types';
import { parseSpiceValue } from '../netlist/values';

/** What a logic part computes. An input has no inputs of its own: it gives the level it is set to. */
export type GateKind = 'and' | 'or' | 'nand' | 'nor' | 'xor' | 'not' | 'input';

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
}

export function logicParams(el: Element, s: Extract<SpiceDef, { kind: 'logic' }>): LogicParams | null {
  const vdd = parseSpiceValue(String(el.props[s.vddProp] ?? ''));
  if (vdd === null || vdd <= 0) return null;
  return { vdd, state: s.stateProp !== undefined && String(el.props[s.stateProp]) === '1' };
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
  }
}

/** The smooth level of an input voltage for ngspice: 0 well below half the supply, 1 well above. */
export const levelExpression = (voltage: string, vdd: number) => `(0.5+0.5*tanh((${voltage}-${vdd / 2})/${vdd * LOGIC_EDGE_WIDTH}))`;
