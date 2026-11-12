// Core data model. Everything here is plain JSON-serializable.
// Pt, Rotation, Prim, TerminalDef, PropDef, Element and Wire are adapted from PowerCad_NextGen (see THIRD_PARTY_NOTICES.md).
import type { GateKind } from '../realtime/logic';
import type { SwitchKind } from '../realtime/switches';
import type { StepVersion } from '../realtime/stepRelay';

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
  /** Kept with the part but edited elsewhere, as the program loaded in a board. */
  isHidden?: boolean;
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

/**
 * A relay from its datasheet: the coil, and the voltages at which it picks up and drops out at most and
 * at least. The contact closes above the first and opens below the second, with the coil current.
 */
export interface RelaySpec {
  coilVolts: number;
  coilResistance: number;
  /** Not on the datasheets: estimated for a coil of this size. */
  coilInductance: number;
  pickup: number;
  dropout: number;
}

/**
 * A 555 timer from the typical values of its datasheet: supply range, the internal divider, the output
 * stage, the discharge transistor and the current it takes at rest.
 */
export interface TimerSpec {
  name: string;
  vMin: number;
  vMax: number;
  vAbsMax: number;
  /** Each of the three equal resistors of the divider. */
  divider: number;
  /** The output high is the supply less this, behind rHigh; low, ground behind rLow. */
  highDrop: number;
  rHigh: number;
  rLow: number;
  rDischarge: number;
  /** Current at rest with 5 V, the divider included. */
  quiescent: number;
  /** Below this RESET clears the timer. */
  resetLevel: number;
  /** The most the output gives or takes. */
  iMax: number;
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
  /** The resistance between the ends a and b, and the wiper on it at a position from 0 (at a) to 100 (at b). */
  | { kind: 'pot'; a: string; b: string; wiper: string; valueProp: string; positionProp: string }
  /** An Arduino Uno: its pins in the order of the program, the 5V it gives, its ground; the program from an example or a loaded file. */
  | { kind: 'mcu'; pins: string[]; vcc: string; gnd: string; sketchProp: string; hexProp: string }
  /** A 555 timer, its pins by function. */
  | { kind: 'timer'; gnd: string; trig: string; out: string; reset: string; ctrl: string; thr: string; dis: string; vcc: string; spec: TimerSpec }
  /** A lamp from its rating: the power it gives at its rated voltage, as a resistance V²/P. */
  | { kind: 'lamp'; a: string; b: string; powerProp: string; voltsProp: string }
  /** An optocoupler: LED from anode to cathode, phototransistor from collector to emitter; its CTR class in a property. */
  | { kind: 'opto'; anode: string; cathode: string; collector: string; emitter: string; ctrProp: string }
  /**
   * The coil between coil1 and coil2; a normally open contact between c1, the common, and c2. A changeover
   * relay has a normally closed contact as well, from the common to nc.
   */
  | { kind: 'relay'; coil1: string; coil2: string; c1: string; c2: string; nc?: string; spec: RelaySpec }
  /** A solid state relay: the input from plus to minus, the triac output from out1 to out2; its version in three properties. */
  | { kind: 'ssr'; plus: string; minus: string; out1: string; out2: string; currentProp: string; typeProp: string; controlProp: string }
  /**
   * A step relay: the coil from A1, common to the contacts as well, to A2; each pull of the armature moves the
   * contacts to the next sequence, from A1 to c2 and, on two contacts, to c4.
   */
  | { kind: 'steprelay'; common: string; coil2: string; c2: string; c4?: string; version: StepVersion; coilProp: string }
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
  | { kind: 'logic'; gate: GateKind; inputs: string[]; outputs: string[]; vddProp: string; stateProp?: string; /** For a truth table: where its rows are kept, or rows that never change. */ tableProp?: string; fixedTable?: string; /** For a part made of parts: the id of its inner schematic. */ network?: string }
  /** A pin of the inner schematic of a part made of parts: its tag is the name of the pin. */
  | { kind: 'port'; direction: 'in' | 'out' }
  /** A block made from a whole circuit: opened into its parts before either engine sees it. */
  | { kind: 'userblock'; blockId: string }
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

/** A whole circuit used as a part: its pins are the flags in it, the name of each flag is the name of its pin. */
export interface BlockDef {
  /** From the content: two versions of a block never take each other's place. */
  id: string;
  name: string;
  circuit: Circuit;
}

export interface Circuit {
  title: string;
  elements: Element[];
  wires: Wire[];
  models: SpiceModel[];
  /** The blocks the circuit uses, those inside other blocks too. */
  blocks?: BlockDef[];
  /**
   * Terminals joined as one node with no wire between them: the pin of a block and its flag inside, once
   * the block is opened; present, even empty, only on a circuit already opened. Never saved.
   */
  ties?: [string, string][];
}
