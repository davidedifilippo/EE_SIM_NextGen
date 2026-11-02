import { ModelType, SpiceModel } from '../model/types';
import { parseSpiceValue } from '../netlist/values';
import { evaluateExpression, ParamScope } from './spiceExpression';

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
const MOS1_PARAMS = new Set('VTO VT0 KP GAMMA PHI LAMBDA RD RS CBD CBS IS PB CGSO CGDO CGBO RSH CJ MJ CJSW MJSW JS TOX NSUB NSS TPG LD UO U0 KF AF FC TNOM LEVEL'.split(' '));
const VDMOS_PARAMS = new Set(
  'VTO KP PHI LAMBDA THETA RD RS RG RQ VQ MTRIODE TNOM KF AF TRD1 TRD2 TRG1 TRG2 TRS1 TRS2 CGDMIN CGDMAX A CGS CJO IS BV IBV NBV RB N TT EG XTI FC M VJ KSUBTHRES SUBSHIFT TKSUBTHRES1 TKSUBTHRES2 BEX VTOTC TCVTH MU CTHJ'.split(' '),
);
/** Only inside subcircuits, where operational amplifiers use them: no part on the sheet takes one. */
const JFET_PARAMS = new Set('IS BETA VTO LAMBDA RD RS CGS CGD PB M FC KF AF B N XTI VTOTC BETATCE TNOM'.split(' '));
const acceptedFor = (keyword: string) => (keyword === 'NJF' || keyword === 'PJF' ? JFET_PARAMS : keyword === 'D' ? DIODE_PARAMS : keyword === 'VDMOS' ? VDMOS_PARAMS : keyword === 'NPN' || keyword === 'PNP' ? BJT_PARAMS : MOS1_PARAMS);

export const MODEL_NAME = /^[A-Za-z0-9_.+-]+$/;
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

const KEYWORDS = new Set(['D', 'NPN', 'PNP', 'NMOS', 'PMOS', 'VDMOS']);
const UNRESOLVED = '{?}';

/** One model statement on one line, with only what ngspice accepts. Null if it is not a usable model. */
export function normalizeModelCard(statement: string, scope: ParamScope = new Map(), allowJfet = false): ImportedModel | null {
  // Expressions first: they contain the parentheses and spaces that separate everything else
  const computed = statement.replace(/\{([^{}]*)\}|'([^']*)'/g, (_, braces: string | undefined, quotes: string | undefined) => {
    const value = evaluateExpression(braces ?? quotes ?? '', scope);
    return value === null ? UNRESOLVED : String(value);
  });
  const match = /^\s*\.model\s+(\S+?)\s+([a-z]+)\s*(?:\((.*)\)|(.*))\s*$/is.exec(computed);
  if (!match || !MODEL_NAME.test(match[1])) return null;
  const keyword = match[2].toUpperCase();
  if (!KEYWORDS.has(keyword) && !(allowJfet && (keyword === 'NJF' || keyword === 'PJF'))) return null;

  const body = (match[3] ?? match[4] ?? '').replace(/[(),]/g, ' ');
  const kept: string[] = [];
  const ignored: string[] = [];
  const unresolved: string[] = [];
  for (const [, name, value] of body.matchAll(/([a-z_][\w.]*)\s*=\s*(\S+)/gi)) {
    const upper = name.toUpperCase();
    const known = keyword === 'NPN' || keyword === 'PNP' ? (BJT_ALIASES[upper] ?? upper) : upper;
    if (value === UNRESOLVED) unresolved.push(name);
    else if (acceptedFor(keyword).has(known) && parseSpiceValue(value) !== null) kept.push(`${known}=${value}`);
    else ignored.push(name);
  }
  // The channel of a VDMOS is a bare word among the parameters
  const isPchan = keyword === 'VDMOS' && /(^|\s)pchan(\s|$)/i.test(body);
  const params = [...(isPchan ? ['PCHAN'] : []), ...kept].join(' ');
  const type = (keyword === 'VDMOS' ? (isPchan ? 'PMOS' : 'NMOS') : keyword) as ModelType;
  return { name: match[1], type, card: `.model ${match[1]} ${keyword}(${params})`, ignored, unresolved };
}

/** Joins continuation lines and drops comments, as SPICE reads a file. */
export function logicalLines(text: string): string[] {
  const lines: string[] = [];
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.replace(/\s(;|\$).*$/, '').replace(/^(;|\$).*$/, '').trim();
    if (!line || line.startsWith('*')) continue;
    if (line.startsWith('+') && lines.length > 0) lines[lines.length - 1] += ` ${line.slice(1).trim()}`;
    else lines.push(line);
  }
  return lines;
}
