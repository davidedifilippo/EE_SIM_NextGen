import { Circuit, ModelType } from '../model/types';
import { getDevice } from '../library/devices';
import { findModel, isVdmos, modelType } from '../library/models';
import { computeConnectivity, terminalKey } from '../netlist/connectivity';
import { OPAMP_GAIN, transformerWindings } from '../netlist/generate';
import { METER_TEST_CURRENT, meterResistance } from './meter';
import { GateKind, LogicNetwork, logicParams } from './logic';
import { logicNetwork } from '../library/composites';
import { RegulatorParams, regulatorParams } from './regulator';
import { MotorParams, motorParamsOf } from './motor';
import { contactResistances } from './switches';
import { potResistances } from './pot';
import { LampParams, lampParams, lampRating } from './lamp';
import { ctrOf, ledParams, PC817 } from './opto';
import { parseIntelHex, programKey } from './intelHex';
import { sketchHex } from '../samples/arduino/sketches';
import { RelaySpec } from './relay';
import { SsrSpec, ssrSpecOf } from './ssr';
import { TimerSpec } from './timer555';
import { segmentColor } from './display7';
import { ctTransformerParams } from './ctTransformer';
import { internalResistance, sourceSpec } from '../netlist/source';
import { parseSpiceValue } from '../netlist/values';
import { parseWaveform, Waveform } from './waveform';

/** Thermal voltage at 27 °C, the temperature SPICE assumes. */
const THERMAL_VOLTAGE = 0.025865;

/** Unknown index of a node, or -1 for ground. */
export type NodeIndex = number;

export interface DiodeParams {
  is: number;
  /** Emission coefficient times thermal voltage. */
  nvt: number;
  rs: number;
  /** Reverse breakdown, if the model has one. */
  breakdown: { voltage: number; nvt: number } | null;
}

/** DC part of the Gummel-Poon model. Voltages n*Vt are ready for the exponentials; o-prefixed values are inverses, 0 for "not given". */
export interface BjtParams {
  polarity: 1 | -1;
  is: number;
  bf: number;
  br: number;
  vt: number;
  nfVt: number;
  nrVt: number;
  ise: number;
  neVt: number;
  isc: number;
  ncVt: number;
  ovaf: number;
  ovar: number;
  oikf: number;
  oikr: number;
  /** High-injection roll-off exponent. */
  nkf: number;
  rb: number;
  rc: number;
  re: number;
}

/** Shichman-Hodges: the level 1 MOSFET and, with the smooth threshold, the VDMOS. */
export interface MosParams {
  polarity: 1 | -1;
  beta: number;
  /** Threshold in the sign of the N channel. */
  vth: number;
  lambda: number;
  rd: number;
  rs: number;
  /** Width of the smooth threshold; 0 for a sharp one. */
  subthreshold: number;
  /** Scales the drain voltage in the triode region. */
  mtriode: number;
  /** A VDMOS applies lambda with the sign of the actual drain voltage. */
  signedLambda: boolean;
  /** Series resistance of the body diode, on a VDMOS only. */
  rb: number;
  body: DiodeParams;
}

export type CompiledDevice =
  | { kind: 'resistor'; element: number; a: NodeIndex; b: NodeIndex; g: number }
  | { kind: 'capacitor'; element: number; a: NodeIndex; b: NodeIndex; c: number }
  | { kind: 'inductor'; element: number; a: NodeIndex; b: NodeIndex; l: number; branch: number }
  /** r is the internal resistance, in the branch equation: 0 for an ideal source. */
  | { kind: 'vsource'; element: number; a: NodeIndex; b: NodeIndex; wave: Waveform; r: number; branch: number }
  | { kind: 'isource'; element: number; a: NodeIndex; b: NodeIndex; current: number }
  /** a is the external anode, junction the node after the series resistance (a itself if rs is 0). */
  | { kind: 'diode'; element: number; a: NodeIndex; junction: NodeIndex; b: NodeIndex; params: DiodeParams }
  /** a is the collector and b the emitter; the primed nodes come after the series resistances. */
  | { kind: 'bjt'; element: number; a: NodeIndex; b: NodeIndex; base: NodeIndex; cp: NodeIndex; bp: NodeIndex; ep: NodeIndex; params: BjtParams }
  /** a is the drain, b the source and base the gate; the primed nodes come after the series resistances, bodyNode after that of the body diode. */
  | { kind: 'mos'; element: number; a: NodeIndex; b: NodeIndex; base: NodeIndex; dp: NodeIndex; sp: NodeIndex; bodyNode: NodeIndex; params: MosParams }
  /** a is the output, b is always ground. */
  | { kind: 'opamp'; element: number; a: NodeIndex; b: NodeIndex; plus: NodeIndex; minus: NodeIndex; high: number; low: number; /** Time constant of the open loop pole; 0 for no limit. */ tau: number; branch: number }
  /** a is the input, b the output and base the reference. */
  | { kind: 'regulator'; element: number; a: NodeIndex; b: NodeIndex; base: NodeIndex; params: RegulatorParams }
  /** A geared DC motor: R and L in series from a to the inner node e, then the inertia as a capacitor to b with the brake in parallel. */
  | { kind: 'motor'; element: number; a: NodeIndex; b: NodeIndex; e: NodeIndex; branch: number; params: MotorParams }
  /**
   * Three coupled windings: the primary, the upper and the lower half of the secondary. starts and ends
   * are their terminals, inner the node after the series resistance; m holds the self and mutual
   * inductances, row by row.
   */
  | { kind: 'ctransformer'; element: number; a: NodeIndex; b: NodeIndex; starts: NodeIndex[]; ends: NodeIndex[]; inner: NodeIndex[]; r: number[]; m: number[]; core: number; branches: number[] }
  /**
   * a is the positive output and b the negative one. The four diodes go from ac1 and ac2 to the
   * positive, and from the negative to ac1 and ac2; junction is the node after the series resistance of each.
   */
  | { kind: 'bridge'; element: number; a: NodeIndex; b: NodeIndex; ac1: NodeIndex; ac2: NodeIndex; anodes: NodeIndex[]; cathodes: NodeIndex[]; junctions: NodeIndex[]; params: DiodeParams }
  /** a is the first segment, b the common cathode; forward is the voltage where the segments start to light. */
  | { kind: 'display7'; element: number; a: NodeIndex; b: NodeIndex; segments: NodeIndex[]; forward: number }
  /** An optocoupler: the LED from a to b, junction after its series resistance; the phototransistor from c to e, CTR times the LED current. */
  | { kind: 'opto'; element: number; a: NodeIndex; b: NodeIndex; junction: NodeIndex; c: NodeIndex; e: NodeIndex; params: DiodeParams; ctr: number }
  /**
   * A solid state relay: the input from a (+) to b (−) as its impedance; the triac from c to d, on or off
   * as the engine decides between steps; the snubber from c to the inner node s, then its capacitor to d.
   */
  | { kind: 'ssr'; element: number; a: NodeIndex; b: NodeIndex; c: NodeIndex; d: NodeIndex; s: NodeIndex; spec: SsrSpec }
  /** A lamp: its filament as a resistance, which the engine moves between steps with the heat it takes. */
  | { kind: 'lamp'; element: number; a: NodeIndex; b: NodeIndex; params: LampParams }
  /** A potentiometer: g1 from the end a to the wiper w, g2 from the wiper to the end b. */
  | { kind: 'pot'; element: number; a: NodeIndex; b: NodeIndex; w: NodeIndex; g1: number; g2: number }
  /**
   * A relay: the coil from a to b as R and L in one branch; the normally open contact from the common c to
   * d, closed with the coil current; for a changeover, the normally closed one from c to nc, the other way.
   */
  | { kind: 'relay'; element: number; a: NodeIndex; b: NodeIndex; c: NodeIndex; d: NodeIndex; nc: NodeIndex | null; branch: number; spec: RelaySpec }
  /** An Arduino Uno: a is its 5V, a source behind a small resistance in its branch, b its ground; pins in the order of the program. */
  | { kind: 'mcu'; element: number; a: NodeIndex; b: NodeIndex; pins: NodeIndex[]; branch: number; program: Uint16Array; programKey: string }
  /** A 555: a is OUT and b GND; lower is the inner node of the divider at a third of the supply. */
  | { kind: 'timer'; element: number; a: NodeIndex; b: NodeIndex; trig: NodeIndex; reset: NodeIndex; ctrl: NodeIndex; thr: NodeIndex; dis: NodeIndex; vcc: NodeIndex; lower: NodeIndex; spec: TimerSpec }
  /** a is the common, b the first way; g holds the conductance to each way, set by the state of the contact. */
  | { kind: 'switch'; element: number; a: NodeIndex; b: NodeIndex; ways: NodeIndex[]; g: number[] }
  /** a is the output, b is ground; the output is held for a whole step, so the matrix never changes with it. */
  | { kind: 'logic'; element: number; a: NodeIndex; b: NodeIndex; outputs: NodeIndex[]; inputs: NodeIndex[]; gate: GateKind; vdd: number; state: boolean; table: number[] | null; frequency: number; modulus: number; /** For a part made of parts: its gates. */ network: LogicNetwork | null }
  /** a and b are the primary, c and d the secondary, each winding with its branch current; the primed nodes come after their series resistances. */
  | { kind: 'transformer'; element: number; a: NodeIndex; b: NodeIndex; c: NodeIndex; d: NodeIndex; ap: NodeIndex; cp: NodeIndex; l1: number; l2: number; m: number; branch: number; branch2: number };

export interface CompiledCircuit {
  /** Node voltages followed by branch currents. */
  size: number;
  devices: CompiledDevice[];
  /** Node index of each net; ground nets map to -1. */
  netIndex: Map<string, NodeIndex>;
  /** Element ids, in device order. */
  elementIds: string[];
  /** Same value means state can carry over: only component values changed. */
  signature: string;
}

export type CompileResult = { ok: true; compiled: CompiledCircuit } | { ok: false; errors: string[] };

const cardParam = (card: string, name: string): number | null => {
  const match = new RegExp(`[\\s(]${name}\\s*=\\s*([^\\s)]+)`, 'i').exec(card);
  return match && parseSpiceValue(match[1]);
};

/** A model can say 0 where the equations divide: such a value counts as not given. */
const positive = (value: number | null, fallback: number) => (value !== null && value > 0 ? value : fallback);

/**
 * The internal breakdown voltage that gives IBV at BV, solved as ngspice does: the diode's own
 * current at that point is part of the total.
 */
function breakdownVoltage(bv: number, ibv: number, is: number, nvt: number): number {
  const vt = THERMAL_VOLTAGE;
  if (ibv < (is * bv) / vt) return bv;
  let x = bv - nvt * Math.log(1 + ibv / is);
  for (let i = 0; i < 25; i++) {
    x = bv - nvt * Math.log(ibv / is + 1 - x / vt);
    if (Math.abs(is * (Math.exp((bv - x) / nvt) - 1 + x / vt) - ibv) <= 1e-3 * ibv) break;
  }
  return x;
}

/**
 * Reads the DC parameters of a .model card. Junction capacitance and transit time are left out
 * on purpose: the animation needs speed, and ngspice covers the precise analysis.
 */
export function parseDiodeModel(card: string): DiodeParams {
  const param = (name: string, fallback: number) => cardParam(card, name) ?? fallback;
  const is = positive(cardParam(card, 'IS'), 1e-14);
  const n = positive(cardParam(card, 'N'), 1);
  const bv = cardParam(card, 'BV');
  const breakdownNvt = param('NBV', n) * THERMAL_VOLTAGE;
  return {
    is,
    nvt: n * THERMAL_VOLTAGE,
    rs: param('RS', 0),
    breakdown: bv !== null && bv > 0 ? { voltage: breakdownVoltage(bv, param('IBV', 1e-3), is, breakdownNvt), nvt: breakdownNvt } : null,
  };
}

/** Same selection as parseDiodeModel. RB is taken as constant, without RBM and IRB. */
export function parseBjtModel(card: string, polarity: 1 | -1): BjtParams {
  const param = (name: string, fallback: number) => cardParam(card, name) ?? fallback;
  const inverse = (...names: string[]) => {
    const value = names.map((name) => cardParam(card, name)).find((v) => v !== null);
    return value ? 1 / value : 0;
  };
  const vt = THERMAL_VOLTAGE;
  return {
    polarity,
    is: positive(cardParam(card, 'IS'), 1e-16),
    bf: positive(cardParam(card, 'BF'), 100),
    br: positive(cardParam(card, 'BR'), 1),
    vt,
    nfVt: positive(cardParam(card, 'NF'), 1) * vt,
    nrVt: positive(cardParam(card, 'NR'), 1) * vt,
    ise: param('ISE', 0),
    neVt: param('NE', 1.5) * vt,
    isc: param('ISC', 0),
    ncVt: param('NC', 2) * vt,
    ovaf: inverse('VAF', 'VA'),
    ovar: inverse('VAR', 'VB'),
    oikf: inverse('IKF', 'IK'),
    oikr: inverse('IKR'),
    nkf: positive(cardParam(card, 'NKF'), 0.5),
    rb: param('RB', 0),
    rc: param('RC', 0),
    re: param('RE', 0),
  };
}

/** Width and length SPICE assumes when a device line gives none. */
const DEFAULT_CHANNEL = 100e-6;
const SILICON_OXIDE_PERMITTIVITY = 3.9 * 8.854214871e-12;

/** Same selection as the other models. Junction and gate capacitances, THETA, RQ and temperature are left out. */
export function parseMosModel(card: string, polarity: 1 | -1): MosParams {
  const param = (name: string, fallback: number) => cardParam(card, name) ?? fallback;
  const vdmos = isVdmos(card);
  const n = positive(cardParam(card, 'N'), 1);
  const is = positive(cardParam(card, 'IS'), 1e-14);
  const bv = cardParam(card, 'BV');
  const nvt = n * THERMAL_VOLTAGE;
  const breakdownNvt = param('NBV', n) * THERMAL_VOLTAGE;

  let kp = cardParam(card, 'KP');
  if (kp === null && !vdmos && cardParam(card, 'TOX')) {
    kp = (param('UO', param('U0', 600)) * 1e-4 * SILICON_OXIDE_PERMITTIVITY) / param('TOX', 1e-7);
  }
  const effectiveLength = DEFAULT_CHANNEL - 2 * (vdmos ? 0 : param('LD', 0));
  return {
    polarity,
    beta: vdmos ? (kp ?? 1) : ((kp ?? 2e-5) * DEFAULT_CHANNEL) / effectiveLength,
    vth: polarity * param('VTO', param('VT0', 0)),
    lambda: param('LAMBDA', 0),
    rd: param('RD', 0),
    rs: param('RS', 0),
    subthreshold: vdmos ? param('KSUBTHRES', 0.1) : 0,
    mtriode: vdmos ? positive(cardParam(card, 'MTRIODE'), 1) : 1,
    signedLambda: vdmos,
    rb: vdmos ? param('RB', 0) : 0,
    body: {
      is,
      nvt,
      rs: 0,
      breakdown: vdmos && bv !== null && bv > 0 ? { voltage: breakdownVoltage(bv, param('IBV', 1e-10), is, breakdownNvt), nvt: breakdownNvt } : null,
    },
  };
}

/** Builds the solver's view of the circuit. Unconnected terminals are fine: a drawing in progress must not stop it. */
export function compileCircuit(circuit: Circuit): CompileResult {
  const errors: string[] = [];
  const { netOf } = computeConnectivity(circuit);

  const groundNets = new Set<string>();
  for (const el of circuit.elements) {
    const s = getDevice(el.def)?.spice;
    if (s?.kind === 'ground') groundNets.add(netOf.get(terminalKey(el.id, s.terminal))!);
  }
  if (groundNets.size === 0) return { ok: false, errors: ['Il circuito non ha una massa'] };

  const netIndex = new Map<string, NodeIndex>();
  groundNets.forEach((net) => netIndex.set(net, -1));
  let nodeCount = 0;
  const nodeOfNet = (net: string) => {
    if (!netIndex.has(net)) netIndex.set(net, nodeCount++);
    return netIndex.get(net)!;
  };

  type Pending = { element: number; build: (branch: number, nextNode: () => number) => CompiledDevice; needsBranch: boolean };
  const pending: Pending[] = [];
  const elementIds: string[] = [];

  const modelCard = (tag: string, name: string, type: ModelType) => {
    const model = findModel(circuit, name);
    if (!model) errors.push(`${tag}: modello non definito "${name}"`);
    else if (modelType(model.card) !== type) errors.push(`${tag}: il modello "${name}" non è di tipo ${type}`);
    else return model.card;
    return null;
  };

  for (const el of circuit.elements) {
    const s = getDevice(el.def)?.spice;
    // A pin of an inner schematic stands for a wire: it is no part of its own
    if (!s || s.kind === 'ground' || s.kind === 'port') continue;
    const node = (terminal: string) => nodeOfNet(netOf.get(terminalKey(el.id, terminal))!);
    const element = elementIds.length;
    elementIds.push(el.id);

    switch (s.kind) {
      case 'passive': {
        const value = parseSpiceValue(String(el.props[s.valueProp] ?? ''));
        if (value === null || value <= 0) {
          errors.push(`${el.tag}: valore non valido "${el.props[s.valueProp] ?? ''}"`);
          break;
        }
        const [a, b] = [node(s.a), node(s.b)];
        if (s.prefix === 'R') pending.push({ element, needsBranch: false, build: () => ({ kind: 'resistor', element, a, b, g: 1 / value }) });
        else if (s.prefix === 'C') pending.push({ element, needsBranch: false, build: () => ({ kind: 'capacitor', element, a, b, c: value }) });
        else pending.push({ element, needsBranch: true, build: (branch) => ({ kind: 'inductor', element, a, b, l: value, branch }) });
        break;
      }
      case 'regulator': {
        const params = regulatorParams(el, s);
        if (!params) {
          errors.push(`${el.tag}: valori del regolatore non validi`);
          break;
        }
        const [a, b, base] = [node(s.input), node(s.output), node(s.ref)];
        pending.push({ element, needsBranch: false, build: () => ({ kind: 'regulator', element, a, b, base, params }) });
        break;
      }
      case 'motor': {
        const params = motorParamsOf(el, s.plate, s.loadProp);
        if (!params) {
          errors.push(`${el.tag}: carico non valido "${el.props[s.loadProp] ?? ''}"`);
          break;
        }
        const [a, b] = [node(s.plus), node(s.minus)];
        pending.push({ element, needsBranch: true, build: (branch, nextNode) => ({ kind: 'motor', element, a, b, e: nextNode(), branch, params }) });
        break;
      }
      case 'block':
        errors.push(`${el.tag}: un sottocircuito non si può animare. Usa l'Analisi precisa`);
        break;
      case 'ctransformer': {
        const params = ctTransformerParams(el.props[s.primaryProp], el.props[s.secondaryProp], el.props[s.powerProp]);
        if (!params) {
          errors.push(`${el.tag}: tensioni o potenza non valide`);
          break;
        }
        const [p1, p2, s1, ct, s2] = [node(s.p1), node(s.p2), node(s.s1), node(s.ct), node(s.s2)];
        const { inductances: l, resistances: r, coupling, coreResistance: core } = params;
        const m = [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => (i === j ? l[i] : coupling * Math.sqrt(l[i] * l[j]))));
        pending.push({
          element,
          needsBranch: false,
          build: (_, nextNode) => ({ kind: 'ctransformer', element, a: p1, b: p2, starts: [p1, s1, ct], ends: [p2, ct, s2], inner: [nextNode(), nextNode(), nextNode()], r, m, core, branches: [] }),
        });
        break;
      }
      case 'bridge': {
        const card = modelCard(el.tag, String(el.props[s.modelProp] ?? ''), 'D');
        if (!card) break;
        const params = parseDiodeModel(card);
        const [ac1, ac2, plus, minus] = [node(s.ac1), node(s.ac2), node(s.plus), node(s.minus)];
        const [anodes, cathodes] = [
          [ac1, ac2, minus, minus],
          [plus, plus, ac1, ac2],
        ];
        pending.push({
          element,
          needsBranch: false,
          build: (_, nextNode) => ({ kind: 'bridge', element, a: plus, b: minus, ac1, ac2, anodes, cathodes, junctions: anodes.map((anode) => (params.rs > 0 ? nextNode() : anode)), params }),
        });
        break;
      }
      case 'display7': {
        const [segments, b] = [s.segments.map(node), node(s.common)];
        const forward = segmentColor(el.props[s.colorProp]).forward;
        pending.push({ element, needsBranch: false, build: () => ({ kind: 'display7', element, a: segments[0], b, segments, forward }) });
        break;
      }
      case 'switch': {
        const [a, ways] = [node(s.common), s.ways.map(node)];
        const g = contactResistances(s.switchKind, el.props).map((r) => 1 / r);
        pending.push({ element, needsBranch: false, build: () => ({ kind: 'switch', element, a, b: ways[0], ways, g }) });
        break;
      }
      case 'pot': {
        const halves = potResistances(el, s.valueProp, s.positionProp);
        if (!halves) {
          errors.push(`${el.tag}: resistenza o posizione del cursore non valide`);
          break;
        }
        const [a, b, w] = [node(s.a), node(s.b), node(s.wiper)];
        pending.push({ element, needsBranch: false, build: () => ({ kind: 'pot', element, a, b, w, g1: 1 / halves[0], g2: 1 / halves[1] }) });
        break;
      }
      case 'mcu': {
        const text = sketchHex(el.props[s.sketchProp], el.props[s.hexProp]);
        const program = text ? parseIntelHex(text) : null;
        if (!text || !program) {
          errors.push(text ? `${el.tag}: il file .hex non è valido` : `${el.tag}: carica un file .hex nelle proprietà`);
          break;
        }
        const [pins, a, b] = [s.pins.map(node), node(s.vcc), node(s.gnd)];
        const key = `${programKey(text)}:${el.props.resets ?? 0}`;
        pending.push({ element, needsBranch: true, build: (branch) => ({ kind: 'mcu', element, a, b, pins, branch, program, programKey: key }) });
        break;
      }
      case 'timer': {
        const [a, b, trig, reset, ctrl, thr, dis, vcc] = [s.out, s.gnd, s.trig, s.reset, s.ctrl, s.thr, s.dis, s.vcc].map(node);
        pending.push({ element, needsBranch: false, build: (_, nextNode) => ({ kind: 'timer', element, a, b, trig, reset, ctrl, thr, dis, vcc, lower: nextNode(), spec: s.spec }) });
        break;
      }
      case 'opto': {
        const led = ledParams(PC817);
        const params: DiodeParams = { is: led.is, nvt: led.n * THERMAL_VOLTAGE, rs: led.rs, breakdown: null };
        const [a, b, c, e] = [node(s.anode), node(s.cathode), node(s.collector), node(s.emitter)];
        const ctr = ctrOf(el.props[s.ctrProp]);
        pending.push({ element, needsBranch: false, build: (_, nextNode) => ({ kind: 'opto', element, a, b, junction: nextNode(), c, e, params, ctr }) });
        break;
      }
      case 'ssr': {
        const spec = ssrSpecOf({ current: el.props[s.currentProp], type: el.props[s.typeProp], control: el.props[s.controlProp] });
        const [a, b, c, d] = [node(s.plus), node(s.minus), node(s.out1), node(s.out2)];
        pending.push({ element, needsBranch: false, build: (_, nextNode) => ({ kind: 'ssr', element, a, b, c, d, s: nextNode(), spec }) });
        break;
      }
      case 'lamp': {
        // To the solver a lamp is a resistance that follows the heat of its filament
        const rating = lampRating(el, s);
        if (!rating) {
          errors.push(`${el.tag}: potenza o tensione non valide`);
          break;
        }
        const [a, b] = [node(s.a), node(s.b)];
        const params = lampParams(rating);
        pending.push({ element, needsBranch: false, build: () => ({ kind: 'lamp', element, a, b, params }) });
        break;
      }
      case 'relay': {
        const [a, b, c, d] = [node(s.coil1), node(s.coil2), node(s.c1), node(s.c2)];
        const nc = s.nc ? node(s.nc) : null;
        pending.push({ element, needsBranch: true, build: (branch) => ({ kind: 'relay', element, a, b, c, d, nc, branch, spec: s.spec }) });
        break;
      }
      case 'logic': {
        const params = logicParams(el, s);
        if (!params) {
          errors.push(`${el.tag}: ${s.gate === 'table' ? 'tabella di verità o alimentazione non valida' : `alimentazione non valida "${el.props[s.vddProp] ?? ''}"`}`);
          break;
        }
        let network: LogicNetwork | null = null;
        if (s.gate === 'network') {
          try {
            network = logicNetwork(s.network ?? '');
          } catch (err) {
            errors.push(`${el.tag}: ${(err as Error).message}`);
            break;
          }
        }
        const [outputs, inputs] = [s.outputs.map(node), s.inputs.map(node)];
        const { vdd, state, table, frequency, modulus } = params;
        pending.push({ element, needsBranch: false, build: () => ({ kind: 'logic', element, a: outputs[0], b: -1, outputs, inputs, gate: s.gate, vdd, state, table, frequency, modulus, network }) });
        break;
      }
      case 'meter': {
        const resistance = meterResistance(el.props[s.modeProp]);
        if (resistance === null) {
          errors.push(`${el.tag}: misura non valida "${el.props[s.modeProp] ?? ''}"`);
          break;
        }
        const [a, b] = [node(s.a), node(s.b)];
        if (el.props[s.modeProp] === 'ohm') pending.push({ element, needsBranch: false, build: () => ({ kind: 'isource', element, a, b, current: METER_TEST_CURRENT }) });
        else pending.push({ element, needsBranch: false, build: () => ({ kind: 'resistor', element, a, b, g: 1 / resistance }) });
        break;
      }
      case 'isource': {
        const current = parseSpiceValue(String(el.props[s.valueProp] ?? ''));
        if (current === null) {
          errors.push(`${el.tag}: valore non valido "${el.props[s.valueProp] ?? ''}"`);
          break;
        }
        const [a, b] = [node(s.a), node(s.b)];
        pending.push({ element, needsBranch: false, build: () => ({ kind: 'isource', element, a, b, current }) });
        break;
      }
      case 'vsource': {
        const spec = sourceSpec(el.props);
        const wave = spec && parseWaveform(spec);
        if (!wave) {
          errors.push(`${el.tag}: sorgente non valida${spec ? ` "${spec}"` : ''}`);
          break;
        }
        const r = internalResistance(el.props);
        if (r === null) {
          errors.push(`${el.tag}: resistenza interna non valida "${el.props.rint ?? ''}"`);
          break;
        }
        const [a, b] = [node(s.pos), node(s.neg)];
        pending.push({ element, needsBranch: true, build: (branch) => ({ kind: 'vsource', element, a, b, wave, r, branch }) });
        break;
      }
      case 'diode': {
        const card = modelCard(el.tag, String(el.props[s.modelProp] ?? ''), 'D');
        if (!card) break;
        const params = parseDiodeModel(card);
        const [a, b] = [node(s.anode), node(s.cathode)];
        pending.push({
          element,
          needsBranch: false,
          build: (_, nextNode) => ({ kind: 'diode', element, a, b, params, junction: params.rs > 0 ? nextNode() : a }),
        });
        break;
      }
      case 'bjt': {
        const card = modelCard(el.tag, String(el.props[s.modelProp] ?? ''), s.modelType);
        if (!card) break;
        const params = parseBjtModel(card, s.modelType === 'NPN' ? 1 : -1);
        const [a, base, b] = [node(s.collector), node(s.base), node(s.emitter)];
        pending.push({
          element,
          needsBranch: false,
          build: (_, nextNode) => ({
            kind: 'bjt',
            element,
            a,
            b,
            base,
            params,
            cp: params.rc > 0 ? nextNode() : a,
            bp: params.rb > 0 ? nextNode() : base,
            ep: params.re > 0 ? nextNode() : b,
          }),
        });
        break;
      }
      case 'transformer': {
        const windings = transformerWindings(el.props[s.ratioProp], el.props[s.inductanceProp], el.props[s.couplingProp]);
        if (!windings) {
          errors.push(`${el.tag}: rapporto, induttanza o accoppiamento non validi`);
          break;
        }
        const [a, b, c, d] = [node(s.p1), node(s.p2), node(s.s1), node(s.s2)];
        const { primary: l1, secondary: l2, coupling } = windings;
        const m = coupling * Math.sqrt(l1 * l2);
        pending.push({ element, needsBranch: true, build: (branch, nextNode) => ({ kind: 'transformer', element, a, b, c, d, ap: nextNode(), cp: nextNode(), l1, l2, m, branch, branch2: -1 }) });
        break;
      }
      case 'opamp': {
        const [high, low] = [parseSpiceValue(String(el.props[s.highProp] ?? '')), parseSpiceValue(String(el.props[s.lowProp] ?? ''))];
        if (high === null || low === null || high <= low) {
          errors.push(`${el.tag}: alimentazioni non valide`);
          break;
        }
        const gbwText = String(el.props[s.gbwProp] ?? '').trim();
        const gbw = gbwText ? parseSpiceValue(gbwText) : 0;
        if (gbw === null || gbw < 0) {
          errors.push(`${el.tag}: GBW non valido "${gbwText}"`);
          break;
        }
        const tau = gbw > 0 ? OPAMP_GAIN / (2 * Math.PI * gbw) : 0;
        const [a, plus, minus] = [node(s.out), node(s.plus), node(s.minus)];
        pending.push({ element, needsBranch: true, build: (branch) => ({ kind: 'opamp', element, a, b: -1, plus, minus, high, low, tau, branch }) });
        break;
      }
      case 'mos': {
        const card = modelCard(el.tag, String(el.props[s.modelProp] ?? ''), s.modelType);
        if (!card) break;
        const params = parseMosModel(card, s.modelType === 'NMOS' ? 1 : -1);
        const [a, base, b] = [node(s.drain), node(s.gate), node(s.source)];
        pending.push({
          element,
          needsBranch: false,
          build: (_, nextNode) => {
            const dp = params.rd > 0 ? nextNode() : a;
            const sp = params.rs > 0 ? nextNode() : b;
            const bodyNode = params.rb > 0 ? nextNode() : isVdmos(card) ? a : dp;
            return { kind: 'mos', element, a, b, base, params, dp, sp, bodyNode };
          },
        });
        break;
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  // Terminals of unsupported nets still need an index, so nodes are final only after every element
  for (const net of netOf.values()) nodeOfNet(net);

  // Unknowns: external nodes, then internal diode nodes, then branch currents
  let next = nodeCount;
  const shells = pending.map((p) => p.build(-1, () => next++));
  const nodesTotal = next;
  let branch = nodesTotal;
  const devices = pending.map((p, i) => {
    const shell = shells[i];
    if (shell.kind === 'transformer') return { ...shell, branch: branch++, branch2: branch++ };
    if (shell.kind === 'ctransformer') return { ...shell, branches: [branch++, branch++, branch++] };
    return p.needsBranch ? { ...shell, branch: branch++ } : shell;
  }) as CompiledDevice[];

  const signature = JSON.stringify([
    branch,
    devices.map((d) => [d.kind, elementIds[d.element], d.a, d.b, d.kind === 'diode' ? d.junction : 0, d.kind === 'bjt' ? [d.base, d.cp, d.bp, d.ep] : d.kind === 'mos' ? [d.base, d.dp, d.sp, d.bodyNode] : d.kind === 'regulator' ? d.base : d.kind === 'motor' ? d.e : d.kind === 'pot' ? d.w : d.kind === 'relay' ? [d.c, d.d, d.nc ?? -2] : d.kind === 'opto' ? [d.junction, d.c, d.e] : d.kind === 'ssr' ? [d.c, d.d, d.s] : d.kind === 'timer' ? [d.trig, d.reset, d.ctrl, d.thr, d.dis, d.vcc, d.lower] : d.kind === 'mcu' ? [...d.pins, d.programKey] : d.kind === 'opamp' ? [d.plus, d.minus] : d.kind === 'transformer' ? [d.c, d.d, d.ap, d.cp] : d.kind === 'logic' ? [d.gate, ...d.outputs, ...d.inputs] : d.kind === 'switch' ? d.ways : d.kind === 'display7' ? d.segments : d.kind === 'bridge' ? [d.ac1, d.ac2, ...d.junctions] : d.kind === 'ctransformer' ? [...d.starts, ...d.ends, ...d.inner] : 0]),
  ]);
  return { ok: true, compiled: { size: branch, devices, netIndex, elementIds, signature } };
}
