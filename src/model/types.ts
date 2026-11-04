// Core data model. Everything here is plain JSON-serializable.
// Pt, Rotation, Prim, TerminalDef, PropDef, Element and Wire are adapted from PowerCad_NextGen (see THIRD_PARTY_NOTICES.md).
import type { GateKind } from '../realtime/logic';
import type { SwitchKind } from '../realtime/switches';

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
  /** "range" is a number written as text, with a slider between min and max. */
  type: 'text' | 'model' | 'choice' | 'range';
  default: string;
  /** For type "model": the kind of SPICE model it accepts. */
  modelType?: ModelType;
  /** For type "choice". */
  options?: { value: string; label: string }[];
  /** For type "range". */
  min?: number;
  max?: number;
  step?: number;
}

/** What the plate and the datasheet of a geared DC motor say, at the output shaft. */
export interface MotorPlate {
  /** Rated voltage. */
  volts: number;
  /** Above this the supply is too high: the rated voltage and its tolerance. */
  vMax: number;
  noLoadRpm: number;
  noLoadCurrent: number;
  stallCurrent: number;
  /** Stall torque at the output shaft, in kgf·cm as datasheets give it. */
  stallTorque: number;
  /** Not on the datasheets: estimated for a motor of this size. */
  inductance: number;
  /** Mechanical time constant, estimated: it gives the inertia. */
  tauMech: number;
}

/**
 * An analog temperature sensor, as a regulator whose voltage is offset + slope × temperature. It gives
 * a valid output only with its supply between vMin and vMax; above vAbsMax it is damaged.
 */
export interface SensorSpec {
  offset: number;
  slope: number;
  tempProp: string;
  iMax: number;
  dropout: number;
  vMin: number;
  vMax: number;
  vAbsMax: number;
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
  | { kind: 'regulator'; input: string; output: string; ref: string; vNominal: number; polarity: 1 | -1; iq: number; sensor?: SensorSpec }
  /** A geared DC motor from its plate; the load is a braking torque in kgf·cm. */
  | { kind: 'motor'; plus: string; minus: string; plate: MotorPlate; loadProp: string }
  | { kind: 'block'; pins: string[]; modelProp: string }
  | { kind: 'meter'; a: string; b: string; modeProp: string }
  /** A mains transformer with a centre tap on the secondary, sized from its plate. */
  | { kind: 'ctransformer'; p1: string; p2: string; s1: string; ct: string; s2: string; primaryProp: string; secondaryProp: string; powerProp: string }
  /** Four diodes in a bridge: two alternating inputs, the positive and the negative output. */
  | { kind: 'bridge'; ac1: string; ac2: string; plus: string; minus: string; modelProp: string }
  /** Seven LED segments to a common cathode, in one part. */
  | { kind: 'display7'; segments: string[]; common: string; colorProp: string }
  /** A contact worked by hand: the common, and one way or two. */
  | { kind: 'switch'; switchKind: SwitchKind; common: string; ways: string[] }
  /** A gate or a logic input: supply in a property, inputs read against half of it, one output behind a resistance to ground. */
  | { kind: 'logic'; gate: GateKind; inputs: string[]; outputs: string[]; vddProp: string; stateProp?: string; /** For a truth table: where its rows are kept, or rows that never change. */ tableProp?: string; fixedTable?: string }
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
