import { Pt } from '../model/types';

/**
 * A breadboard of 830 points, in its units: 10 is one pitch of 2.54 mm. Column 1 of row a is at the origin.
 * 63 columns; rows a to e above the groove, f to j below; two rails above and two below, a + and a − each,
 * with their holes in groups of five.
 */
export const PITCH = 10;
export const COLUMNS = 63;
const UPPER_ROWS = ['a', 'b', 'c', 'd', 'e'];
const LOWER_ROWS = ['f', 'g', 'h', 'i', 'j'];
/** e and f are three pitches apart, across the groove: a chip sits astride it. */
const LOWER_TOP = 7 * PITCH;
const RAIL_Y = { topMinus: -4 * PITCH, topPlus: -3 * PITCH, bottomPlus: LOWER_TOP + 7 * PITCH, bottomMinus: LOWER_TOP + 8 * PITCH } as const;
export type Rail = keyof typeof RAIL_Y;

export interface Hole {
  at: Pt;
  /** The strip or rail it belongs to: holes with the same one are joined under the plastic. */
  strip: string;
  /** As printed on the board, e.g. "a12" or "+". */
  label: string;
}

/** The rail holes: in groups of five, one pitch left out between groups, from the second column. */
const railColumns = Array.from({ length: COLUMNS }, (_, k) => k).filter((k) => k >= 1 && k <= COLUMNS - 4 && (k - 1) % 6 !== 5);

function makeHoles(): Hole[] {
  const holes: Hole[] = [];
  for (let col = 0; col < COLUMNS; col++) {
    UPPER_ROWS.forEach((row, r) => holes.push({ at: { x: col * PITCH, y: r * PITCH }, strip: `top:${col}`, label: `${row}${col + 1}` }));
    LOWER_ROWS.forEach((row, r) => holes.push({ at: { x: col * PITCH, y: LOWER_TOP + r * PITCH }, strip: `bottom:${col}`, label: `${row}${col + 1}` }));
  }
  for (const [rail, y] of Object.entries(RAIL_Y)) {
    for (const col of railColumns) holes.push({ at: { x: col * PITCH, y }, strip: `rail:${rail}`, label: rail.endsWith('Plus') ? '+' : '−' });
  }
  return holes;
}

export const HOLES: Hole[] = makeHoles();

const key = (p: Pt) => `${Math.round(p.x)},${Math.round(p.y)}`;
const byPoint = new Map(HOLES.map((h) => [key(h.at), h]));

/** The hole at a point, or null if the point is not on one. */
export const holeAt = (p: Pt): Hole | null => byPoint.get(key(p)) ?? null;

/** The nearest point of the grid. */
export const snapToPitch = (p: Pt): Pt => ({ x: Math.round(p.x / PITCH) * PITCH, y: Math.round(p.y / PITCH) * PITCH });

/** The outline of the board, around the holes. */
export const BOARD_BOX = { x: -2 * PITCH, y: RAIL_Y.topMinus - 2 * PITCH, w: (COLUMNS + 3) * PITCH, h: RAIL_Y.bottomMinus - RAIL_Y.topMinus + 4 * PITCH };
export const RAILS = RAIL_Y;
export const GROOVE_Y = 4 * PITCH + (LOWER_TOP - 4 * PITCH) / 2;
export const ROW_LABELS = [...UPPER_ROWS.map((row, r) => ({ row, y: r * PITCH })), ...LOWER_ROWS.map((row, r) => ({ row, y: LOWER_TOP + r * PITCH }))];
export const pointKey = key;
