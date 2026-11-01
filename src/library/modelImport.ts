import { ModelType, SpiceModel } from '../model/types';
import { parseSpiceValue } from '../netlist/values';

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

export interface ImportedModel extends SpiceModel {
  type: ModelType;
  /** Parameters left out, in the spelling of the source. */
  ignored: string[];
}

export interface ModelImport {
  models: ImportedModel[];
  /** What was found and cannot be used, ready to show. */
  skipped: string[];
}

const isModelType = (type: string): type is ModelType => type === 'D' || type === 'NPN' || type === 'PNP';

/** One model statement on one line, with only what ngspice accepts. Null if it is not a usable model. */
export function normalizeModelCard(statement: string): ImportedModel | null {
  const match = /^\s*\.model\s+(\S+?)\s+([a-z]+)\s*(?:\((.*)\)|(.*))\s*$/is.exec(statement);
  if (!match || !MODEL_NAME.test(match[1])) return null;
  const type = match[2].toUpperCase();
  if (!isModelType(type)) return null;

  const body = (match[3] ?? match[4] ?? '').replace(/[(),]/g, ' ');
  const kept: string[] = [];
  const ignored: string[] = [];
  const pattern = /([a-z_][\w.]*)\s*=\s*(\S+)/gi;
  for (const [, name, value] of body.matchAll(pattern)) {
    if (ACCEPTED[type].has(name.toUpperCase()) && parseSpiceValue(value) !== null) kept.push(`${name.toUpperCase()}=${value}`);
    else ignored.push(name);
  }
  return { name: match[1], type, card: `.model ${match[1]} ${type}(${kept.join(' ')})`, ignored };
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

/** Reads what is useful from text pasted from a datasheet page or a library file. */
export function parseModelText(text: string): ModelImport {
  const models = new Map<string, ImportedModel>();
  const skipped: string[] = [];
  let inSubcircuit: string | null = null;

  for (const line of logicalLines(text)) {
    const lower = line.toLowerCase();
    if (lower.startsWith('.subckt')) {
      inSubcircuit = line.split(/\s+/)[1] ?? '?';
      skipped.push(`${inSubcircuit}: i sottocircuiti non sono ancora supportati`);
    } else if (lower.startsWith('.ends')) {
      inSubcircuit = null;
    } else if (!inSubcircuit && lower.startsWith('.model')) {
      const model = normalizeModelCard(line);
      if (model) models.set(model.name, model);
      else {
        const [, name = '?', type = ''] = line.split(/[\s(]+/);
        skipped.push(`${name}: modello ${type.toUpperCase()} non ancora supportato`.replace('  ', ' '));
      }
    }
  }
  return { models: [...models.values()], skipped };
}
