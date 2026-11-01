import { ModelType, SpiceModel } from '../model/types';
import { parseSpiceValue } from '../netlist/values';
import { evaluateExpression, ParamScope, readParams } from './spiceExpression';

/**
 * What ngspice accepts, checked one by one against the bundled build. Anything else must not
 * reach it: manufacturers add fields like Vceo or mfg, and those stop ngspice or hang it.
 */
const BJT_PARAMS = new Set(
  'IS BF NF VAF VA IKF IK ISE NE BR NR VAR VB IKR ISC NC RB IRB RBM RE RC CJE VJE PE MJE ME TF XTF VTF ITF PTF CJC VJC PC MJC MC XCJC TR CJS CCS VJS PS MJS MS XTB EG XTI KF AF FC TNOM TREF C2 C4 ISS NS LEVEL SUBS RCO VO GAMMA QCO VG CN D TRE1 TRE2 TRC1 TRC2 TRB1 TRB2 NKF'.split(' '),
);
const DIODE_PARAMS = new Set(
  'IS JS RS N TT CJO CJ0 CJ VJ PB M MJ EG XTI KF AF FC BV IBV IB NBV IKF IK IKR TNOM TREF LEVEL ISR NR ISW JSW CJSW CJP TLEV TLEVC TM1 TM2 TTT1 TTT2 TRS TRS1 TRS2 TCV FCS'.split(' '),
);
const ACCEPTED: Record<ModelType, Set<string>> = { D: DIODE_PARAMS, NPN: BJT_PARAMS, PNP: BJT_PARAMS };

const MODEL_NAME = /^[A-Za-z0-9_.+-]+$/;
/** Same parameter under the name LTspice uses, kept instead of being lost. */
const BJT_ALIASES: Record<string, string> = { NK: 'NKF' };

export interface ImportedModel extends SpiceModel {
  type: ModelType;
  /** Parameters left out because ngspice would not accept them, in the spelling of the source. */
  ignored: string[];
  /** Parameters whose value is an expression that cannot be computed. */
  unresolved: string[];
}

export interface ModelImport {
  models: ImportedModel[];
  /** What was found and cannot be used, ready to show. */
  skipped: string[];
}

const isModelType = (type: string): type is ModelType => type === 'D' || type === 'NPN' || type === 'PNP';
const UNRESOLVED = '{?}';

/** One model statement on one line, with only what ngspice accepts. Null if it is not a usable model. */
export function normalizeModelCard(statement: string, scope: ParamScope = new Map()): ImportedModel | null {
  // Expressions first: they contain the parentheses and spaces that separate everything else
  const computed = statement.replace(/\{([^{}]*)\}|'([^']*)'/g, (_, braces: string | undefined, quotes: string | undefined) => {
    const value = evaluateExpression(braces ?? quotes ?? '', scope);
    return value === null ? UNRESOLVED : String(value);
  });
  const match = /^\s*\.model\s+(\S+?)\s+([a-z]+)\s*(?:\((.*)\)|(.*))\s*$/is.exec(computed);
  if (!match || !MODEL_NAME.test(match[1])) return null;
  const type = match[2].toUpperCase();
  if (!isModelType(type)) return null;

  const body = (match[3] ?? match[4] ?? '').replace(/[(),]/g, ' ');
  const kept: string[] = [];
  const ignored: string[] = [];
  const unresolved: string[] = [];
  for (const [, name, value] of body.matchAll(/([a-z_][\w.]*)\s*=\s*(\S+)/gi)) {
    const known = type === 'D' ? name.toUpperCase() : (BJT_ALIASES[name.toUpperCase()] ?? name.toUpperCase());
    if (value === UNRESOLVED) unresolved.push(name);
    else if (ACCEPTED[type].has(known) && parseSpiceValue(value) !== null) kept.push(`${known}=${value}`);
    else ignored.push(name);
  }
  return { name: match[1], type, card: `.model ${match[1]} ${type}(${kept.join(' ')})`, ignored, unresolved };
}

/** Joins continuation lines and drops comments, as SPICE reads a file. */
function logicalLines(text: string): string[] {
  const lines: string[] = [];
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.replace(/\s(;|\$).*$/, '').replace(/^(;|\$).*$/, '').trim();
    if (!line || line.startsWith('*')) continue;
    if (line.startsWith('+') && lines.length > 0) lines[lines.length - 1] += ` ${line.slice(1).trim()}`;
    else lines.push(line);
  }
  return lines;
}

const isDirective = (line: string, name: string) => line.toLowerCase().startsWith(name);
const NODES_OF: Record<string, number> = { q: 3, d: 2 };

/**
 * Many manufacturers wrap a single part in a subcircuit, only to compute its model from datasheet
 * values. That is one model in disguise, under the name of the subcircuit. Only this exact shape
 * qualifies: one device, wired to the pins in order, with nothing else in between.
 */
function unwrapSubcircuit(head: string, body: string[], globals: ParamScope): ImportedModel | null {
  const [, name, ...rest] = head.split(/\s+/);
  const paramsAt = rest.findIndex((token) => token.toLowerCase() === 'params:' || token.includes('='));
  const pins = (paramsAt < 0 ? rest : rest.slice(0, paramsAt)).map((pin) => pin.toLowerCase());
  const headParams = paramsAt < 0 ? '' : rest.slice(paramsAt).join(' ').replace(/^params:/i, '');

  const devices = body.filter((line) => !line.startsWith('.'));
  if (devices.length !== 1) return null;
  const [reference, ...tokens] = devices[0].split(/\s+/);
  const modelName = tokens.pop();
  const nodeCount = NODES_OF[reference[0].toLowerCase()];
  if (!modelName || tokens.length !== nodeCount || tokens.join(' ').toLowerCase() !== pins.join(' ')) return null;

  const statement = body.find((line) => isDirective(line, '.model') && line.split(/[\s(]+/)[1]?.toLowerCase() === modelName.toLowerCase());
  if (!statement) return null;
  const otherDirectives = body.filter((line) => line.startsWith('.') && line !== statement && !isDirective(line, '.param'));
  if (otherDirectives.length > 0) return null;

  let scope = readParams(headParams, globals);
  for (const line of body) if (isDirective(line, '.param')) scope = readParams(line.slice('.param'.length), scope);
  const model = normalizeModelCard(statement.replace(/^(\.model\s+)\S+/i, `$1${name}`), scope);
  const fits = model && (nodeCount === 2 ? model.type === 'D' : model.type !== 'D');
  return fits ? model : null;
}

const AKO = /^\.model\s+(\S+)\s+ako:([^\s(]+)(?:\s+[a-z]+)?\s*(?:\((.*)\))?\s*$/is;

/** "A kind of": the parameters of another model, with some replaced. Only the replacements can be ignored. */
function resolveAko(line: string, models: Map<string, ImportedModel>, scope: ParamScope): ImportedModel | string {
  const [, name, baseName, overrides = ''] = AKO.exec(line)!;
  const base = [...models.values()].find((m) => m.name.toLowerCase() === baseName.toLowerCase());
  if (!base) return `${name}: il modello di partenza ${baseName} non è nel testo`;
  const own = normalizeModelCard(`.model ${name} ${base.type}(${overrides})`, scope);
  if (!own) return `${name}: nome non valido`;

  const pairs = (card: string) => [.../\((.*)\)/.exec(card)![1].matchAll(/(\S+?)=(\S+)/g)].map(([, key, value]): [string, string] => [key, value]);
  const merged = new Map([...pairs(base.card), ...pairs(own.card)]);
  const body = [...merged].map(([key, value]) => `${key}=${value}`).join(' ');
  return { ...own, card: `.model ${name} ${base.type}(${body})` };
}

/** Lines for the person importing: models that lost the same parameters share one line. */
export function describeImport({ models, skipped }: ModelImport): string[] {
  const byIgnored = new Map<string, string[]>();
  for (const { name, ignored } of models) {
    if (ignored.length > 0) byIgnored.set(ignored.join(', '), [...(byIgnored.get(ignored.join(', ')) ?? []), name]);
  }
  const ignoredLines = [...byIgnored].map(([ignored, names]) => (names.length === 1 ? `${names[0]}: ignorati ${ignored}` : `${names.length} modelli: ignorati ${ignored}`));
  return [`Importati ${models.length === 1 ? models[0].name : `${models.length} modelli: ${models.map((m) => m.name).join(', ')}`}`, ...ignoredLines, ...skipped];
}

/** Reads what is useful from text pasted from a datasheet page or a library file. */
export function parseModelText(text: string): ModelImport {
  const models = new Map<string, ImportedModel>();
  const skipped: string[] = [];
  const lines = logicalLines(text);

  let globals: ParamScope = new Map();
  let depth = 0;
  for (const line of lines) {
    if (isDirective(line, '.subckt')) depth++;
    else if (isDirective(line, '.ends')) depth--;
    else if (depth === 0 && isDirective(line, '.param')) globals = readParams(line.slice('.param'.length), globals);
  }

  const add = (model: ImportedModel) => {
    if (model.unresolved.length > 0) skipped.push(`${model.name}: valori non calcolabili per ${model.unresolved.join(', ')}`);
    else models.set(model.name, model);
  };

  // Resolved last, since a file can define them before the model they refer to
  const akoLines: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isDirective(line, '.subckt')) {
      const end = lines.findIndex((other, k) => k > i && isDirective(other, '.ends'));
      const body = lines.slice(i + 1, end < 0 ? lines.length : end);
      const model = unwrapSubcircuit(line, body, globals);
      if (model) add(model);
      else skipped.push(`${line.split(/\s+/)[1] ?? '?'}: i sottocircuiti non sono ancora supportati`);
      i = end < 0 ? lines.length : end;
    } else if (AKO.test(line)) {
      akoLines.push(line);
    } else if (isDirective(line, '.model')) {
      const model = normalizeModelCard(line, globals);
      if (model) add(model);
      else {
        const [, name = '?', type = ''] = line.split(/[\s(]+/);
        skipped.push(`${name}: modello ${type.toUpperCase()} non ancora supportato`.replace('  ', ' '));
      }
    }
  }
  for (const line of akoLines) {
    const model = resolveAko(line, models, globals);
    if (typeof model === 'string') skipped.push(model);
    else add(model);
  }
  return { models: [...models.values()], skipped };
}
