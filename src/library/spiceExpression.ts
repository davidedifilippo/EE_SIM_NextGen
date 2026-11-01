import { parseSpiceValue } from '../netlist/values';

/** Parameter values by lowercase name. */
export type ParamScope = Map<string, number>;

const TOKEN = /\s*(\*\*|[-+*/^()]|(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?[a-z]*|[a-z_]\w*)/iy;
const CONSTANTS: ParamScope = new Map([['pi', Math.PI]]);

/**
 * Arithmetic on numbers and parameters, as in {1/(2*pi*ft)}. A small parser and never eval:
 * the text comes from files found on the internet. Returns null for anything else.
 */
export function evaluateExpression(text: string, scope: ParamScope): number | null {
  const tokens: string[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < text.length) {
    if (text.slice(TOKEN.lastIndex).trim() === '') break;
    const match = TOKEN.exec(text);
    if (!match) return null;
    tokens.push(match[1]);
  }

  let position = 0;
  let isValid = tokens.length > 0;
  const peek = () => tokens[position];
  const accept = (...options: string[]) => (options.includes(peek()) ? tokens[position++] : null);

  const primary = (): number => {
    const token = tokens[position++];
    if (token === undefined) {
      isValid = false;
      return 0;
    }
    if (token === '(') {
      const value = sum();
      if (!accept(')')) isValid = false;
      return value;
    }
    const known = parseSpiceValue(token) ?? scope.get(token.toLowerCase()) ?? CONSTANTS.get(token.toLowerCase());
    if (known === undefined) isValid = false;
    return known ?? 0;
  };
  const power = (): number => {
    const base = unary();
    return accept('^', '**') ? Math.pow(base, power()) : base;
  };
  function unary(): number {
    if (accept('-')) return -unary();
    accept('+');
    return primary();
  }
  const product = (): number => {
    let value = power();
    for (let op = accept('*', '/'); op; op = accept('*', '/')) value = op === '*' ? value * power() : value / power();
    return value;
  };
  function sum(): number {
    let value = product();
    for (let op = accept('+', '-'); op; op = accept('+', '-')) value = op === '+' ? value + product() : value - product();
    return value;
  }

  const result = sum();
  return isValid && position === tokens.length && Number.isFinite(result) ? result : null;
}

const VALUE = /([a-z_]\w*)\s*=\s*(\{[^{}]*\}|'[^']*'|\S+)/gi;

/** Reads name=value pairs in order, each able to use the ones before it. What cannot be computed stays out. */
export function readParams(text: string, outer: ParamScope): ParamScope {
  const scope: ParamScope = new Map(outer);
  for (const [, name, value] of text.matchAll(VALUE)) {
    const result = evaluateExpression(value.replace(/^[{']|[}']$/g, ''), scope);
    if (result !== null) scope.set(name.toLowerCase(), result);
  }
  return scope;
}
