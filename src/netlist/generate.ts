import { Circuit, ModelType, SpiceModel } from '../model/types';
import { getDevice } from '../library/devices';
import { logicNetwork } from '../library/composites';
import { findModel, fitsModelType, isSubcircuitCard, isVdmos } from '../library/models';
import { normalizeSubcircuitCard, OpAmpRole, readOpAmpRoles, readRegulatorRoles, RegulatorRole, subcircuitPins } from '../library/subcircuit';
import { computeConnectivity, terminalKey } from './connectivity';
import { internalResistance, sourceAcSpec, sourceDcSpec, sourceSpec } from './source';
import { parseSpiceValue } from './values';
import { METER_TEST_CURRENT, meterResistance } from '../realtime/meter';
import { LogicNetwork, gateExpression, levelExpression, LOGIC_INPUT_RESISTANCE, LOGIC_OUTPUT_RESISTANCE, logicParams, nextStateTable, outputTable, sequentialSpec, tableExpression } from '../realtime/logic';
import { CONTACT_CLOSED, CONTACT_OPEN, contactResistances } from '../realtime/switches';
import { potResistances } from '../realtime/pot';
import { filamentExpression, lampParams, lampRating, radiatedExpression } from '../realtime/lamp';
import { relayThresholds } from '../realtime/relay';
import { supplyResistance, TIMER_INPUT_RESISTANCE, TIMER_OFF_RESISTANCE, TIMER_RESET_PULLUP } from '../realtime/timer555';
import { SEGMENT_LEAK, segmentColor, segmentExpression } from '../realtime/display7';
import { ctTransformerParams } from '../realtime/ctTransformer';
import { MOTOR_LEAK, motorParamsOf } from '../realtime/motor';
import { REGULATOR_GAIN, REGULATOR_LEAK, REGULATOR_STIFFNESS, regulatorParams } from '../realtime/regulator';

export interface TranAnalysis {
  type: 'tran';
  step: string;
  stop: string;
  maxStep?: string;
}

export interface AcAnalysis {
  type: 'ac';
  from: string;
  to: string;
  pointsPerDecade: number;
}

/** Sweeps a generator, and optionally another one around it for a family of curves. Generators by element id. */
export interface DcAnalysis {
  type: 'dc';
  source: string;
  from: string;
  to: string;
  step: string;
  familySource?: string;
  familyFrom?: string;
  familyTo?: string;
  familyStep?: string;
}

export type Analysis = TranAnalysis | AcAnalysis | DcAnalysis;

/** Enough for any curve; beyond it a mistyped step would only freeze the page. */
const MAX_DC_POINTS = 5000;
const MAX_DC_CURVES = 12;

/** How many values go from one end to the other, or null if that does not make sense. */
export function sweepCount(from: string, to: string, step: string): number | null {
  const [a, b, s] = [parseSpiceValue(from), parseSpiceValue(to), parseSpiceValue(step)];
  if (a === null || b === null || s === null || s <= 0 || b < a) return null;
  return Math.floor((b - a) / s + 1e-9) + 1;
}

export interface NetlistResult {
  /** Empty when errors is not empty. */
  text: string;
  errors: string[];
  /** SPICE node name for each "elementId:terminalId". */
  nodeOf: Map<string, string>;
}

const SPICE_VALUE = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?(t|g|meg|k|m|u|n|p|f)?[a-z]*$/i;
const SPICE_NAME = /^[A-Za-z0-9_]+$/;

/** A card must stay on one line: anything else could inject extra SPICE commands. */
const isSingleLine = (s: string) => !/[\r\n]/.test(s);

export function cardName(prefix: string, tag: string): string {
  return tag.toUpperCase().startsWith(prefix) ? tag : `${prefix}${tag}`;
}

/** Human-readable label for each node, e.g. "n2" -> "D1.cathode, R1.a". Ground is left out. */
export function describeNodes(circuit: Circuit, nodeOf: Map<string, string>): Map<string, string> {
  const terminals = new Map<string, string[]>();
  for (const el of circuit.elements) {
    if (!el.tag) continue;
    // A block calls its pins as its model does
    const pinNames = String(el.props.pinNames ?? '').split(' ');
    (getDevice(el.def)?.terminals ?? []).forEach((t, k) => {
      const node = nodeOf.get(terminalKey(el.id, t.id));
      if (!node || node === '0') return;
      const pin = getDevice(el.def)?.spice.kind === 'block' ? pinNames[k] || t.id : t.id;
      terminals.set(node, [...(terminals.get(node) ?? []), `${el.tag}.${pin}`]);
    });
  }
  return new Map([...terminals].map(([node, names]) => [node, names.join(', ')]));
}

const TRANSFORMER_LEAK = '1g';
export const TRANSFORMER_WINDING_RESISTANCE = 1e-3;

/** The two inductances from what is asked of the part, or null if it makes no sense. A coupling of 1 has no solution. */
export function transformerWindings(ratio: unknown, inductance: unknown, coupling: unknown) {
  const [n, primary, k] = [ratio, inductance, coupling].map((v) => parseSpiceValue(String(v ?? '')));
  if (n === null || primary === null || k === null || n <= 0 || primary <= 0 || k <= 0 || k >= 1) return null;
  return { primary, secondary: primary / (n * n), coupling: k };
}

/** Open loop gain of the ideal op amp, shared with the real-time engine. */
export const OPAMP_GAIN = 1e6;
/** A current source with an open end has no voltage to settle on: this gives it one, in both engines. */
export const CURRENT_SOURCE_LEAK = 1e9;
/** How fast the pole of an op amp with a limited bandwidth comes to rest on a rail, in seconds: short enough not to show. */
const OPAMP_RAIL_TIME = 100e-9;

/**
 * kicked names the op amps with nowhere stable to rest at the start, as in an oscillator: an exact
 * solver would stay there forever, so they get a push during the first step, as noise would give.
 */
export function generateNetlist(circuit: Circuit, analysis: Analysis, kicked: Set<string> = new Set()): NetlistResult {
  const errors: string[] = [];
  const { netOf, unconnected } = computeConnectivity(circuit);

  const groundNets = new Set<string>();
  const groundTerminals = new Set<string>();
  for (const el of circuit.elements) {
    const def = getDevice(el.def);
    if (!def) {
      errors.push(`${el.tag}: componente sconosciuto "${el.def}"`);
    } else if (def.spice.kind === 'ground') {
      const key = terminalKey(el.id, def.spice.terminal);
      groundTerminals.add(key);
      groundNets.add(netOf.get(key)!);
    }
  }
  if (groundNets.size === 0) errors.push('Il circuito non ha una massa');

  // The free pins of a board do not matter: it cannot run here at all, and says so below
  const boards = new Set(circuit.elements.filter((el) => getDevice(el.def)?.spice.kind === 'mcu').map((el) => el.id));
  for (const key of unconnected) {
    if (groundTerminals.has(key) || boards.has(key.split(':')[0])) continue;
    const [elementId, terminal] = key.split(':');
    const tag = circuit.elements.find((el) => el.id === elementId)?.tag;
    errors.push(`Terminale non collegato: ${tag}.${terminal}`);
  }

  const netNames = new Map<string, string>();
  let nextNode = 1;
  const nodeName = (net: string) => {
    if (groundNets.has(net)) return '0';
    if (!netNames.has(net)) netNames.set(net, `n${nextNode++}`);
    return netNames.get(net)!;
  };

  const lines: string[] = [];
  let needsLatchModel = false;
  /** One switch model for each kind of relay in the circuit. */
  const relayModels = new Map<string, string>();
  /** The switches of the output stages, once for each kind of 555. */
  const timerModels = new Map<string, string[]>();
  const usedNames = new Set<string>();
  const usedModels = new Map<string, SpiceModel>();
  let hasAcSource = false;

  const uniqueName = (prefix: string, tag: string) => {
    if (!SPICE_NAME.test(tag)) {
      errors.push(`Nome non valido: "${tag}"`);
      return null;
    }
    const name = cardName(prefix, tag);
    if (usedNames.has(name.toUpperCase())) {
      errors.push(`Nome duplicato: ${name}`);
      return null;
    }
    usedNames.add(name.toUpperCase());
    return name;
  };

  const useModel = (tag: string, name: string, type: ModelType) => {
    const model = findModel(circuit, name);
    if (!model || !isSingleLine(name)) {
      errors.push(`${tag}: modello non definito "${name}"`);
      return null;
    }
    if (!fitsModelType(model.card, type)) {
      errors.push(`${tag}: il modello "${name}" non è di tipo ${type}`);
      return null;
    }
    usedModels.set(name, model);
    return name;
  };

  for (const el of circuit.elements) {
    const s = getDevice(el.def)?.spice;
    if (!s || s.kind === 'ground' || s.kind === 'port') continue;
    const node = (terminal: string) => nodeName(netOf.get(terminalKey(el.id, terminal))!);

    switch (s.kind) {
      case 'passive': {
        const value = String(el.props[s.valueProp] ?? '').trim();
        if (!SPICE_VALUE.test(value)) {
          errors.push(`${el.tag}: valore non valido "${value}"`);
          break;
        }
        const name = uniqueName(s.prefix, el.tag);
        if (name) lines.push(`${name} ${node(s.a)} ${node(s.b)} ${value}`);
        break;
      }
      case 'regulator': {
        const params = regulatorParams(el, s);
        if (!params) {
          errors.push(`${el.tag}: valori del regolatore non validi`);
          break;
        }
        const name = uniqueName('X', el.tag);
        if (!name) break;
        const [input, reference, output] = [node(s.input), node(s.ref), node(s.output)];
        // A generator of no voltage on the output, for the current to be read
        const inner = `xo${name}`;
        lines.push(`VS${name} ${inner} ${output} 0`);
        const modelName = String(el.props.model ?? '').trim();
        if (modelName) {
          const model = useModel(el.tag, modelName, 'REGULATOR');
          if (model === null) break;
          const roles = readRegulatorRoles(el.props.pins, subcircuitPins(usedModels.get(model)!.card));
          if (!roles) {
            errors.push(`${el.tag}: i piedini del modello "${model}" non sono assegnati uno per funzione`);
            break;
          }
          const nodes: Record<RegulatorRole, string> = { in: input, ref: reference, out: inner };
          lines.push(`${name} ${roles.map((role) => nodes[role]).join(' ')} ${model}`);
          break;
        }
        const { polarity: p, vNominal, dropout, iMax, iq } = params;
        // The same law as the real-time engine, written on the current: a law on the output voltage
        // would be computed far too high at the limit, and Newton would go back and forth without an end
        const given = `(${p}*i(VS${name}))`;
        const drop = `${REGULATOR_STIFFNESS}*max(0,${given}-${iMax})-${REGULATOR_STIFFNESS}*max(0,-${given})`;
        const source = `xs${name}`;
        // A sensor gives its voltage only with its supply in range, as the real-time engine says
        const sensor = params.sensor;
        const supply = `(v(${input})-v(${reference}))`;
        const gate = sensor ? `u(${supply}-${sensor.vMin})*u(${sensor.vAbsMax}-${supply})*` : '';
        lines.push(`BO${name} ${source} ${reference} V=${p}*(${gate}min(${vNominal},${p}*(v(${input})-v(${reference}))-${dropout})-(${drop}))`);
        lines.push(`RS${name} ${source} ${inner} ${1 / REGULATOR_GAIN}`);
        lines.push(`BI${name} ${input} ${reference} I=i(VS${name})+${p * iq}`);
        lines.push(`RI${name} ${input} ${reference} ${REGULATOR_LEAK}`, `RO${name} ${inner} ${reference} ${REGULATOR_LEAK}`);
        break;
      }
      case 'motor': {
        const params = motorParamsOf(el, s.plate, s.loadProp);
        if (!params) {
          errors.push(`${el.tag}: carico non valido "${el.props[s.loadProp] ?? ''}"`);
          break;
        }
        const name = uniqueName('X', el.tag);
        if (!name) break;
        // The same equivalent circuit as the real-time engine: winding, inertia, friction and load
        const [plus, minus, inner, emf] = [node(s.plus), node(s.minus), `xr${name}`, `xe${name}`];
        lines.push(`RW${name} ${plus} ${inner} ${params.r}`);
        lines.push(`LW${name} ${inner} ${emf} ${params.l}`);
        lines.push(`CJ${name} ${emf} ${minus} ${params.c}`);
        lines.push(`RJ${name} ${emf} ${minus} ${MOTOR_LEAK}`);
        lines.push(`BF${name} ${emf} ${minus} I=${params.iBrake}*tanh((v(${emf})-v(${minus}))/${params.eSmooth})`);
        break;
      }
      case 'block': {
        const modelName = String(el.props[s.modelProp] ?? '').trim();
        if (!modelName) {
          errors.push(`${el.tag}: scegli o importa un modello`);
          break;
        }
        const model = useModel(el.tag, modelName, 'SUBCKT');
        if (model === null) break;
        if (subcircuitPins(usedModels.get(model)!.card).length !== s.pins.length) {
          errors.push(`${el.tag}: il modello "${model}" ha un altro numero di piedini`);
          break;
        }
        const name = uniqueName('X', el.tag);
        if (name) lines.push(`${name} ${s.pins.map(node).join(' ')} ${model}`);
        break;
      }
      case 'ctransformer': {
        const params = ctTransformerParams(el.props[s.primaryProp], el.props[s.secondaryProp], el.props[s.powerProp]);
        if (!params) {
          errors.push(`${el.tag}: tensioni o potenza non valide`);
          break;
        }
        const name = uniqueName('T', el.tag);
        if (!name) break;
        const starts = [node(s.p1), node(s.s1), node(s.ct)];
        const ends = [node(s.p2), node(s.ct), node(s.s2)];
        const windings = ['P', 'A', 'B'].map((w) => `L${w}${name}`);
        starts.forEach((start, w) => {
          lines.push(`RW${w}${name} ${start} xw${w}${name} ${params.resistances[w]}`, `${windings[w]} xw${w}${name} ${ends[w]} ${params.inductances[w]}`);
          lines.push(`RG${w}${name} ${start} 0 ${TRANSFORMER_LEAK}`);
        });
        lines.push(`RC1${name} ${starts[1]} ${ends[1]} ${params.coreResistance}`, `RC2${name} ${starts[2]} ${ends[2]} ${params.coreResistance}`);
        lines.push(`K1${name} ${windings[0]} ${windings[1]} ${params.coupling}`, `K2${name} ${windings[0]} ${windings[2]} ${params.coupling}`, `K3${name} ${windings[1]} ${windings[2]} ${params.coupling}`);
        break;
      }
      case 'bridge': {
        const model = useModel(el.tag, String(el.props[s.modelProp] ?? '').trim(), 'D');
        if (model === null) break;
        const name = uniqueName('D', el.tag);
        if (!name) break;
        const [ac1, ac2, plus, minus] = [node(s.ac1), node(s.ac2), node(s.plus), node(s.minus)];
        lines.push(`${name}_1 ${ac1} ${plus} ${model}`, `${name}_2 ${ac2} ${plus} ${model}`, `${name}_3 ${minus} ${ac1} ${model}`, `${name}_4 ${minus} ${ac2} ${model}`);
        break;
      }
      case 'display7': {
        const name = uniqueName('X', el.tag);
        if (!name) break;
        const { forward } = segmentColor(el.props[s.colorProp]);
        const common = node(s.common);
        s.segments.forEach((segment, k) => {
          const pin = node(segment);
          lines.push(`BS${k}${name} ${pin} ${common} I=${segmentExpression(`v(${pin})`, `v(${common})`, forward)}`);
          lines.push(`RS${k}${name} ${pin} ${common} ${SEGMENT_LEAK}`);
        });
        break;
      }
      case 'switch': {
        const name = uniqueName('R', el.tag);
        if (!name) break;
        // As it stands now: a push button counts at rest, as nobody presses it during the analysis
        const resistances = contactResistances(s.switchKind, { ...el.props, pressed: '0' });
        s.ways.forEach((way, k) => lines.push(`${name}${s.ways.length > 1 ? `_${k + 1}` : ''} ${node(s.common)} ${node(way)} ${resistances[k]}`));
        break;
      }
      case 'timer': {
        const name = uniqueName('X', el.tag);
        if (!name) break;
        const { spec } = s;
        const [gnd, trig, out, reset, ctrl, thr, dis, vcc, lower] = [...[s.gnd, s.trig, s.out, s.reset, s.ctrl, s.thr, s.dis, s.vcc].map(node), `xl${name}`];
        const v = (n: string) => (n === '0' ? '0' : `v(${n})`);
        const above = (difference: string) => `(0.5+0.5*tanh((${difference})/${TIMER_EDGE_WIDTH}))`;
        // The divider, the current at rest and the inputs, as in the real-time engine
        lines.push(`RA${name} ${vcc} ${ctrl} ${spec.divider}`, `RB${name} ${ctrl} ${lower} ${spec.divider}`, `RC${name} ${lower} ${gnd} ${spec.divider}`);
        lines.push(`RQ${name} ${vcc} ${gnd} ${supplyResistance(spec)}`, `RT${name} ${trig} ${gnd} ${TIMER_INPUT_RESISTANCE}`, `RH${name} ${thr} ${gnd} ${TIMER_INPUT_RESISTANCE}`, `RP${name} ${reset} ${vcc} ${TIMER_RESET_PULLUP}`);
        // The comparators and RESET as smooth levels; the flip-flop as the SR latch: a capacitor the switch joins
        // to the next state while any of them acts, TRIG before THR and RESET before both
        const [set, clear, cleared] = [above(`v(${lower})-${v(trig)}`), above(`${v(thr)}-v(${ctrl})`), above(`${spec.resetLevel}-(${v(reset)}-${v(gnd)})`)];
        lines.push(`BS${name} xs${name} 0 V=${set}`, `BT${name} xt${name} 0 V=${clear}`, `BR${name} xr${name} 0 V=${cleared}`);
        const [ls, lt, lr] = [`v(xs${name})`, `v(xt${name})`, `v(xr${name})`];
        // The switch closes only with an input clearly on, and opens once all are clearly off; what it
        // stores is a full 0 or 1. So the state snaps and stays, as a flip-flop, instead of following a
        // comparator on its way back
        const sharp = (level: string) => `(0.5+0.5*tanh((${level}-0.5)/0.01))`;
        lines.push(`BC${name} xc${name} 0 V=(1-(1-${ls})*(1-${lt})*(1-${lr}))-0.75`);
        lines.push(`BD${name} xd${name} 0 V=${sharp(ls)}*(1-${sharp(lr)})`, `SM${name} xd${name} xm${name} xc${name} 0 LOGIC_SW`);
        lines.push(`CM${name} xm${name} 0 ${LATCH_CAPACITANCE}`, `RM${name} xm${name} 0 ${LATCH_LEAK}`);
        lines.push(`BQ${name} xq${name} 0 V=0.5+0.5*tanh((v(xm${name})-0.5)/0.02)`, `BN${name} xn${name} 0 V=1-v(xq${name})`);
        // OUT to the supply less its drop when high, to GND when low; DIS to GND when low
        const model = `TIMER_${spec.name}`;
        lines.push(`BH${name} xh${name} 0 V=${v(vcc)}-${spec.highDrop}`);
        lines.push(`SH${name} xh${name} ${out} xq${name} 0 ${model}_H`, `SL${name} ${out} ${gnd} xn${name} 0 ${model}_L`, `SD${name} ${dis} ${gnd} xn${name} 0 ${model}_D`);
        timerModels.set(model, [
          `.model ${model}_H SW(VT=0.5 VH=0.1 RON=${spec.rHigh} ROFF=1e12)`,
          `.model ${model}_L SW(VT=0.5 VH=0.1 RON=${spec.rLow} ROFF=1e12)`,
          `.model ${model}_D SW(VT=0.5 VH=0.1 RON=${spec.rDischarge} ROFF=${TIMER_OFF_RESISTANCE})`,
        ]);
        needsLatchModel = true;
        break;
      }
      case 'mcu':
        errors.push(`${el.tag}: un Arduino si simula solo nell'animazione: l'Analisi precisa non esegue il programma`);
        break;
      case 'lamp': {
        const rating = lampRating(el, s);
        if (!rating) {
          errors.push(`${el.tag}: potenza o tensione non valide`);
          break;
        }
        const name = uniqueName('X', el.tag);
        if (!name) break;
        // The temperature of the filament on a node of its own, a capacitor of tau farad charged by the
        // power taken and emptied by the power radiated, both as shares of the rated power; the filament a
        // current that follows the resistance of that temperature
        const params = lampParams(rating);
        const [a, b, temp] = [node(s.a), node(s.b), `xt${name}`];
        const v = `(${a === '0' ? '0' : `v(${a})`}-${b === '0' ? '0' : `v(${b})`})`;
        const resistance = filamentExpression(params, `v(${temp})`);
        lines.push(`BF${name} ${a} ${b} I=${v}/${resistance}`);
        lines.push(`BT${name} 0 ${temp} I=${v}*${v}/${resistance}/${params.power}-${radiatedExpression(`v(${temp})`)}`, `CT${name} ${temp} 0 ${params.tau}`, `RT${name} ${temp} 0 1e9`);
        lines.push(`RL${name} ${a} ${b} 1e12`);
        break;
      }
      case 'pot': {
        const halves = potResistances(el, s.valueProp, s.positionProp);
        if (!halves) {
          errors.push(`${el.tag}: resistenza o posizione del cursore non valide`);
          break;
        }
        const name = uniqueName('R', el.tag);
        if (!name) break;
        const wiper = node(s.wiper);
        lines.push(`${name}_A ${node(s.a)} ${wiper} ${halves[0]}`, `${name}_B ${wiper} ${node(s.b)} ${halves[1]}`);
        break;
      }
      case 'relay': {
        const name = uniqueName('X', el.tag);
        if (!name) break;
        // The coil as R and L; the contact as a switch driven by the size of the coil current, with the
        // hysteresis between pick-up and drop-out, as in the real-time engine
        const { coilResistance, coilInductance } = s.spec;
        const { pickup, dropout } = relayThresholds(s.spec);
        const [coil1, coil2, inner, control] = [node(s.coil1), node(s.coil2), `xk${name}`, `xc${name}`];
        const model = `RELAY_${el.def.toUpperCase()}`;
        relayModels.set(model, `.model ${model} SW(VT=${(pickup + dropout) / 2} VH=${(pickup - dropout) / 2} RON=${CONTACT_CLOSED} ROFF=${CONTACT_OPEN})`);
        lines.push(`RK${name} ${coil1} ${inner} ${coilResistance}`, `LK${name} ${inner} ${coil2} ${coilInductance}`);
        lines.push(`BK${name} ${control} 0 V=abs(v(${coil1})-v(${inner}))/${coilResistance}`);
        lines.push(`SK${name} ${node(s.c1)} ${node(s.c2)} ${control} 0 ${model}`);
        break;
      }
      case 'logic': {
        const params = logicParams(el, s);
        if (!params) {
          errors.push(`${el.tag}: ${s.gate === 'table' ? 'tabella di verità o alimentazione non valida' : `alimentazione non valida "${el.props[s.vddProp] ?? ''}"`}`);
          break;
        }
        const name = uniqueName('X', el.tag);
        if (!name) break;
        // The same parts as in the real-time engine: inputs to ground, each output behind its resistance
        s.inputs.forEach((input, k) => lines.push(`RI${k}${name} ${node(input)} 0 ${LOGIC_INPUT_RESISTANCE}`));
        let levels = s.inputs.map((input) => levelExpression(`v(${node(input)})`, params.vdd));
        let network: LogicNetwork | null = null;
        if (s.gate === 'network') {
          try {
            network = logicNetwork(s.network ?? '');
          } catch (err) {
            errors.push(`${el.tag}: ${(err as Error).message}`);
            break;
          }
        }
        if (params.table || network) {
          // Each level once, as a node of its own: the rows of a table use them many times over
          levels = s.inputs.map((input, k) => {
            lines.push(`BV${k}${name} xv${k}${name} 0 V=${levelExpression(`v(${node(input)})`, params.vdd)}`);
            return `v(xv${k}${name})`;
          });
        }
        if (s.gate === 'clock') {
          // Low for the first half period, as in the real-time engine, with short edges
          const period = 1 / params.frequency;
          const edge = period * 1e-4;
          lines.push(`VC${name} xl0${name} 0 PULSE(0 ${params.vdd} ${period / 2} ${edge} ${edge} ${period / 2 - edge} ${period})`);
          lines.push(`RL0${name} xl0${name} ${node(s.outputs[0])} ${LOGIC_OUTPUT_RESISTANCE}`);
          break;
        }
        const spec = sequentialSpec(s.gate, params.modulus);
        if (spec) {
          lines.push(...latchLines(name, spec, levels, params.vdd));
          needsLatchModel = true;
        }
        // A part made of parts: each inner gate on a node of its own, its level between 0 and 1
        const netLevel = (net: number) => (network && net < network.inputs ? levels[net] : `v(xn${net}${name})`);
        network?.gates.forEach((gate) => lines.push(`BN${gate.output}${name} xn${gate.output}${name} 0 V=${gateExpression(gate.kind, gate.inputs.map(netLevel))}`));
        s.outputs.forEach((output, j) => {
          // Both inputs of a forbidden pair high send the outputs to 0, as in the real-time engine
          const forbidden = spec?.forbidden ? `(1-${levels[spec.forbidden[0]]}*${levels[spec.forbidden[1]]})*` : '';
          const expression = spec
            ? `${forbidden}${tableExpression(outputTable(spec), j, latchLevels(name, spec))}`
            : network
              ? netLevel(network.outputs[j])
              : params.table
              ? tableExpression(params.table, j, levels)
              : gateExpression(s.gate, levels, params.state);
          lines.push(`BL${j}${name} xl${j}${name} 0 V=${params.vdd}*${expression}`);
          lines.push(`RL${j}${name} xl${j}${name} ${node(output)} ${LOGIC_OUTPUT_RESISTANCE}`);
        });
        break;
      }
      case 'meter': {
        const resistance = meterResistance(el.props[s.modeProp]);
        if (resistance === null) {
          errors.push(`${el.tag}: misura non valida "${el.props[s.modeProp] ?? ''}"`);
          break;
        }
        const name = uniqueName('R', el.tag);
        if (name) lines.push(`${name} ${node(s.a)} ${node(s.b)} ${resistance}`);
        // Like the source of the real-time engine, whose leak is that resistance
        if (name && el.props[s.modeProp] === 'ohm') lines.push(`I${name} ${node(s.a)} ${node(s.b)} DC ${METER_TEST_CURRENT}`);
        break;
      }
      case 'isource': {
        const value = String(el.props[s.valueProp] ?? '').trim();
        if (!SPICE_VALUE.test(value)) {
          errors.push(`${el.tag}: valore non valido "${value}"`);
          break;
        }
        const name = uniqueName('I', el.tag);
        if (name) lines.push(`${name} ${node(s.a)} ${node(s.b)} DC ${value}`, `RL${name} ${node(s.a)} ${node(s.b)} ${CURRENT_SOURCE_LEAK}`);
        break;
      }
      case 'vsource': {
        const spec = analysis.type === 'ac' ? sourceAcSpec(el.props) : analysis.type === 'dc' ? sourceDcSpec(el.props) : sourceSpec(el.props);
        if (!spec) {
          errors.push(`${el.tag}: sorgente non valida`);
          break;
        }
        const r = internalResistance(el.props);
        if (r === null) {
          errors.push(`${el.tag}: resistenza interna non valida`);
          break;
        }
        const name = uniqueName('V', el.tag);
        if (name && r > 0) lines.push(`RI${name} ${node(s.pos)} xr${name} ${r}`, `${name} xr${name} ${node(s.neg)} ${spec}`);
        else if (name) lines.push(`${name} ${node(s.pos)} ${node(s.neg)} ${spec}`);
        if (spec.includes(' AC ')) hasAcSource = true;
        break;
      }
      case 'diode': {
        const model = useModel(el.tag, String(el.props[s.modelProp] ?? '').trim(), 'D');
        if (model === null) break;
        const name = uniqueName('D', el.tag);
        if (name) lines.push(`${name} ${node(s.anode)} ${node(s.cathode)} ${model}`);
        break;
      }
      case 'bjt': {
        const model = useModel(el.tag, String(el.props[s.modelProp] ?? '').trim(), s.modelType);
        if (model === null) break;
        const name = uniqueName('Q', el.tag);
        if (name) lines.push(`${name} ${node(s.collector)} ${node(s.base)} ${node(s.emitter)} ${model}`);
        break;
      }
      case 'transformer': {
        const windings = transformerWindings(el.props[s.ratioProp], el.props[s.inductanceProp], el.props[s.couplingProp]);
        if (!windings) {
          errors.push(`${el.tag}: rapporto, induttanza o accoppiamento non validi`);
          break;
        }
        const name = uniqueName('T', el.tag);
        if (name) {
          const [p1, p2, s1, s2] = [node(s.p1), node(s.p2), node(s.s1), node(s.s2)];
          // Series resistance, as any real winding has: at DC an ideal one would short the generator on it
          lines.push(`RWP${name} ${p1} xp${name} ${TRANSFORMER_WINDING_RESISTANCE}`, `RWS${name} ${s1} xs${name} ${TRANSFORMER_WINDING_RESISTANCE}`);
          lines.push(`LP${name} xp${name} ${p2} ${windings.primary}`, `LS${name} xs${name} ${s2} ${windings.secondary}`, `K${name} LP${name} LS${name} ${windings.coupling}`);
          // A winding isolated from ground, as in a bridge rectifier, leaves ngspice with no DC reference
          lines.push(`RP${name} ${p1} 0 ${TRANSFORMER_LEAK}`, `RS${name} ${s1} 0 ${TRANSFORMER_LEAK}`);
        }
        break;
      }
      case 'opamp': {
        const [high, low] = [parseSpiceValue(String(el.props[s.highProp] ?? '')), parseSpiceValue(String(el.props[s.lowProp] ?? ''))];
        if (high === null || low === null || high <= low) {
          errors.push(`${el.tag}: alimentazioni non valide`);
          break;
        }
        const modelName = String(el.props[s.modelProp] ?? '').trim();
        if (modelName) {
          const model = useModel(el.tag, modelName, 'OPAMP');
          if (model === null) break;
          const pins = subcircuitPins(usedModels.get(model)!.card);
          const roles = readOpAmpRoles(el.props[s.pinsProp], pins);
          if (!roles) {
            errors.push(`${el.tag}: i piedini del modello "${model}" non sono assegnati uno per funzione`);
            break;
          }
          const name = uniqueName('X', el.tag);
          if (name) {
            // The symbol has no supply pins: the two values become generators of its own
            const nodes: Record<OpAmpRole, string> = { plus: node(s.plus), minus: node(s.minus), out: node(s.out), high: `xh${name}`, low: `xl${name}` };
            lines.push(`VH${name} xh${name} 0 ${high}`, `VL${name} xl${name} 0 ${low}`);
            lines.push(`${name} ${roles.map((role) => nodes[role]).join(' ')} ${model}`);
          }
          break;
        }
        const gbwText = String(el.props[s.gbwProp] ?? '').trim();
        const gbw = gbwText ? parseSpiceValue(gbwText) : 0;
        if (gbw === null || gbw < 0) {
          errors.push(`${el.tag}: GBW non valido "${gbwText}"`);
          break;
        }
        const name = uniqueName('B', el.tag);
        const step = analysis.type === 'tran' ? (parseSpiceValue(analysis.step) ?? 0) : 0;
        const kick = kicked.has(el.id) ? `+${high - low}*u(time-1e-12)*u(${step}-time)` : '';
        if (name) {
          // A very fast pole on the output: without it, ngspice can fail on a diode inside the loop
          const inner = `x${name}`;
          const drive = `${OPAMP_GAIN}*(v(${node(s.plus)})-v(${node(s.minus)})${kick})`;
          if (gbw > 0) {
            // The pole is a capacitor charged towards the drive, stopped at the rails so that it does not
            // wind up: past them, a saturated output would take seconds to come back
            const pole = `s${name}`;
            const capacitance = OPAMP_GAIN / (2 * Math.PI * gbw);
            const stop = capacitance / OPAMP_RAIL_TIME;
            lines.push(`BI${name} 0 ${pole} I = max(min(${drive}-v(${pole}), ${stop}*(${high}-v(${pole}))), ${stop}*(${low}-v(${pole})))`);
            lines.push(`CP${name} ${pole} 0 ${capacitance}`);
            lines.push(`${name} ${inner} 0 V = v(${pole})`);
          } else {
            lines.push(`${name} ${inner} 0 V = max(${low}, min(${high}, ${drive}))`);
          }
          lines.push(`RO${name} ${inner} ${node(s.out)} 0.1`, `CO${name} ${node(s.out)} 0 100p`);
        }
        break;
      }
      case 'mos': {
        const model = useModel(el.tag, String(el.props[s.modelProp] ?? '').trim(), s.modelType);
        if (model === null) break;
        const name = uniqueName('M', el.tag);
        // A VDMOS has three terminals; a MOSFET has a fourth for the bulk, tied here to the source
        const bulk = isVdmos(usedModels.get(model)!.card) ? '' : ` ${node(s.source)}`;
        if (name) lines.push(`${name} ${node(s.drain)} ${node(s.gate)} ${node(s.source)}${bulk} ${model}`);
        break;
      }
    }
  }

  const modelCards = [...usedModels.values()];
  for (const m of modelCards) {
    if (isSubcircuitCard(m.card) ? !normalizeSubcircuitCard(m.card) : !isSingleLine(m.card)) errors.push(`Modello ${m.name}: la card non è valida`);
  }
  if (!isSingleLine(circuit.title)) errors.push('Il titolo deve stare su una riga');
  const checks =
    analysis.type === 'tran'
      ? [['Durata', analysis.stop], ['Passo', analysis.step], ['Passo massimo', analysis.maxStep ?? '1']]
      : analysis.type === 'ac'
        ? [['Da', analysis.from], ['A', analysis.to]]
        : [
            ['Da', analysis.from],
            ['A', analysis.to],
            ['Passo', analysis.step],
            ...(analysis.familySource
              ? [
                  ['Famiglia, da', analysis.familyFrom ?? ''],
                  ['Famiglia, a', analysis.familyTo ?? ''],
                  ['Famiglia, passo', analysis.familyStep ?? ''],
                ]
              : []),
          ];
  for (const [label, value] of checks) {
    if (!SPICE_VALUE.test(value.trim())) errors.push(`${label}: valore non valido "${value}"`);
  }
  if (analysis.type === 'ac') {
    const [from, to] = [parseSpiceValue(analysis.from), parseSpiceValue(analysis.to)];
    if (from !== null && to !== null && (from <= 0 || to <= from)) errors.push('La frequenza "A" deve essere maggiore di "Da", ed entrambe positive');
    if (!hasAcSource) errors.push("Per l'analisi AC serve un generatore di segnale: sinusoide, onda quadra o avanzato");
  }

  // The name a generator has in the netlist, for the sweep command to refer to it
  const sweptName = (id: string | undefined) => {
    const el = circuit.elements.find((e) => e.id === id && getDevice(e.def)?.spice.kind === 'vsource');
    return el ? cardName('V', el.tag) : null;
  };
  if (analysis.type === 'dc' && errors.length === 0) {
    const name = sweptName(analysis.source);
    const count = sweepCount(analysis.from, analysis.to, analysis.step);
    if (!name) errors.push('Scegli il generatore da far variare');
    if (count === null) errors.push('Il DC sweep vuole "A" non minore di "Da" e un passo positivo');
    const familyCount = analysis.familySource ? sweepCount(analysis.familyFrom ?? '', analysis.familyTo ?? '', analysis.familyStep ?? '') : 1;
    if (analysis.familySource) {
      if (!sweptName(analysis.familySource) || analysis.familySource === analysis.source) errors.push('La famiglia vuole un secondo generatore, diverso dal primo');
      if (familyCount === null) errors.push('La famiglia vuole "A" non minore di "Da" e un passo positivo');
      else if (familyCount > MAX_DC_CURVES) errors.push(`La famiglia ha ${familyCount} curve: il massimo è ${MAX_DC_CURVES}`);
    }
    if (count !== null && familyCount !== null && count * familyCount > MAX_DC_POINTS) errors.push(`Il DC sweep ha ${count * familyCount} punti: il massimo è ${MAX_DC_POINTS}, aumenta il passo`);
  }

  const nodeOf = new Map<string, string>();
  for (const [key, net] of netOf) nodeOf.set(key, nodeName(net));

  if (errors.length > 0) return { text: '', errors, nodeOf };

  // An astable has no rest in DC, which ngspice would look for: a circuit with a 555 starts as at power-on,
  // every capacitor empty
  const hasTimer = timerModels.size > 0;
  const familyPart = analysis.type === 'dc' && analysis.familySource ? ` ${sweptName(analysis.familySource)} ${analysis.familyFrom} ${analysis.familyTo} ${analysis.familyStep}` : '';
  const command =
    analysis.type === 'ac'
      ? `.ac dec ${analysis.pointsPerDecade} ${analysis.from} ${analysis.to}`
      : analysis.type === 'dc'
        ? `.dc ${sweptName(analysis.source)} ${analysis.from} ${analysis.to} ${analysis.step}${familyPart}`
        : `.tran ${analysis.step} ${analysis.stop}${analysis.maxStep ? ` 0 ${analysis.maxStep}` : ''}${hasTimer ? ' uic' : ''}`;
  if (needsLatchModel) lines.push(LATCH_SWITCH_MODEL, LATCH_FORCE_MODEL);
  lines.push(...relayModels.values(), ...[...timerModels.values()].flat());
  // The memory of a 555 is much faster than the step: the trapezoidal rule rings on it, Gear damps it
  const options = hasTimer && analysis.type === 'tran' ? ['.options method=gear'] : [];
  const text = [circuit.title, ...lines, ...modelCards.map((m) => m.card), ...options, command, '.end', ''].join('\n');
  return { text, errors, nodeOf };
}

/** The switches of the latches: a little hysteresis around the middle, so master and slave are never closed together. */
const LATCH_SWITCH_MODEL = '.model LOGIC_SW SW(VT=0 VH=0.1 RON=100 ROFF=1e12)';
const LATCH_FORCE_MODEL = '.model LOGIC_FORCE SW(VT=0 VH=0.1 RON=1 ROFF=1e12)';
const LATCH_CAPACITANCE = '1n';
/** How sharp the comparators of a 555 are for ngspice, in volts: a step, but smooth for Newton. */
const TIMER_EDGE_WIDTH = 0.005;
const LATCH_LEAK = 1e12;

/**
 * A latch with no clock, as the SR: one capacitor per state bit, which the switch joins to the next
 * state whenever that differs from holding, that is with exactly one of S and R high.
 */
function levelLatchLines(name: string, spec: NonNullable<ReturnType<typeof sequentialSpec>>, levels: string[], vdd: number): string[] {
  const [s, r] = spec.data.map((k) => levels[k]);
  const [gate, d, q] = [`xc${name}`, `xd0${name}`, `xs0${name}`];
  return [
    `BC${name} ${gate} 0 V=(${s}+${r}-2*${s}*${r})-0.5`,
    `BD0${name} ${d} 0 V=${vdd}*${s}`,
    `SM0${name} ${d} ${q} ${gate} 0 LOGIC_SW`,
    `CS0${name} ${q} 0 ${LATCH_CAPACITANCE}`,
    `RS0${name} ${q} 0 ${LATCH_LEAK}`,
    `BQ0${name} xq0${name} 0 V=${levelExpression(`v(${q})`, vdd)}`,
  ];
}

/** The level of each state bit for ngspice, most significant first: the voltage held by its slave. */
const latchLevels = (name: string, spec: { stateBits: number }) =>
  Array.from({ length: spec.stateBits }, (_, k) => `v(xq${spec.stateBits - 1 - k}${name})`);

/**
 * The memory of a sequential part for ngspice: for each state bit a master capacitor, which follows the
 * next state while the clock is low, and a slave capacitor, which takes the master while the clock is
 * high. The state therefore moves at the rising edge, as in the real-time engine. Reset and set pull both
 * capacitors at once, reset first.
 */
function latchLines(name: string, spec: NonNullable<ReturnType<typeof sequentialSpec>>, levels: string[], vdd: number): string[] {
  if (spec.clock === null) return levelLatchLines(name, spec, levels, vdd);
  const lines: string[] = [];
  const n = spec.stateBits;
  const clock = `xc${name}`;
  lines.push(`BC${name} ${clock} 0 V=${levels[spec.clock]}-0.5`);
  // Each slave voltage once as a level from 0 to 1, as the next state and the outputs read it
  const slaveLevels = Array.from({ length: n }, (_, k) => {
    const bit = n - 1 - k;
    lines.push(`BQ${bit}${name} xq${bit}${name} 0 V=${levelExpression(`v(xs${bit}${name})`, vdd)}`);
    return `v(xq${bit}${name})`;
  });
  const rowLevels = [...slaveLevels, ...spec.data.map((k) => levels[k])];
  const table = nextStateTable(spec);
  const reset = spec.reset !== null ? levels[spec.reset] : null;
  if (reset) lines.push(`BR${name} xr${name} 0 V=${reset}-0.5`);
  if (spec.set !== null) {
    lines.push(`BT${name} xt${name} 0 V=${levels[spec.set]}*(1-${reset ?? '0'})-0.5`);
    lines.push(`VT${name} xh${name} 0 ${vdd}`);
  }
  for (let bit = 0; bit < n; bit++) {
    const [d, m, b, q] = [`xd${bit}${name}`, `xm${bit}${name}`, `xb${bit}${name}`, `xs${bit}${name}`];
    lines.push(`BD${bit}${name} ${d} 0 V=${vdd}*${tableExpression(table, bit, rowLevels)}`);
    lines.push(`SM${bit}${name} ${d} ${m} 0 ${clock} LOGIC_SW`);
    lines.push(`CM${bit}${name} ${m} 0 ${LATCH_CAPACITANCE}`);
    lines.push(`RM${bit}${name} ${m} 0 ${LATCH_LEAK}`);
    lines.push(`BB${bit}${name} ${b} 0 V=v(${m})`);
    lines.push(`SS${bit}${name} ${b} ${q} ${clock} 0 LOGIC_SW`);
    lines.push(`CS${bit}${name} ${q} 0 ${LATCH_CAPACITANCE}`);
    lines.push(`RS${bit}${name} ${q} 0 ${LATCH_LEAK}`);
    for (const [node, tag] of [[m, 'M'], [q, 'S']]) {
      if (reset) lines.push(`SR${tag}${bit}${name} ${node} 0 xr${name} 0 LOGIC_FORCE`);
      if (spec.set !== null) lines.push(`ST${tag}${bit}${name} ${node} xh${name} xt${name} 0 LOGIC_FORCE`);
    }
  }
  return lines;
}
