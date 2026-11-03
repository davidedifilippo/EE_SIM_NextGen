import { Circuit, ModelType, SpiceModel } from '../model/types';
import { getDevice } from '../library/devices';
import { findModel, fitsModelType, isSubcircuitCard, isVdmos } from '../library/models';
import { normalizeSubcircuitCard, OpAmpRole, readOpAmpRoles, readRegulatorRoles, RegulatorRole, subcircuitPins } from '../library/subcircuit';
import { computeConnectivity, terminalKey } from './connectivity';
import { internalResistance, sourceAcSpec, sourceDcSpec, sourceSpec } from './source';
import { parseSpiceValue } from './values';
import { METER_TEST_CURRENT, meterResistance } from '../realtime/meter';
import { gateExpression, levelExpression, LOGIC_INPUT_RESISTANCE, LOGIC_OUTPUT_RESISTANCE, logicParams } from '../realtime/logic';
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

  for (const key of unconnected) {
    if (groundTerminals.has(key)) continue;
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
    if (!s || s.kind === 'ground') continue;
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
        lines.push(`BO${name} ${source} ${reference} V=${p}*(min(${vNominal},${p}*(v(${input})-v(${reference}))-${dropout})-(${drop}))`);
        lines.push(`RS${name} ${source} ${inner} ${1 / REGULATOR_GAIN}`);
        lines.push(`BI${name} ${input} ${reference} I=i(VS${name})+${p * iq}`);
        lines.push(`RI${name} ${input} ${reference} ${REGULATOR_LEAK}`, `RO${name} ${inner} ${reference} ${REGULATOR_LEAK}`);
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
      case 'logic': {
        const params = logicParams(el, s);
        if (!params) {
          errors.push(`${el.tag}: alimentazione non valida "${el.props[s.vddProp] ?? ''}"`);
          break;
        }
        const name = uniqueName('X', el.tag);
        if (!name) break;
        // The same parts as in the real-time engine: inputs to ground, the output behind its resistance
        s.inputs.forEach((input, k) => lines.push(`RI${k}${name} ${node(input)} 0 ${LOGIC_INPUT_RESISTANCE}`));
        const levels = s.inputs.map((input) => levelExpression(`v(${node(input)})`, params.vdd));
        const inner = `xl${name}`;
        lines.push(`BL${name} ${inner} 0 V=${params.vdd}*${gateExpression(s.gate, levels, params.state)}`);
        lines.push(`RL${name} ${inner} ${node(s.output)} ${LOGIC_OUTPUT_RESISTANCE}`);
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

  const familyPart = analysis.type === 'dc' && analysis.familySource ? ` ${sweptName(analysis.familySource)} ${analysis.familyFrom} ${analysis.familyTo} ${analysis.familyStep}` : '';
  const command =
    analysis.type === 'ac'
      ? `.ac dec ${analysis.pointsPerDecade} ${analysis.from} ${analysis.to}`
      : analysis.type === 'dc'
        ? `.dc ${sweptName(analysis.source)} ${analysis.from} ${analysis.to} ${analysis.step}${familyPart}`
        : `.tran ${analysis.step} ${analysis.stop}${analysis.maxStep ? ` 0 ${analysis.maxStep}` : ''}`;
  const text = [circuit.title, ...lines, ...modelCards.map((m) => m.card), command, '.end', ''].join('\n');
  return { text, errors, nodeOf };
}
