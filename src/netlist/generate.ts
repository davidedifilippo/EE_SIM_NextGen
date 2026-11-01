import { Circuit, ModelType, SpiceModel } from '../model/types';
import { getDevice } from '../library/devices';
import { findModel, isVdmos, modelType } from '../library/models';
import { computeConnectivity, terminalKey } from './connectivity';
import { sourceSpec } from './source';
import { parseSpiceValue } from './values';

export interface TranAnalysis {
  type: 'tran';
  step: string;
  stop: string;
  maxStep?: string;
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

function cardName(prefix: string, tag: string): string {
  return tag.toUpperCase().startsWith(prefix) ? tag : `${prefix}${tag}`;
}

/** Human-readable label for each node, e.g. "n2" -> "D1.cathode, R1.a". Ground is left out. */
export function describeNodes(circuit: Circuit, nodeOf: Map<string, string>): Map<string, string> {
  const terminals = new Map<string, string[]>();
  for (const el of circuit.elements) {
    if (!el.tag) continue;
    for (const t of getDevice(el.def)?.terminals ?? []) {
      const node = nodeOf.get(terminalKey(el.id, t.id));
      if (!node || node === '0') continue;
      terminals.set(node, [...(terminals.get(node) ?? []), `${el.tag}.${t.id}`]);
    }
  }
  return new Map([...terminals].map(([node, names]) => [node, names.join(', ')]));
}

/** Open loop gain of the ideal op amp, shared with the real-time engine. */
export const OPAMP_GAIN = 1e6;

/**
 * kicked names the op amps with nowhere stable to rest at the start, as in an oscillator: an exact
 * solver would stay there forever, so they get a push during the first step, as noise would give.
 */
export function generateNetlist(circuit: Circuit, analysis: TranAnalysis, kicked: Set<string> = new Set()): NetlistResult {
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
    if (modelType(model.card) !== type) {
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
      case 'vsource': {
        const spec = sourceSpec(el.props);
        if (!spec) {
          errors.push(`${el.tag}: sorgente non valida`);
          break;
        }
        const name = uniqueName('V', el.tag);
        if (name) lines.push(`${name} ${node(s.pos)} ${node(s.neg)} ${spec}`);
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
      case 'opamp': {
        const [high, low] = [parseSpiceValue(String(el.props[s.highProp] ?? '')), parseSpiceValue(String(el.props[s.lowProp] ?? ''))];
        if (high === null || low === null || high <= low) {
          errors.push(`${el.tag}: alimentazioni non valide`);
          break;
        }
        const name = uniqueName('B', el.tag);
        const step = parseSpiceValue(analysis.step) ?? 0;
        const kick = kicked.has(el.id) ? `+${high - low}*u(time-1e-12)*u(${step}-time)` : '';
        if (name) {
          // A very fast pole on the output: without it, ngspice can fail on a diode inside the loop
          const inner = `x${name}`;
          lines.push(`${name} ${inner} 0 V = max(${low}, min(${high}, ${OPAMP_GAIN}*(v(${node(s.plus)})-v(${node(s.minus)})${kick})))`);
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
    if (!isSingleLine(m.card)) errors.push(`Modello ${m.name}: la card deve stare su una riga`);
  }
  if (!isSingleLine(circuit.title)) errors.push('Il titolo deve stare su una riga');
  for (const [label, value] of [['Durata', analysis.stop], ['Passo', analysis.step], ['Passo massimo', analysis.maxStep ?? '1']]) {
    if (!SPICE_VALUE.test(value.trim())) errors.push(`${label}: valore non valido "${value}"`);
  }

  const nodeOf = new Map<string, string>();
  for (const [key, net] of netOf) nodeOf.set(key, nodeName(net));

  if (errors.length > 0) return { text: '', errors, nodeOf };

  const tran = `.tran ${analysis.step} ${analysis.stop}${analysis.maxStep ? ` 0 ${analysis.maxStep}` : ''}`;
  const text = [circuit.title, ...lines, ...modelCards.map((m) => m.card), tran, '.end', ''].join('\n');
  return { text, errors, nodeOf };
}
