import { D1N4148 } from '../library/models';
import { Circuit, Element } from '../model/types';

/** Commonly published 1N4148 parameters. */
export const D1N4148_PARAMS = { IS: 2.52e-9, RS: 0.568, N: 1.752 };
export { D1N4148 };

export interface RectifierOptions {
  /** Filter capacitor, e.g. "100u". Omitted: purely resistive load. */
  capacitor?: string;
  /** Swap the diode terminals by rotating it 180°. */
  reversed?: boolean;
}

/** 10 V peak, 50 Hz source -> D1 -> 1 kΩ load to ground. The output is the node shared with R1. */
export function halfWaveRectifier(opts: RectifierOptions = {}): Circuit {
  const elements: Element[] = [
    { id: 'v1', def: 'vsource', x: 0, y: 0, rot: 90, tag: 'V1', props: { shape: 'sin', amplitude: '10', offset: '0', frequency: '50', phase: '0', duty: '50', spec: '' } },
    { id: 'd1', def: 'diode', x: 120, y: -40, rot: opts.reversed ? 180 : 0, tag: 'D1', props: { model: 'D1N4148' } },
    { id: 'r1', def: 'resistor', x: 220, y: 0, rot: 90, tag: 'R1', props: { value: '1k' } },
    { id: 'gnd', def: 'ground', x: 120, y: 40, rot: 0, tag: '', props: {} },
  ];
  if (opts.capacitor) {
    elements.push({ id: 'c1', def: 'capacitor', x: 290, y: 0, rot: 90, tag: 'C1', props: { value: opts.capacitor } });
  }

  return {
    title: 'Raddrizzatore a semionda',
    elements,
    wires: [
      { id: 'w1', pts: [{ x: 0, y: -40 }, { x: 80, y: -40 }] },
      { id: 'w2', pts: [{ x: 160, y: -40 }, { x: 290, y: -40 }] },
      { id: 'w3', pts: [{ x: 0, y: 40 }, { x: 290, y: 40 }] },
    ],
    models: [D1N4148],
  };
}
