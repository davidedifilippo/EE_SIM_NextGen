// Core data model. Everything here is plain JSON-serializable.
// Pt, Rotation, TerminalDef, Element and Wire are adapted from PowerCad_NextGen (see THIRD_PARTY_NOTICES.md).

export interface Pt { x: number; y: number }

export type Rotation = 0 | 90 | 180 | 270;

export interface TerminalDef {
  id: string;
  x: number;
  y: number;
}

/** How a component maps to SPICE. Terminal order follows the SPICE card. */
export type SpiceDef =
  | { kind: 'ground'; terminal: string }
  | { kind: 'passive'; prefix: 'R' | 'C' | 'L'; a: string; b: string; valueProp: string }
  | { kind: 'vsource'; pos: string; neg: string }
  | { kind: 'diode'; anode: string; cathode: string; modelProp: string };

export interface ComponentDef {
  id: string;
  name: string;
  terminals: TerminalDef[];
  spice: SpiceDef;
}

export interface Element {
  id: string;
  def: string;
  x: number;
  y: number;
  rot: Rotation;
  tag: string;
  props: Record<string, string | number>;
}

export interface Wire {
  id: string;
  pts: Pt[];
}

export interface SpiceModel {
  name: string;
  /** Full card, e.g. ".model D1N4148 D(IS=2.52n)". */
  card: string;
}

export interface Circuit {
  title: string;
  elements: Element[];
  wires: Wire[];
  models: SpiceModel[];
}
