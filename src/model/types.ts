// Core data model. Everything here is plain JSON-serializable.
// Pt, Rotation, Prim, TerminalDef, PropDef, Element and Wire are adapted from PowerCad_NextGen (see THIRD_PARTY_NOTICES.md).
import type { GateKind } from '../realtime/logic';

export interface Pt { x: number; y: number }

export type Rotation = 0 | 90 | 180 | 270;

interface PrimBase { stroke?: string; w?: number }
export type Prim =
  | (PrimBase & { t: 'line'; x1: number; y1: number; x2: number; y2: number })
  | (PrimBase & { t: 'rect'; x: number; y: number; w: number; h: number; fill?: string })
  | (PrimBase & { t: 'circle'; cx: number; cy: number; r: number; fill?: string })
  | (PrimBase & { t: 'path'; d: string; fill?: string });

export interface TerminalDef {
  id: string;
  x: number;
  y: number;
}

export interface PropDef {
  key: string;
  label: string;
  /** "model" lists the SPICE models defined in the circuit; "choice" lists the options. */
  type: 'text' | 'model' | 'choice';
  default: string;
  /** For type "model": the kind of SPICE model it accepts. */
  modelType?: ModelType;
  /** For type "choice". */
  options?: { value: string; label: string }[];
}

/** OPAMP is a subcircuit with five pins, in place of the ideal part; REGULATOR one with three, in place of the simple behaviour; SUBCKT is any subcircuit, as a block of its own. */
export type ModelType = 'D' | 'NPN' | 'PNP' | 'NMOS' | 'PMOS' | 'OPAMP' | 'SUBCKT' | 'REGULATOR';

/** How a component maps to SPICE. Terminal order follows the SPICE card. */
export type SpiceDef =
  | { kind: 'ground'; terminal: string }
  | { kind: 'passive'; prefix: 'R' | 'C' | 'L'; a: string; b: string; valueProp: string }
  | { kind: 'vsource'; pos: string; neg: string }
  /** The current goes through it from a to b. */
  | { kind: 'isource'; a: string; b: string; valueProp: string }
  | { kind: 'diode'; anode: string; cathode: string; modelProp: string }
  | { kind: 'bjt'; collector: string; base: string; emitter: string; modelProp: string; modelType: 'NPN' | 'PNP' }
  | { kind: 'mos'; drain: string; gate: string; source: string; modelProp: string; modelType: 'NMOS' | 'PMOS' }
  | { kind: 'opamp'; plus: string; minus: string; out: string; highProp: string; lowProp: string; gbwProp: string; modelProp: string; pinsProp: string }
  /** ref is ground, or ADJ on an adjustable part; polarity is -1 on those for negative voltages. */
  | { kind: 'regulator'; input: string; output: string; ref: string; vNominal: number; polarity: 1 | -1; iq: number }
  | { kind: 'block'; pins: string[]; modelProp: string }
  | { kind: 'meter'; a: string; b: string; modeProp: string }
  /** A gate or a logic input: supply in a property, inputs read against half of it, one output behind a resistance to ground. */
  | { kind: 'logic'; gate: GateKind; inputs: string[]; output: string; vddProp: string; stateProp?: string }
  | { kind: 'transformer'; p1: string; p2: string; s1: string; s2: string; ratioProp: string; inductanceProp: string; couplingProp: string };

export interface ComponentDef {
  id: string;
  name: string;
  /** The section of the library. */
  category: string;
  /** Default tag prefix, e.g. "R". Omit for components without a tag (ground). */
  tagPrefix?: string;
  terminals: TerminalDef[];
  symbol: Prim[];
  props: PropDef[];
  spice: SpiceDef;
  /** Other words it can be found by in the library. */
  searchTerms?: string;
  /** Not in the list of parts: reached from another, as a block changes with the pins of its model. */
  isHidden?: boolean;
}

export interface Element {
  id: string;
  def: string;
  x: number;
  y: number;
  rot: Rotation;
  /** Mirrored top to bottom, before the rotation. */
  flip?: boolean;
  tag: string;
  props: Record<string, string | number>;
}

export interface Wire {
  id: string;
  pts: Pt[];
}

export interface SpiceModel {
  name: string;
  /** Full card, e.g. ".model D1N4148 D(IS=2.52n)". A subcircuit takes several lines. */
  card: string;
}

export interface Circuit {
  title: string;
  elements: Element[];
  wires: Wire[];
  models: SpiceModel[];
}
