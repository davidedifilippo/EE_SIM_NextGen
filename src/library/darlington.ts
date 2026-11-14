import { BlockDef, Element, Wire } from '../model/types';
import { bjtCard, DARLINGTON_DIODE, DARLINGTON_SHEETS, diodeCard } from './standardModels';

/**
 * The TIP120 as its datasheet draws it inside: Q1 drives the base of Q2, both collectors together; R1 of about
 * 8 kΩ across the base and emitter of Q1, R2 of about 120 Ω across those of Q2, and a diode from the emitter to
 * the collector. Both engines open it into these parts, as they do a block.
 */

const part = (id: string, def: string, x: number, y: number, rot: Element['rot'], tag: string, props: Element['props'] = {}): Element => ({ id, def, x, y, rot, tag, props });
const wire = (id: string, ...pts: [number, number][]): Wire => ({ id, pts: pts.map(([x, y]) => ({ x, y })) });

export const TIP120_ID = 'tip120';

export const TIP120_BLOCK: BlockDef = {
  id: TIP120_ID,
  name: 'Darlington TIP120',
  circuit: {
    title: 'Darlington TIP120',
    elements: [
      part('pin_b', 'port_in', -160, 0, 0, 'B'),
      part('pin_c', 'port_out', 200, -80, 0, 'C'),
      part('pin_e', 'port_out', 200, 180, 0, 'E'),
      part('q1', 'npn', -60, 0, 0, 'Q1', { model: 'TIP120_Q1' }),
      part('q2', 'npn', 60, 60, 0, 'Q2', { model: 'TIP120_Q2' }),
      part('r1', 'resistor', -60, 100, 0, 'R1', { value: '8k' }),
      part('r2', 'resistor', 0, 140, 90, 'R2', { value: '120' }),
      part('d1', 'diode', 140, 50, 270, 'D1', { model: 'TIP120_D' }),
    ],
    wires: [
      wire('wb', [-160, 0], [-130, 0], [-100, 0]),
      wire('wr1', [-130, 0], [-130, 100], [-100, 100]),
      wire('wc', [-40, -40], [-40, -80], [80, -80], [140, -80], [200, -80]),
      wire('wc2', [80, 20], [80, -80]),
      wire('wb2', [-40, 40], [-40, 60], [-20, 60], [0, 60], [20, 60]),
      wire('wr1b', [-20, 100], [-20, 60]),
      wire('wr2', [0, 100], [0, 60]),
      wire('we', [0, 180], [80, 180], [140, 180], [200, 180]),
      wire('we2', [80, 100], [80, 180]),
      wire('wda', [140, 90], [140, 180]),
      wire('wdk', [140, 10], [140, -80]),
    ],
    models: [...DARLINGTON_SHEETS.map((b) => ({ name: b.name, card: bjtCard(b) })), { name: DARLINGTON_DIODE.name, card: diodeCard(DARLINGTON_DIODE) }],
  },
};

/** The parts of the library made of other parts, by the id of the part. */
export const BUILT_IN_BLOCKS = new Map<string, BlockDef>([[TIP120_ID, TIP120_BLOCK]]);
