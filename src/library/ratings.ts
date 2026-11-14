import { formatEngineering } from '../ui/chartMath';
import { ZENER_SHEETS } from './standardModels';

/**
 * The ratings of the parts of the library, from the datasheets of their makers at 25 °C: what one looks up
 * before choosing a part, shown beside its model. Typical values where the datasheet gives them, else the
 * limits. A PNP or P channel part has its voltages and currents negative: here they are written as sizes.
 */

interface DiodeRating {
  kind: 'diode';
  maker: string;
  /** Repetitive peak reverse voltage. */
  vrrm: number;
  /** Average forward current, and the power where the datasheet gives it. */
  ifav: number;
  pd?: number;
  /** Maximum forward voltage at a forward current. */
  vf: [volts: number, amps: number];
}

interface ZenerRating {
  kind: 'zener';
  maker: string;
  vz: number;
  izt: number;
  zzt: number;
  pd: number;
  vf: [volts: number, amps: number];
}

interface BjtRating {
  kind: 'bjt';
  maker: string;
  vceo: number;
  vcbo: number;
  vebo: number;
  ic: number;
  /** In free air; on a heat sink with the case at 25 °C, for a power part. */
  pd: number;
  pdCase?: number;
  /** Gain: least and most, or the least alone, with the typical where given, at a current and voltage. */
  hfe: { min: number; typ?: number; max?: number; ic: number; vce: number };
}

interface MosRating {
  kind: 'mos';
  maker: string;
  vds: number;
  vgs: number;
  id: number;
  pd: number;
  /** Threshold: least and most at 250 µA (1 mA for the small ones). */
  vth: [min: number, max: number];
  /** Most on resistance at a gate voltage. */
  rdson: [ohms: number, vgs: number];
}

export type Rating = DiodeRating | ZenerRating | BjtRating | MosRating;

const zeners: [string, Rating][] = ZENER_SHEETS.map((z) => [z.name, { kind: 'zener', maker: 'Vishay', vz: z.vz, izt: z.izt, zzt: z.zzt, pd: 1, vf: [1.2, 0.2] }]);

export const RATINGS = new Map<string, Rating>([
  ['D1N4148', { kind: 'diode', maker: 'onsemi', vrrm: 100, ifav: 0.2, pd: 0.5, vf: [1, 0.01] }],
  ['1N4007', { kind: 'diode', maker: 'Vishay', vrrm: 1000, ifav: 1, vf: [1.1, 1] }],
  ['1N5408', { kind: 'diode', maker: 'Vishay', vrrm: 1000, ifav: 3, vf: [1.2, 3] }],
  ['1N5819', { kind: 'diode', maker: 'onsemi', vrrm: 40, ifav: 1, vf: [0.6, 1] }],
  ...zeners,
  ['2N3904', { kind: 'bjt', maker: 'onsemi', vceo: 40, vcbo: 60, vebo: 6, ic: 0.2, pd: 0.625, hfe: { min: 100, max: 300, ic: 0.01, vce: 1 } }],
  ['2N3906', { kind: 'bjt', maker: 'onsemi', vceo: 40, vcbo: 40, vebo: 5, ic: 0.2, pd: 0.625, hfe: { min: 100, max: 300, ic: 0.01, vce: 1 } }],
  ['BC547B', { kind: 'bjt', maker: 'onsemi', vceo: 45, vcbo: 50, vebo: 6, ic: 0.1, pd: 0.625, hfe: { min: 200, typ: 290, max: 450, ic: 0.002, vce: 5 } }],
  ['BC557B', { kind: 'bjt', maker: 'onsemi', vceo: 45, vcbo: 50, vebo: 5, ic: 0.1, pd: 0.625, hfe: { min: 220, typ: 290, max: 475, ic: 0.002, vce: 5 } }],
  ['2N2222A', { kind: 'bjt', maker: 'onsemi', vceo: 40, vcbo: 75, vebo: 6, ic: 0.6, pd: 0.625, hfe: { min: 100, max: 300, ic: 0.15, vce: 10 } }],
  ['2N2907A', { kind: 'bjt', maker: 'onsemi', vceo: 60, vcbo: 60, vebo: 5, ic: 0.6, pd: 0.625, hfe: { min: 100, max: 300, ic: 0.15, vce: 10 } }],
  ['BD139', { kind: 'bjt', maker: 'STMicroelectronics', vceo: 80, vcbo: 80, vebo: 5, ic: 1.5, pd: 1.25, pdCase: 12.5, hfe: { min: 40, max: 250, ic: 0.15, vce: 2 } }],
  ['BD140', { kind: 'bjt', maker: 'STMicroelectronics', vceo: 80, vcbo: 80, vebo: 5, ic: 1.5, pd: 1.25, pdCase: 12.5, hfe: { min: 40, max: 250, ic: 0.15, vce: 2 } }],
  ['TIP31C', { kind: 'bjt', maker: 'onsemi', vceo: 100, vcbo: 100, vebo: 5, ic: 3, pd: 2, pdCase: 40, hfe: { min: 10, max: 50, ic: 3, vce: 4 } }],
  ['TIP32C', { kind: 'bjt', maker: 'onsemi', vceo: 100, vcbo: 100, vebo: 5, ic: 3, pd: 2, pdCase: 40, hfe: { min: 10, max: 50, ic: 3, vce: 4 } }],
  ['tip120', { kind: 'bjt', maker: 'onsemi', vceo: 60, vcbo: 60, vebo: 5, ic: 5, pd: 2, pdCase: 65, hfe: { min: 1000, ic: 3, vce: 3 } }],
  ['2N7000', { kind: 'mos', maker: 'onsemi', vds: 60, vgs: 20, id: 0.2, pd: 0.4, vth: [0.8, 3], rdson: [5, 10] }],
  ['BS170', { kind: 'mos', maker: 'onsemi', vds: 60, vgs: 20, id: 0.5, pd: 0.83, vth: [0.8, 3], rdson: [5, 10] }],
  ['IRF540N', { kind: 'mos', maker: 'Infineon', vds: 100, vgs: 20, id: 33, pd: 130, vth: [2, 4], rdson: [0.044, 10] }],
  ['IRF9540N', { kind: 'mos', maker: 'Infineon', vds: 100, vgs: 20, id: 23, pd: 140, vth: [2, 4], rdson: [0.117, 10] }],
  ['IRLZ44N', { kind: 'mos', maker: 'Infineon', vds: 55, vgs: 16, id: 47, pd: 110, vth: [1, 2], rdson: [0.025, 5] }],
  ['IRL520', { kind: 'mos', maker: 'Vishay', vds: 100, vgs: 10, id: 9.2, pd: 60, vth: [1, 2], rdson: [0.27, 5] }],
]);

const v = (x: number) => formatEngineering(x, 'V');
const a = (x: number) => formatEngineering(x, 'A');
const w = (x: number) => formatEngineering(x, 'W');
const ohm = (x: number) => formatEngineering(x, 'Ω');

/** The saturation current of a diode model, as its card has it. */
export function saturationCurrent(card: string): number | null {
  const match = /\bIS\s*=\s*([0-9.eE+-]+)([a-zA-Z]*)/i.exec(card);
  if (!match) return null;
  const scale: Record<string, number> = { f: 1e-15, p: 1e-12, n: 1e-9, u: 1e-6, m: 1e-3 };
  const value = Number(match[1]) * (scale[match[2].toLowerCase().charAt(0)] ?? 1);
  return Number.isFinite(value) ? value : null;
}

/** The ratings as lines of a table, with the maker; null for a part with none, as a generic or imported one. */
export function ratingRows(name: string, card?: string): { maker: string; isTransistor: boolean; rows: [string, string][] } | null {
  const found = ratingTable(name, card);
  return found && { ...found, isTransistor: RATINGS.get(name)!.kind === 'bjt' || RATINGS.get(name)!.kind === 'mos' };
}

function ratingTable(name: string, card?: string): { maker: string; rows: [string, string][] } | null {
  const r = RATINGS.get(name);
  if (!r) return null;
  const is = card ? saturationCurrent(card) : null;
  const isRow: [string, string][] = is !== null ? [['IS (del modello)', a(is)]] : [];
  switch (r.kind) {
    case 'diode':
      return {
        maker: r.maker,
        rows: [['VRRM, inversa massima', v(r.vrrm)], ['IF media massima', a(r.ifav)], ...(r.pd ? [['Potenza massima', w(r.pd)] as [string, string]] : []), ['VF in conduzione, massima', `${v(r.vf[0])} a ${a(r.vf[1])}`], ...isRow],
      };
    case 'zener':
      return {
        maker: r.maker,
        rows: [['Vz', `${v(r.vz)} a ${a(r.izt)}`], ['Impedenza Zzt', ohm(r.zzt)], ['Potenza massima', w(r.pd)], ['Iz massima, circa', a(r.pd / r.vz)], ['VF diretta, massima', `${v(r.vf[0])} a ${a(r.vf[1])}`], ...isRow],
      };
    case 'bjt': {
      const gain = r.hfe.max ? `${r.hfe.min}–${r.hfe.max}` : `almeno ${r.hfe.min}`;
      return {
        maker: r.maker,
        rows: [
          ['hFE', `${gain}${r.hfe.typ ? `, tipico ${r.hfe.typ}` : ''} a ${a(r.hfe.ic)}, ${v(r.hfe.vce)}`],
          ['VCEO, massima', v(r.vceo)],
          ['VCBO, massima', v(r.vcbo)],
          ['VEBO, inversa base-emettitore', v(r.vebo)],
          ['IC massima', a(r.ic)],
          ...(r.pdCase ? ([['Potenza in aria', w(r.pd)], ['Potenza con dissipatore', w(r.pdCase)]] as [string, string][]) : ([['Potenza massima', w(r.pd)]] as [string, string][])),
        ],
      };
    }
    case 'mos':
      return {
        maker: r.maker,
        rows: [
          ['VDS, massima', v(r.vds)],
          ['VGS, massima', `±${v(r.vgs)}`],
          ['Soglia VGS(th)', `${v(r.vth[0])}–${v(r.vth[1])}`],
          ['RDS(on), massima', `${ohm(r.rdson[0])} a VGS ${v(r.rdson[1])}`],
          ['ID massima', a(r.id)],
          ['Potenza massima', r.pd >= 10 ? `${w(r.pd)} con dissipatore` : w(r.pd)],
        ],
      };
  }
}
