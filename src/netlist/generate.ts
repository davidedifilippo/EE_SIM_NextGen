import { Circuit } from '../model/types';
import { getDevice } from '../library/devices';
import { computeConnectivity, terminalKey } from './connectivity';

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

export function generateNetlist(circuit: Circuit, analysis: TranAnalysis): NetlistResult {
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
    if (!groundTerminals.has(key)) errors.push(`Terminale non collegato: ${key}`);
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
  const usedModels = new Set<string>();

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
        const spec = String(el.props.spec ?? '').trim();
        if (!spec || !isSingleLine(spec)) {
          errors.push(`${el.tag}: sorgente non valida "${spec}"`);
          break;
        }
        const name = uniqueName('V', el.tag);
        if (name) lines.push(`${name} ${node(s.pos)} ${node(s.neg)} ${spec}`);
        break;
      }
      case 'diode': {
        const model = String(el.props[s.modelProp] ?? '').trim();
        if (!circuit.models.some((m) => m.name === model)) {
          errors.push(`${el.tag}: modello non definito "${model}"`);
          break;
        }
        usedModels.add(model);
        const name = uniqueName('D', el.tag);
        if (name) lines.push(`${name} ${node(s.anode)} ${node(s.cathode)} ${model}`);
        break;
      }
    }
  }

  const modelCards = circuit.models.filter((m) => usedModels.has(m.name));
  for (const m of modelCards) {
    if (!isSingleLine(m.card)) errors.push(`Modello ${m.name}: la card deve stare su una riga`);
  }
  if (!isSingleLine(circuit.title)) errors.push('Il titolo deve stare su una riga');

  const nodeOf = new Map<string, string>();
  for (const [key, net] of netOf) nodeOf.set(key, nodeName(net));

  if (errors.length > 0) return { text: '', errors, nodeOf };

  const tran = `.tran ${analysis.step} ${analysis.stop}${analysis.maxStep ? ` 0 ${analysis.maxStep}` : ''}`;
  const text = [circuit.title, ...lines, ...modelCards.map((m) => m.card), tran, '.end', ''].join('\n');
  return { text, errors, nodeOf };
}
