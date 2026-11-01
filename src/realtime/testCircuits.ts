import { Circuit, Element, Wire } from '../model/types';
import { D1N4148 } from '../samples/halfWaveRectifier';

export interface Part {
  def: 'resistor' | 'capacitor' | 'inductor' | 'vsource' | 'diode';
  tag: string;
  nets: [string, string];
  props: Record<string, string>;
}

const ROW_HEIGHT = 200;
const BUS_X = 1000;
const BUS_SPACING = 20;

/**
 * Lays out a net list as a real drawing: each part on its own row, each net on a vertical bus,
 * wires from terminals to buses. Net "0" is ground. It goes through the same geometry as the editor.
 */
export function circuitFromNets(title: string, parts: Part[]): Circuit {
  const nets = [...new Set(parts.flatMap((p) => p.nets))];
  const busX = new Map(nets.map((net, i) => [net, BUS_X + i * BUS_SPACING]));
  const elements: Element[] = [];
  const wires: Wire[] = [];

  parts.forEach((p, row) => {
    const y = row * ROW_HEIGHT;
    elements.push({ id: p.tag.toLowerCase(), def: p.def, x: 0, y, rot: 0, tag: p.tag, props: p.props });
    const addLead = (id: string, x: number, leadY: number, net: string) => {
      wires.push({
        id,
        pts: [
          { x, y },
          { x, y: leadY },
          { x: busX.get(net)!, y: leadY },
        ],
      });
    };
    addLead(`${p.tag}_a`, -40, y + 20, p.nets[0]);
    addLead(`${p.tag}_b`, 40, y - 20, p.nets[1]);
  });

  const top = -ROW_HEIGHT;
  const bottom = parts.length * ROW_HEIGHT;
  nets.forEach((net) => {
    const x = busX.get(net)!;
    wires.push({ id: `bus_${net}`, pts: [{ x, y: top }, { x, y: bottom }] });
  });
  elements.push({ id: 'gnd', def: 'ground', x: busX.get('0')!, y: bottom, rot: 0, tag: '', props: {} });

  return { title, elements, wires, models: [D1N4148] };
}

const SIN_50HZ = 'SIN(0 10 50)';
const diode = (tag: string, a: string, b: string): Part => ({ def: 'diode', tag, nets: [a, b], props: { model: 'D1N4148' } });
const part = (def: Part['def'], tag: string, a: string, b: string, value: string): Part => ({
  def,
  tag,
  nets: [a, b],
  props: def === 'vsource' ? { spec: value } : { value },
});

export interface TestCase {
  name: string;
  parts: Part[];
  /** Node to compare, by the net name used in parts. */
  probes: string[];
  stop: number;
  dt: number;
}

export const AGREEMENT_CASES: TestCase[] = [
  {
    name: 'partitore in continua',
    parts: [part('vsource', 'V1', 'in', '0', 'DC 12'), part('resistor', 'R1', 'in', 'out', '1k'), part('resistor', 'R2', 'out', '0', '2k')],
    probes: ['out'],
    stop: 1e-3,
    dt: 1e-5,
  },
  {
    name: 'RC con onda quadra',
    parts: [part('vsource', 'V1', 'in', '0', 'PULSE(0 5 0 1u 1u 5m 10m)'), part('resistor', 'R1', 'in', 'out', '1k'), part('capacitor', 'C1', 'out', '0', '1u')],
    probes: ['out'],
    stop: 30e-3,
    dt: 5e-6,
  },
  {
    name: 'RL con onda quadra',
    parts: [part('vsource', 'V1', 'in', '0', 'PULSE(0 5 0 1u 1u 5m 10m)'), part('resistor', 'R1', 'in', 'out', '100'), part('inductor', 'L1', 'out', '0', '100m')],
    probes: ['out'],
    stop: 30e-3,
    dt: 5e-6,
  },
  {
    name: 'RLC serie sinusoidale',
    parts: [
      part('vsource', 'V1', 'in', '0', 'SIN(0 5 1k)'),
      part('resistor', 'R1', 'in', 'a', '20'),
      part('inductor', 'L1', 'a', 'out', '10m'),
      part('capacitor', 'C1', 'out', '0', '1u'),
    ],
    probes: ['out'],
    stop: 10e-3,
    dt: 2e-6,
  },
  {
    name: 'raddrizzatore a semionda',
    parts: [part('vsource', 'V1', 'in', '0', SIN_50HZ), diode('D1', 'in', 'out'), part('resistor', 'R1', 'out', '0', '1k')],
    probes: ['out'],
    stop: 60e-3,
    dt: 10e-6,
  },
  {
    name: 'raddrizzatore a semionda con filtro',
    parts: [part('vsource', 'V1', 'in', '0', SIN_50HZ), diode('D1', 'in', 'out'), part('resistor', 'R1', 'out', '0', '1k'), part('capacitor', 'C1', 'out', '0', '100u')],
    probes: ['out'],
    stop: 100e-3,
    dt: 10e-6,
  },
  {
    name: 'ponte di Graetz',
    parts: [
      part('vsource', 'V1', 'p', 'q', SIN_50HZ),
      diode('D1', 'p', 'out'),
      diode('D2', 'q', 'out'),
      diode('D3', '0', 'p'),
      diode('D4', '0', 'q'),
      part('resistor', 'R1', 'out', '0', '1k'),
    ],
    probes: ['out', 'p'],
    stop: 60e-3,
    dt: 10e-6,
  },
  {
    name: 'sinusoide con offset e fase',
    parts: [
      { def: 'vsource', tag: 'V1', nets: ['in', '0'], props: { shape: 'sin', amplitude: '5', offset: '2', frequency: '1k', phase: '30' } },
      part('resistor', 'R1', 'in', 'out', '1k'),
      part('capacitor', 'C1', 'out', '0', '100n'),
    ],
    probes: ['in', 'out'],
    stop: 5e-3,
    dt: 2e-6,
  },
  {
    name: 'onda quadra dai campi del generatore',
    parts: [
      { def: 'vsource', tag: 'V1', nets: ['in', '0'], props: { shape: 'square', amplitude: '5', offset: '1', frequency: '100' } },
      part('resistor', 'R1', 'in', 'out', '1k'),
      part('capacitor', 'C1', 'out', '0', '1u'),
    ],
    probes: ['out'],
    stop: 30e-3,
    dt: 5e-6,
  },
  {
    name: 'limitatore a diodi in antiparallelo',
    parts: [part('vsource', 'V1', 'in', '0', SIN_50HZ), part('resistor', 'R1', 'in', 'out', '1k'), diode('D1', 'out', '0'), diode('D2', '0', 'out')],
    probes: ['out'],
    stop: 60e-3,
    dt: 10e-6,
  },
];
