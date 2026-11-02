import { SpiceModel } from '../model/types';
import { isSubcircuitCard, isVdmos } from './models';
import { parseSpiceValue } from '../netlist/values';
import { ImportedModel, logicalLines, ModelImport, normalizeModelCard } from './modelCard';
import { ParamScope, readParams } from './spiceExpression';
import { buildSubcircuit, endOfBlock, MAX_BLOCK_PINS, MIN_BLOCK_PINS, normalizeSubcircuitCard, OPAMP_PINS, readFileParts, referencedSubcircuits, subcircuitPins } from './subcircuit';

export { normalizeModelCard } from './modelCard';
export type { ImportedModel, ModelImport } from './modelCard';

const isDirective = (line: string, name: string) => line.toLowerCase().startsWith(name);
const NODES_OF: Record<string, number> = { q: 3, d: 2, m: 3 };

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
  const reference0 = reference[0].toLowerCase();
  const fits = model && (reference0 === 'd' ? model.type === 'D' : reference0 === 'q' ? model.type === 'NPN' || model.type === 'PNP' : isVdmos(model.card));
  return fits ? model : null;
}

const AKO = /^\.model\s+(\S+)\s+ako:([^\s(]+)(?:\s+[a-z]+)?\s*(?:\((.*)\))?\s*$/is;

/** "A kind of": the parameters of another model, with some replaced. Only the replacements can be ignored. */
function resolveAko(line: string, models: Map<string, ImportedModel>, scope: ParamScope): ImportedModel | string {
  const [, name, baseName, overrides = ''] = AKO.exec(line)!;
  const base = [...models.values()].find((m) => m.name.toLowerCase() === baseName.toLowerCase());
  if (!base) return `${name}: il modello di partenza ${baseName} non è nel testo`;
  const keyword = /^\s*\.model\s+\S+\s+([a-z]+)/i.exec(base.card)![1];
  const own = normalizeModelCard(`.model ${name} ${keyword}(${overrides})`, scope);
  if (!own) return `${name}: nome non valido`;

  const pairs = (card: string) => [.../\((.*)\)/.exec(card)![1].matchAll(/(\S+?)=(\S+)/g)].map(([, key, value]): [string, string] => [key, value]);
  const merged = new Map([...pairs(base.card), ...pairs(own.card)]);
  const body = [...(/\(PCHAN/.test(base.card) ? ['PCHAN'] : []), ...[...merged].map(([key, value]) => `${key}=${value}`)].join(' ');
  return { ...own, type: base.type, card: `.model ${name} ${keyword}(${body})` };
}

/** A card read back from a file or from storage, cleaned as if it were imported now. */
export function cleanStoredCard(card: string): SpiceModel | null {
  const clean = isSubcircuitCard(card) ? normalizeSubcircuitCard(card) : normalizeModelCard(card);
  return clean ? { name: clean.name, card: clean.card } : null;
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
    const level = /[\s(]LEVEL=(\S+?)[\s)]/i.exec(model.card)?.[1];
    if ((model.type === 'NMOS' || model.type === 'PMOS') && !isVdmos(model.card) && level !== undefined && parseSpiceValue(level) !== 1) {
      skipped.push(`${model.name}: per i MOSFET è supportato solo il livello 1, questo è il ${level}`);
    } else if (model.unresolved.length > 0) skipped.push(`${model.name}: valori non calcolabili per ${model.unresolved.join(', ')}`);
    else models.set(model.name, model);
  };

  const parts = readFileParts(lines, globals);
  const helpers = referencedSubcircuits(parts);

  // Resolved last, since a file can define them before the model they refer to
  const akoLines: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isDirective(line, '.subckt')) {
      const end = endOfBlock(lines, i);
      const body = lines.slice(i + 1, end);
      const name = line.split(/\s+/)[1] ?? '?';
      const model = unwrapSubcircuit(line, body, globals);
      if (model) add(model);
      else if (!helpers.has(name.toLowerCase())) {
        const pins = subcircuitPins(line);
        const fits = pins.length >= MIN_BLOCK_PINS && pins.length <= MAX_BLOCK_PINS;
        const built = fits ? buildSubcircuit(line, body, parts) : null;
        if (!fits) skipped.push(`${name}: ha ${pins.length} piedini, se ne possono usare da ${MIN_BLOCK_PINS} a ${MAX_BLOCK_PINS}`);
        else if (built && 'reason' in built) skipped.push(`${name}: ${built.reason}`);
        else if (built) models.set(built.name, { ...built, type: pins.length === OPAMP_PINS ? 'OPAMP' : 'SUBCKT', unresolved: [] });
      }
      i = end;
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
