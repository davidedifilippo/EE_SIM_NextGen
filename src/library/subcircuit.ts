import { parseSpiceValue } from '../netlist/values';
import { MAX_BLOCK_PINS, MIN_BLOCK_PINS } from './blockPins';
import { logicalLines, MODEL_NAME, normalizeModelCard } from './modelCard';
import { isSubcircuitCard, isVdmos, OPAMP_PINS, splitSubcircuitHead as splitHead, subcircuitPins } from './models';
import { ParamScope, readParams } from './spiceExpression';

export { OPAMP_PINS, subcircuitPins };

export { MAX_BLOCK_PINS, MIN_BLOCK_PINS };

export type OpAmpRole = 'plus' | 'minus' | 'high' | 'low' | 'out';
/** The order nearly all manufacturers follow. */
export const OPAMP_ROLES: OpAmpRole[] = ['plus', 'minus', 'high', 'low', 'out'];

const ROLE_NAMES: Record<OpAmpRole, RegExp> = {
  plus: /^(\+|\+IN|IN\+|INP|VIN\+|VINP|NI|NONINV.*|NON_INV.*)$/,
  minus: /^(-|-IN|IN-|INN|VIN-|VINN|INV.*)$/,
  high: /^(V\+|VCC|VDD|VS\+|VPOS|VP|POS)$/,
  low: /^(V-|VEE|VSS|VS-|VNEG|VM|NEG|GND)$/,
  out: /^(OUT|OUTPUT|VO|VOUT)$/,
};

const isDirective = (line: string, name: string) => line.toLowerCase().split(/\s+/)[0] === name;

/** The line closing the block opened at start, past those of the blocks nested inside it. */
export function endOfBlock(lines: string[], start: number): number {
  let depth = 0;
  for (let i = start; i < lines.length; i++) {
    if (isDirective(lines[i], '.subckt')) depth++;
    else if (isDirective(lines[i], '.ends') && --depth === 0) return i;
  }
  return lines.length;
}

/** Who does what, from the names of the pins when all of them tell, otherwise in the usual order. */
export function guessOpAmpRoles(pins: string[]): OpAmpRole[] {
  const named = pins.map((pin) => OPAMP_ROLES.find((role) => ROLE_NAMES[role].test(pin.toUpperCase())));
  const isComplete = named.every(Boolean) && new Set(named).size === OPAMP_ROLES.length;
  return isComplete ? (named as OpAmpRole[]) : OPAMP_ROLES;
}

/** The roles chosen for the pins of a part, in the order of the pins, or null if they are not one of each. */
export function readOpAmpRoles(chosen: unknown, pins: string[]): OpAmpRole[] | null {
  const text = String(chosen ?? '').trim();
  if (!text) return pins.length === OPAMP_PINS ? guessOpAmpRoles(pins) : null;
  const roles = text.split(/\s+/) as OpAmpRole[];
  return roles.length === pins.length && OPAMP_ROLES.every((role) => roles.includes(role)) ? roles : null;
}

export type RegulatorRole = 'in' | 'ref' | 'out';
/** The order of the pins of the package. */
export const REGULATOR_ROLES: RegulatorRole[] = ['in', 'ref', 'out'];
const REGULATOR_NAMES: Record<RegulatorRole, RegExp> = {
  in: /^(IN|VIN|VI|INPUT)$/,
  ref: /^(GND|COM|COMMON|REF|ADJ|ADJUST)$/,
  out: /^(OUT|VOUT|VO|OUTPUT)$/,
};

export function readRegulatorRoles(chosen: unknown, pins: string[]): RegulatorRole[] | null {
  const text = String(chosen ?? '').trim();
  if (text) {
    const roles = text.split(/\s+/) as RegulatorRole[];
    return roles.length === pins.length && REGULATOR_ROLES.every((role) => roles.includes(role)) ? roles : null;
  }
  if (pins.length !== REGULATOR_ROLES.length) return null;
  const named = pins.map((pin) => REGULATOR_ROLES.find((role) => REGULATOR_NAMES[role].test(pin.toUpperCase())));
  return named.every(Boolean) && new Set(named).size === REGULATOR_ROLES.length ? (named as RegulatorRole[]) : REGULATOR_ROLES;
}

/** What a file offers to the subcircuits in it, besides their own contents. */
export interface FileParts {
  subcircuits: Map<string, { head: string; body: string[] }>;
  models: Map<string, string>;
  globals: ParamScope;
}

export function readFileParts(lines: string[], globals: ParamScope): FileParts {
  const parts: FileParts = { subcircuits: new Map(), models: new Map(), globals };
  for (let i = 0; i < lines.length; i++) {
    if (isDirective(lines[i], '.subckt')) {
      const end = endOfBlock(lines, i);
      parts.subcircuits.set(splitHead(lines[i]).name.toLowerCase(), { head: lines[i], body: lines.slice(i + 1, end) });
      i = end;
    } else if (isDirective(lines[i], '.model')) {
      parts.models.set((lines[i].split(/[\s(]+/)[1] ?? '').toLowerCase(), lines[i]);
    }
  }
  return parts;
}

/** The subcircuit an instance line calls. */
function instanceTarget(line: string): string {
  const tokens = line.split(/\s+/);
  const paramsAt = tokens.findIndex((token) => token.toLowerCase() === 'params:' || token.includes('='));
  return (paramsAt < 0 ? tokens[tokens.length - 1] : tokens[paramsAt - 1]).toLowerCase();
}

/** Subcircuits that others call: they come along with those, and are not parts to report on their own. */
export function referencedSubcircuits(parts: FileParts): Set<string> {
  const called = new Set<string>();
  for (const { body } of parts.subcircuits.values()) {
    for (const line of body) if (/^x/i.test(line)) called.add(instanceTarget(line));
  }
  return called;
}

class Unusable extends Error {}

const LIMIT_FUNCTION = '.func eesim_limit(x,a,b) {max(min(a,b),min(max(a,b),x))}';
/** What the B sources of ngspice compute, in the spelling of the files, which is the same for these. */
const EXPRESSION_FUNCTIONS = new Set(['v', 'i', 'abs', 'exp', 'sqrt', 'sin', 'cos', 'tan', 'atan', 'max', 'min', 'limit', 'eesim_limit']);

/** The products of the variables, in the order SPICE gives to the coefficients of a POLY. */
function polyTerms(variables: string[], count: number): string[][] {
  const terms: string[][] = [[]];
  let previous: { term: string[]; from: number }[] = [{ term: [], from: 0 }];
  while (terms.length < count) {
    const next: typeof previous = [];
    for (const { term, from } of previous) {
      for (let k = from; k < variables.length; k++) next.push({ term: [...term, variables[k]], from: k });
    }
    terms.push(...next.map((n) => n.term));
    previous = next;
  }
  return terms.slice(0, count);
}

/**
 * This build of ngspice stops for good on POLY, which it leaves to a module it does not have.
 * Nearly every macromodel uses it, so it becomes the same polynomial written as a B source.
 */
function translatePoly(line: string): string | null {
  const match = /^([efgh])(\S*)\s+(\S+)\s+(\S+)\s+poly\s*\(\s*(\d+)\s*\)\s*(.*)$/i.exec(line);
  if (!match) return null;
  const [, letter, rest, a, b, size, args] = match;
  const dimensions = Number(size);
  const tokens = args.replace(/\bic\s*=.*$/i, '').replace(/[(),]/g, ' ').trim().split(/\s+/);
  const isCurrent = /[fh]/i.test(letter);
  const controlCount = isCurrent ? dimensions : 2 * dimensions;
  if (dimensions < 1 || tokens.length <= controlCount) throw new Unusable(`POLY non leggibile in ${letter}${rest}`);

  const controls = tokens.slice(0, controlCount);
  const variables = isCurrent ? controls.map((source) => `i(${source})`) : Array.from({ length: dimensions }, (_, k) => `(v(${controls[2 * k]})-v(${controls[2 * k + 1]}))`);
  const coefficients = tokens.slice(controlCount).map((token) => parseSpiceValue(token));
  if (coefficients.some((c) => c === null)) throw new Unusable(`POLY con coefficienti non numerici in ${letter}${rest}`);

  // A single coefficient on a single variable is a plain gain, not a constant
  const values = dimensions === 1 && coefficients.length === 1 ? [0, coefficients[0]!] : (coefficients as number[]);
  const terms = polyTerms(variables, values.length);
  const expression = values.flatMap((value, k) => (value === 0 ? [] : [`${value < 0 ? '-' : '+'}${[Math.abs(value), ...terms[k]].join('*')}`])).join('');
  return `B${letter}${rest} ${a} ${b} ${/[eh]/i.test(letter) ? 'V' : 'I'}=${expression.replace(/^\+/, '') || '0'}`;
}

/** PSpice writes behaviour as VALUE={...}. ngspice takes it without complaint and computes something else. */
function translateValue(line: string, paramNames: Set<string>): string | null {
  const match = /^([eg])(\S*)\s+(\S+)\s+(\S+)\s+value\s*=?\s*\{(.*)\}\s*$/i.exec(line);
  if (!match) return null;
  const [, letter, rest, a, b, expression] = match;
  for (const [, name] of expression.matchAll(/([a-z_]\w*)\s*\(/gi)) {
    if (!EXPRESSION_FUNCTIONS.has(name.toLowerCase())) throw new Unusable(`funzione ${name} non supportata`);
  }
  // Inside a B source a parameter is only replaced between braces
  const computed = expression
    .replace(/\blimit\s*\(/gi, 'eesim_limit(')
    .replace(/(?<![\w.{])([a-z_]\w*)(?![\w(}])/gi, (word) => (paramNames.has(word.toLowerCase()) ? `{${word}}` : word));
  return `B${letter}${rest} ${a} ${b} ${/e/i.test(letter) ? 'V' : 'I'}=${computed}`;
}

const DEVICE_LETTERS = new Set('rcldqmjkefghvibx'.split(''));
const PARAM_LINE = /([a-z_]\w*)\s*=/gi;


/** Only what is known to reach ngspice safely: the text comes from files found on the internet. */
function cleanBlock(head: string, body: string[], outer: ParamScope, ignored: string[]): string[] {
  const { name, pins, params } = splitHead(head);
  if (!MODEL_NAME.test(name)) throw new Unusable('nome non valido');
  if (pins.some((pin) => !/^[\w+\-.#]+$/.test(pin))) throw new Unusable('intestazione non leggibile');

  let scope = readParams(params, outer);
  const paramNames = new Set([...params.matchAll(PARAM_LINE)].map(([, param]) => param.toLowerCase()));
  for (const line of body) {
    if (!isDirective(line, '.param')) continue;
    scope = readParams(line.slice('.param'.length), scope);
    for (const [, param] of line.matchAll(PARAM_LINE)) paramNames.add(param.toLowerCase());
  }

  const lines: string[] = [];
  for (let i = 0; i < body.length; i++) {
    const line = body[i];
    if (isDirective(line, '.subckt')) {
      const end = endOfBlock(body, i);
      lines.push(...cleanBlock(line, body.slice(i + 1, end), scope, ignored));
      i = end;
    } else if (isDirective(line, '.model')) {
      lines.push(cleanModel(line, scope, ignored));
    } else if (isDirective(line, '.param') || isDirective(line, '.func')) {
      lines.push(line);
    } else if (isDirective(line, '.backanno')) {
      continue;
    } else if (line.startsWith('.')) {
      throw new Unusable(`contiene ${line.split(/\s+/)[0]}, che non è supportato`);
    } else {
      if (!DEVICE_LETTERS.has(line[0].toLowerCase())) throw new Unusable(`contiene un componente non supportato (${line.split(/\s+/)[0]})`);
      const translated = translatePoly(line) ?? translateValue(line, paramNames);
      if (!translated && /^[efgh]/i.test(line) && /\b(value|table|laplace|freq|chebyshev)\b/i.test(line)) throw new Unusable(`${line.split(/\s+/)[0]} usa una forma non supportata`);
      lines.push(translated ?? line);
    }
  }
  return [`.subckt ${name} ${pins.join(' ')}${params ? ` params: ${params}` : ''}`, ...lines, '.ends'];
}

function cleanModel(statement: string, scope: ParamScope, ignored: string[]): string {
  const name = statement.split(/[\s(]+/)[1] ?? '?';
  const model = normalizeModelCard(statement, scope, true);
  if (!model) throw new Unusable(`il modello ${name} è di un tipo non supportato`);
  if (model.unresolved.length > 0) throw new Unusable(`valori non calcolabili per ${model.unresolved.join(', ')}`);
  const level = /[\s(]LEVEL=(\S+?)[\s)]/i.exec(model.card)?.[1];
  if ((model.type === 'NMOS' || model.type === 'PMOS') && !isVdmos(model.card) && level !== undefined && parseSpiceValue(level) !== 1) throw new Unusable(`il modello ${name} è di livello ${level}`);
  ignored.push(...model.ignored);
  return model.card;
}

/** Everything defined anywhere in the lines. */
function definedNames(lines: string[], directive: string): Set<string> {
  return new Set(lines.filter((line) => isDirective(line, directive)).map((line) => (line.split(/[\s(]+/)[1] ?? '').toLowerCase()));
}

/** Words on a device line that can be its model: the nodes come first, and parameters have an equal sign. */
const modelCandidates = (line: string) => line.split(/\s+/).slice(3).filter((token) => !token.includes('=')).map((token) => token.toLowerCase());

/** A device with a model of another kind stops ngspice for good, without a word to show. */
function checkModelKinds(lines: string[]) {
  const kinds = new Map(lines.filter((line) => isDirective(line, '.model')).map((line) => {
    const [, name = '', keyword = ''] = line.split(/[\s(]+/);
    return [name.toLowerCase(), keyword.toUpperCase()] as const;
  }));
  const accepted: Record<string, string[]> = { d: ['D'], q: ['NPN', 'PNP'], j: ['NJF', 'PJF'], m: ['NMOS', 'PMOS', 'VDMOS'] };
  for (const line of lines) {
    const allowed = accepted[line[0].toLowerCase()];
    if (!allowed || line.startsWith('.')) continue;
    const words = modelCandidates(line).filter((word) => kinds.has(word));
    if (words.length > 0 && !words.some((word) => allowed.includes(kinds.get(word)!))) throw new Unusable(`${line.split(/\s+/)[0]} usa un modello del tipo sbagliato`);
    // Only a VDMOS has three terminals: this one would take its model for the fourth node
    const fourth = line.split(/\s+/)[4]?.toLowerCase();
    if (/^m/i.test(line) && fourth && ['NMOS', 'PMOS'].includes(kinds.get(fourth) ?? '')) throw new Unusable(`${line.split(/\s+/)[0]} non ha il terminale di bulk`);
  }
}

/** Brings in what the lines call and the file defines outside them, until nothing is missing. */
function bringInDependencies(lines: string[], parts: FileParts, ignored: string[]): string[] {
  const all = [...lines];
  for (;;) {
    const subcircuits = definedNames(all, '.subckt');
    const models = definedNames(all, '.model');
    const missingCall = all.filter((line) => /^x/i.test(line)).map(instanceTarget).find((target) => !subcircuits.has(target));
    if (missingCall) {
      const part = parts.subcircuits.get(missingCall);
      if (!part) throw new Unusable(`manca il sottocircuito ${missingCall}, che non è nel testo`);
      // Inside the one that needs it: another model in the library may have its own with the same name
      all.splice(all.length - 1, 0, ...cleanBlock(part.head, part.body, parts.globals, ignored));
      continue;
    }
    const missingModel = all.filter((line) => /^[dqjm]/i.test(line)).map(modelCandidates).find((words) => !words.some((word) => models.has(word)));
    if (!missingModel) return all;
    const name = missingModel.find((word) => parts.models.has(word));
    if (!name) throw new Unusable(`manca il modello ${missingModel[missingModel.length - 1] ?? ''}, che non è nel testo`.trim());
    all.splice(all.length - 1, 0, cleanModel(parts.models.get(name)!, parts.globals, ignored));
  }
}

/** One card, on several lines, that holds all a subcircuit needs. */
export function buildSubcircuit(head: string, body: string[], parts: FileParts): { name: string; card: string; ignored: string[] } | { reason: string } {
  try {
    const ignored: string[] = [];
    const lines = bringInDependencies(cleanBlock(head, body, parts.globals, ignored), parts, ignored);
    if (!lines.some((line) => !line.startsWith('.'))) throw new Unusable('dentro non ci sono componenti leggibili: forse è cifrato');
    checkModelKinds(lines);
    const text = lines.slice(1).join('\n');
    const extras = [
      ...[...parts.globals].filter(([param]) => new RegExp(`\\b${param}\\b`, 'i').test(text)).map(([param, value]) => `.param ${param}=${value}`),
      ...(text.includes('eesim_limit(') && !text.includes('.func eesim_limit') ? [LIMIT_FUNCTION] : []),
    ];
    return { name: splitHead(head).name, card: [lines[0], ...extras, ...lines.slice(1)].join('\n'), ignored: [...new Set(ignored)] };
  } catch (error) {
    if (error instanceof Unusable) return { reason: error.message };
    throw error;
  }
}

/** A stored card goes through the same cleaning, on its own: all it needs is inside it. Null if it does not hold. */
export function normalizeSubcircuitCard(card: string): { name: string; card: string; ignored: string[] } | null {
  if (!isSubcircuitCard(card)) return null;
  const lines = logicalLines(card);
  const end = endOfBlock(lines, 0);
  if (end !== lines.length - 1) return null;
  const built = buildSubcircuit(lines[0], lines.slice(1, end), { subcircuits: new Map(), models: new Map(), globals: new Map() });
  return 'reason' in built ? null : built;
}
