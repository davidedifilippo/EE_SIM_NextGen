import { getDevice } from '../library/devices';
import { Circuit, Element, Pt, Rotation, Wire } from '../model/types';
import { halfWaveRectifier } from './halfWaveRectifier';

export interface Example {
  id: string;
  title: string;
  /** What to look at, for whoever opens it in a lesson. */
  hint: string;
  build: () => Circuit;
}

/** A part with the defaults of the library, and only the values the example sets. */
const part = (id: string, def: string, x: number, y: number, rot: Rotation, tag: string, props: Record<string, string> = {}): Element => ({
  id,
  def,
  x,
  y,
  rot,
  tag,
  props: { ...Object.fromEntries(getDevice(def)!.props.map((p) => [p.key, p.default])), ...props },
});

const wire = (id: string, ...pts: [number, number][]): Wire => ({ id, pts: pts.map(([x, y]): Pt => ({ x, y })) });

const ground = (x: number, y: number, id = 'gnd') => part(id, 'ground', x, y, 0, '');

const sine = (amplitude: string, frequency: string) => ({ shape: 'sin', amplitude, offset: '0', frequency });

const divider = (): Circuit => ({
  title: 'Partitore di tensione',
  elements: [
    part('v1', 'dcsupply', 0, 0, 90, 'V1', { amplitude: '12' }),
    part('r1', 'resistor', 120, -60, 90, 'R1', { value: '10k' }),
    part('r2', 'resistor', 120, 60, 90, 'R2', { value: '4.7k' }),
    part('mm1', 'multimetercompact', 220, 60, 90, 'MM1', { mode: 'vdc' }),
    ground(60, 100),
  ],
  wires: [
    wire('w1', [0, -40], [0, -100], [120, -100]),
    wire('w2', [120, -20], [120, 20]),
    wire('w3', [120, 20], [220, 20]),
    wire('w4', [0, 40], [0, 100], [220, 100]),
  ],
  models: [],
});

const lowPass = (): Circuit => ({
  title: 'Filtro RC passa-basso',
  elements: [
    part('v1', 'vsource', 0, 0, 90, 'V1', sine('1', '1k')),
    part('r1', 'resistor', 80, -40, 0, 'R1', { value: '1k' }),
    part('c1', 'capacitor', 160, 0, 90, 'C1', { value: '100n' }),
    ground(80, 40),
  ],
  wires: [wire('w1', [0, -40], [40, -40]), wire('w2', [120, -40], [160, -40]), wire('w3', [0, 40], [160, 40])],
  models: [],
});

const zener = (): Circuit => ({
  title: 'Stabilizzatore con zener',
  elements: [
    part('v1', 'dcsupply', 0, 0, 90, 'V1', { amplitude: '12' }),
    part('r1', 'resistor', 80, -40, 0, 'R1', { value: '470' }),
    part('d1', 'zener', 160, 0, 270, 'D1'),
    part('rl', 'resistor', 240, 0, 90, 'RL', { value: '1k' }),
    ground(120, 40),
  ],
  wires: [wire('w1', [0, -40], [40, -40]), wire('w2', [120, -40], [240, -40]), wire('w3', [0, 40], [240, 40])],
  models: [],
});

const inverting = (): Circuit => ({
  title: 'Amplificatore invertente',
  elements: [
    part('v1', 'vsource', 0, 50, 90, 'V1', sine('0.5', '1k')),
    part('r1', 'resistor', 80, 0, 0, 'R1', { value: '10k' }),
    part('rf', 'resistor', 200, -80, 0, 'RF', { value: '100k' }),
    part('u1', 'opamp', 200, 10, 0, 'U1'),
    part('rl', 'resistor', 300, 50, 90, 'RL', { value: '10k' }),
    ground(100, 90),
  ],
  wires: [
    wire('w1', [0, 10], [0, 0], [40, 0]),
    wire('w2', [120, 0], [160, 0]),
    wire('w3', [140, 0], [140, -80], [160, -80]),
    wire('w4', [240, -80], [240, 10]),
    wire('w5', [240, 10], [300, 10]),
    wire('w6', [160, 20], [160, 90]),
    wire('w7', [0, 90], [300, 90]),
  ],
  models: [],
});

const transistorSwitch = (): Circuit => ({
  title: 'Transistor come interruttore',
  elements: [
    part('v1', 'dcsupply', 0, 0, 90, 'V1', { amplitude: '12' }),
    part('v2', 'vsource', 80, 80, 90, 'V2', { shape: 'square', amplitude: '2.5', offset: '2.5', frequency: '1' }),
    part('rb', 'resistor', 160, 40, 0, 'RB', { value: '10k' }),
    part('rc', 'resistor', 260, -60, 90, 'RC', { value: '1k' }),
    part('q1', 'npn', 240, 40, 0, 'Q1'),
    ground(160, 120),
  ],
  wires: [
    wire('w1', [0, -40], [0, -100], [260, -100]),
    wire('w2', [260, -20], [260, 0]),
    wire('w3', [80, 40], [120, 40]),
    wire('w4', [0, 40], [0, 120], [260, 120]),
    wire('w5', [260, 80], [260, 120]),
  ],
  models: [],
});

const gates = (): Circuit => ({
  title: 'Porte logiche e LED',
  elements: [
    part('in1', 'logicinput', 0, -40, 0, 'IN1', { state: '1' }),
    part('in2', 'logicinput', 0, 40, 0, 'IN2'),
    part('u1', 'gate_and', 120, -40, 0, 'U1'),
    part('u2', 'gate_xor', 120, 80, 0, 'U2'),
    part('r1', 'resistor', 200, -40, 0, 'R1', { value: '220' }),
    part('r2', 'resistor', 200, 80, 0, 'R2', { value: '220' }),
    part('d1', 'led', 280, 0, 90, 'D1', { model: 'LED_ROSSO' }),
    part('d2', 'led', 280, 120, 90, 'D2', { model: 'LED_VERDE' }),
    ground(280, 160),
  ],
  wires: [
    wire('w1', [40, -40], [60, -40], [60, -50], [80, -50]),
    wire('w2', [60, -40], [60, 70], [80, 70]),
    wire('w3', [40, 40], [50, 40], [50, -30], [80, -30]),
    wire('w4', [50, 40], [50, 90], [80, 90]),
    wire('w5', [240, -40], [280, -40]),
    wire('w6', [240, 80], [280, 80]),
    wire('w7', [280, 40], [300, 40], [300, 160], [280, 160]),
  ],
  models: [],
});

const switches = (): Circuit => ({
  title: 'Pulsante, interruttore e porta logica',
  elements: [
    part('v1', 'dcsupply', -120, 40, 90, 'V1', { amplitude: '5' }),
    part('s1', 'switch', 0, 0, 0, 'S1'),
    part('s2', 'pushno', 0, 160, 0, 'S2'),
    part('r1', 'resistor', 60, 40, 90, 'R1', { value: '10k' }),
    part('r2', 'resistor', 80, 200, 90, 'R2', { value: '10k' }),
    part('u1', 'gate_and', 160, 50, 0, 'U1'),
    part('r3', 'resistor', 240, 50, 0, 'R3', { value: '220' }),
    part('d1', 'led', 300, 90, 90, 'D1', { model: 'LED_VERDE' }),
    // A ground under each part that needs one, as in a schematic drawn by hand
    ground(-120, 120),
    ground(60, 100, 'gnd2'),
    ground(80, 260, 'gnd3'),
    ground(300, 150, 'gnd4'),
  ],
  wires: [
    wire('w1', [-120, 0], [-40, 0]),
    wire('w2', [-60, 0], [-60, 160], [-40, 160]),
    wire('w3', [40, 0], [60, 0]),
    wire('w4', [60, 0], [100, 0], [100, 40], [120, 40]),
    wire('w5', [40, 160], [80, 160]),
    wire('w6', [80, 160], [100, 160], [100, 60], [120, 60]),
    wire('w7', [280, 50], [300, 50]),
    wire('w8', [-120, 80], [-120, 120]),
    wire('w9', [60, 80], [60, 100]),
    wire('w10', [80, 240], [80, 260]),
    wire('w11', [300, 130], [300, 150]),
  ],
  models: [],
});

const sevenSegment = (): Circuit => {
  // The digit 5 at the start: D C B A = 0 1 0 1
  const bits = { D: '0', C: '1', B: '0', A: '1' };
  const names = ['D', 'C', 'B', 'A'] as const;
  // The inputs further apart than the pins of the driver, so that their boxes and names do not touch
  const inputY = (k: number) => -105 + 50 * k;
  const pinY = (k: number) => -30 + 20 * k;
  const segments = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const segmentY = (k: number) => -60 + 20 * k;
  // Resistors on two columns, so that each name and value has room
  const resistorX = (k: number) => (k % 2 === 0 ? 100 : 180);
  return {
    title: 'Driver BCD e display a 7 segmenti',
    elements: [
      ...names.map((name, k) => part(`in${name}`, 'logicinput', -160, inputY(k), 0, `IN${name}`, { state: bits[name] })),
      part('u1', 'bcd7seg', 0, 0, 0, 'U1'),
      ...segments.map((name, k) => part(`r${name}`, 'resistor', resistorX(k), segmentY(k), 0, `R${k + 1}`, { value: '220' })),
      part('ds1', 'display7', 320, 0, 0, 'DS1', { color: 'rosso' }),
      ground(380, 40),
    ],
    wires: [
      // Each wire turns at its own x: on a shared one the vertical runs would lie on top of each other
      ...names.map((name, k) => wire(`win${name}`, [-120, inputY(k)], [-100 + 15 * k, inputY(k)], [-100 + 15 * k, pinY(k)], [-40, pinY(k)])),
      ...segments.flatMap((name, k) => [
        wire(`wo${name}`, [40, segmentY(k)], [resistorX(k) - 40, segmentY(k)]),
        wire(`ws${name}`, [resistorX(k) + 40, segmentY(k)], [280, segmentY(k)]),
      ]),
      wire('wk', [360, 0], [380, 0], [380, 40]),
    ],
    models: [],
  };
};

const counterDisplay = (): Circuit => {
  const pinY = (k: number) => -30 + 20 * k;
  const segments = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const segmentY = (k: number) => -60 + 20 * k;
  const resistorX = (k: number) => (k % 2 === 0 ? 100 : 180);
  return {
    title: 'Contatore decimale e display',
    elements: [
      part('ck1', 'clock', -300, -10, 0, 'CK1', { frequency: '1' }),
      part('u2', 'counter4', -160, 0, 0, 'U2', { modulus: '10' }),
      part('u1', 'bcd7seg', 0, 0, 0, 'U1'),
      ...segments.map((name, k) => part(`r${name}`, 'resistor', resistorX(k), segmentY(k), 0, `R${k + 1}`, { value: '220' })),
      part('ds1', 'display7', 320, 0, 0, 'DS1', { color: 'rosso' }),
      part('inr', 'logicinput', -260, 40, 0, 'IN1', { state: '0' }),
      ground(380, 40),
    ],
    wires: [
      wire('wclk', [-260, -10], [-200, -10]),
      wire('wrst', [-220, 40], [-210, 40], [-210, 10], [-200, 10]),
      ...[0, 1, 2, 3].map((k) => wire(`wq${k}`, [-120, pinY(k)], [-40, pinY(k)])),
      ...segments.flatMap((name, k) => [
        wire(`wo${name}`, [40, segmentY(k)], [resistorX(k) - 40, segmentY(k)]),
        wire(`ws${name}`, [resistorX(k) + 40, segmentY(k)], [280, segmentY(k)]),
      ]),
      wire('wk', [360, 0], [380, 0], [380, 40]),
    ],
    models: [],
  };
};

const dualSupply = (): Circuit => ({
  title: 'Alimentatore duale con presa centrale',
  elements: [
    part('v1', 'vsource', -280, 0, 90, 'V1', sine('325', '50')),
    part('t1', 'cttransformer', -100, 0, 0, 'T1'),
    // Turned so that the alternating inputs face left and right, the positive up, the negative down
    part('d1', 'bridge', 40, 0, 270, 'D1'),
    part('c1', 'capacitor', 160, -20, 90, 'C1', { value: '2200u' }),
    part('rl1', 'resistor', 240, -20, 90, 'RL1', { value: '100' }),
    part('c2', 'capacitor', 160, 100, 90, 'C2', { value: '2200u' }),
    part('rl2', 'resistor', 240, 100, 90, 'RL2', { value: '100' }),
    ground(-280, 80),
    ground(-40, 0, 'gnd2'),
    // Beside the point between the two capacitors and between the two loads, as drawn by hand
    ground(200, 40, 'gnd3'),
    ground(280, 40, 'gnd4'),
  ],
  wires: [
    wire('w1', [-280, -40], [-140, -40]),
    wire('w2', [-280, 40], [-140, 40]),
    wire('w3', [-280, 40], [-280, 80]),
    wire('w4', [-60, -40], [-20, -40], [-20, 0], [0, 0]),
    wire('w5', [-60, 0], [-40, 0]),
    wire('w6', [-60, 40], [-40, 40], [-40, 100], [100, 100], [100, 0], [80, 0]),
    wire('w7', [40, -40], [40, -60], [240, -60]),
    wire('w8', [160, 20], [160, 60]),
    wire('w9', [240, 20], [240, 60]),
    wire('w11', [160, 40], [200, 40]),
    wire('w12', [240, 40], [280, 40]),
    wire('w10', [40, 40], [40, 140], [240, 140]),
  ],
  models: [],
});

const regulator = (): Circuit => ({
  title: 'Regolatore 7805',
  elements: [
    part('v1', 'dcsupply', 0, 0, 90, 'V1', { amplitude: '12' }),
    part('u1', 'reg7805', 120, -40, 0, 'U1'),
    part('rl', 'resistor', 240, 0, 90, 'RL', { value: '100' }),
    ground(60, 40),
  ],
  wires: [wire('w1', [0, -40], [80, -40]), wire('w2', [160, -40], [240, -40]), wire('w3', [120, 0], [120, 40]), wire('w4', [0, 40], [240, 40])],
  models: [],
});

const sensors = (): Circuit => ({
  title: 'Sensori di temperatura LM35 e TMP36',
  elements: [
    part('v1', 'dcsupply', 0, 0, 90, 'V1', { amplitude: '5' }),
    part('u1', 'lm35', 120, -60, 0, 'U1', { temp: '25' }),
    part('u2', 'tmp36', 320, -60, 0, 'U2', { temp: '25' }),
    part('mm1', 'multimetercompact', 200, 0, 90, 'MM1', { mode: 'vdc' }),
    part('mm2', 'multimetercompact', 400, 0, 90, 'MM2', { mode: 'vdc' }),
    ground(60, 80),
  ],
  wires: [
    wire('w1', [0, -40], [0, -60], [80, -60]),
    wire('w2', [40, -60], [40, -100], [260, -100], [260, -60], [280, -60]),
    wire('w3', [160, -60], [200, -60], [200, -40]),
    wire('w4', [360, -60], [400, -60], [400, -40]),
    wire('w5', [0, 40], [0, 80], [400, 80], [400, 40]),
    wire('w6', [120, -20], [120, 80]),
    wire('w7', [320, -20], [320, 80]),
    wire('w8', [200, 40], [200, 80]),
  ],
  models: [],
});

const gearMotor = (): Circuit => ({
  title: 'Motoriduttore IG22',
  elements: [
    part('v1', 'dcsupply', 0, 40, 90, 'V1', { amplitude: '12' }),
    part('s1', 'switch', 80, 0, 0, 'S1'),
    part('mm1', 'multimetercompact', 200, 0, 0, 'MM1', { mode: 'adc' }),
    part('m1', 'motor_ig22', 320, 40, 90, 'M1', { load: '0' }),
    // The freewheeling diode: at turn-off it carries the current of the winding, which would otherwise spark
    part('d1', 'diode', 420, 40, 270, 'D1', { model: 'DIODO_1A' }),
    ground(160, 80),
  ],
  wires: [
    wire('w1', [0, 0], [40, 0]),
    wire('w2', [120, 0], [160, 0]),
    wire('w3', [240, 0], [320, 0]),
    wire('w4', [320, 0], [420, 0]),
    wire('w5', [0, 80], [320, 80]),
    wire('w6', [320, 80], [420, 80]),
  ],
  models: [],
});

/** A 5 V relay, switched by hand, that turns on a 12 V gear motor: two circuits joined only by the ground. */
const relayMotor = (): Circuit => ({
  title: 'Relè che comanda un motore',
  elements: [
    part('v1', 'dcsupply', 0, 40, 90, 'V1', { amplitude: '5' }),
    part('s1', 'switch', 80, 0, 0, 'S1'),
    // Across the coil: at turn-off it carries the current of the coil, which would otherwise spark
    part('d1', 'diode', 200, 40, 270, 'D1', { model: 'DIODO_1A' }),
    part('k1', 'relay5', 320, 40, 0, 'K1'),
    part('m1', 'motor_ig22', 440, -80, 180, 'M1', { load: '0' }),
    part('d2', 'diode', 440, -160, 0, 'D2', { model: 'DIODO_1A' }),
    part('v2', 'dcsupply', 560, 20, 90, 'V2', { amplitude: '12' }),
    ground(120, 80),
  ],
  wires: [
    wire('w1', [0, 0], [40, 0]),
    wire('w2', [120, 0], [200, 0]),
    wire('w3', [200, 0], [300, 0]),
    wire('w4', [0, 80], [120, 80]),
    wire('w5', [120, 80], [200, 80]),
    wire('w6', [200, 80], [300, 80]),
    wire('w7', [300, 80], [340, 80]),
    wire('w8', [340, 0], [340, -80], [400, -80]),
    wire('w9', [480, -80], [560, -80], [560, -20]),
    wire('w10', [560, 60], [560, 80], [340, 80]),
    wire('w11', [400, -80], [400, -160]),
    wire('w12', [480, -80], [480, -160]),
  ],
  models: [],
});

/** The ground of the board, below its GND pin: every Arduino example needs it. */
const boardGround = (): [Element, Wire] => [ground(-80, 70, 'gnd'), wire('wg', [-50, 70], [-80, 70])];

/** An LED behind 220 ohms from a pin on the right of the board, at height y, to its own ground. */
const pinLed = (y: number, color: string): { elements: Element[]; wires: Wire[] } => ({
  elements: [part('r1', 'resistor', 140, y, 0, 'R1', { value: '220' }), part('d1', 'led', 220, y + 40, 90, 'D1', { model: color }), ground(220, y + 100, 'gnd3')],
  wires: [wire('wl1', [50, y], [100, y]), wire('wl2', [180, y], [220, y]), wire('wl3', [220, y + 80], [220, y + 100])],
});

/** Blink: the LED L on the board and a red LED on D12 blink together, once a second. */
const arduinoBlink = (): Circuit => {
  const [gnd, wg] = boardGround();
  const led = pinLed(-110, 'LED_ROSSO');
  return {
    title: 'Arduino: Blink',
    elements: [part('a1', 'arduino_uno', 0, 0, 0, 'A1', { sketch: 'blink' }), gnd, ...led.elements],
    wires: [wg, ...led.wires],
    models: [],
  };
};

/** A potentiometer across 5V and GND, its wiper on A0; the sketch sets the brightness of the LED on D9 from it. */
const arduinoPot = (): Circuit => {
  const [gnd, wg] = boardGround();
  const led = pinLed(-50, 'LED_VERDE');
  return {
    title: 'Arduino: potenziometro e LED',
    // Turned so that b is on the 5V above and a on ground below: the wiper share is the share of 5 V
    elements: [part('a1', 'arduino_uno', 0, 0, 0, 'A1', { sketch: 'potenziometro' }), part('p1', 'potentiometer', -160, -40, 270, 'P1', { value: '10k', position: '50' }), ground(-160, 20, 'gnd2'), gnd, ...led.elements],
    wires: [
      wire('w5v', [-50, -70], [-90, -70], [-90, -100], [-160, -100], [-160, -80]),
      wire('wa0', [-200, -40], [-220, -40], [-220, 40], [-110, 40], [-110, -50], [-50, -50]),
      wire('wp', [-160, 0], [-160, 20]),
      wg,
      ...led.wires,
    ],
    models: [],
  };
};

/** An LM35 fed by the 5V of the board, its output on A0: the sketch writes the temperature on the serial monitor. */
const arduinoThermometer = (): Circuit => {
  const [gnd, wg] = boardGround();
  return {
    title: 'Arduino: termometro LM35',
    elements: [part('a1', 'arduino_uno', 0, 0, 0, 'A1', { sketch: 'termometro' }), part('u1', 'lm35', -220, -70, 0, 'U1', { temp: '25' }), ground(-220, -10, 'gnd2'), gnd],
    wires: [
      wire('w5v', [-50, -70], [-80, -70], [-80, -120], [-260, -120], [-260, -70]),
      wire('wa0', [-180, -70], [-120, -70], [-120, -50], [-50, -50]),
      wire('wu', [-220, -30], [-220, -10]),
      wg,
    ],
    models: [],
  };
};

/** Three logic inputs into a full adder: a red LED on the sum, a green one on the carry. */
const fullAdderExample = (): Circuit => ({
  title: 'Full adder',
  elements: [
    part('in1', 'logicinput', -100, -60, 0, 'A', { state: '1' }),
    part('in2', 'logicinput', -100, 0, 0, 'B', { state: '0' }),
    part('in3', 'logicinput', -100, 60, 0, 'Cin', { state: '1' }),
    part('u1', 'fulladder', 60, 0, 0, 'U1'),
    part('r1', 'resistor', 180, -10, 0, 'R1', { value: '220' }),
    part('d1', 'led', 320, 30, 90, 'D1', { model: 'LED_ROSSO' }),
    part('r2', 'resistor', 180, 100, 0, 'R2', { value: '220' }),
    part('d2', 'led', 260, 140, 90, 'D2', { model: 'LED_VERDE' }),
    ground(320, 90),
    ground(260, 200, 'gnd2'),
  ],
  wires: [
    wire('w1', [-60, -60], [0, -60], [0, -20], [20, -20]),
    wire('w2', [-60, 0], [20, 0]),
    wire('w3', [-60, 60], [0, 60], [0, 20], [20, 20]),
    wire('w4', [100, -10], [140, -10]),
    wire('w5', [220, -10], [320, -10]),
    wire('w6', [320, 70], [320, 90]),
    wire('w7', [100, 10], [120, 10], [120, 100], [140, 100]),
    wire('w8', [220, 100], [260, 100]),
    wire('w9', [260, 180], [260, 200]),
  ],
  models: [],
});

/** Four data inputs and two selection inputs into a MUX 4:1, an LED on its output. */
const muxExample = (): Circuit => {
  const names = ['D0', 'D1', 'D2', 'D3', 'S1', 'S0'];
  const states = ['1', '0', '1', '0', '0', '0'];
  const stagger = [-10, -20, -30, -30, -20, -10];
  return {
    title: 'Multiplexer 4:1',
    elements: [
      ...names.map((name, k) => part(`in${k}`, 'logicinput', -100, -100 + 40 * k, 0, name, { state: states[k] })),
      part('u1', 'mux4', 60, 0, 0, 'U1'),
      part('r1', 'resistor', 180, 0, 0, 'R1', { value: '220' }),
      part('d1', 'led', 260, 40, 90, 'D1', { model: 'LED_ROSSO' }),
      ground(260, 100),
    ],
    wires: [
      ...names.map((_, k) => wire(`w${k}`, [-60, -100 + 40 * k], [stagger[k], -100 + 40 * k], [stagger[k], -50 + 20 * k], [20, -50 + 20 * k])),
      wire('wy', [100, 0], [140, 0]),
      wire('wr', [220, 0], [260, 0]),
      wire('wg', [260, 80], [260, 100]),
    ],
    models: [],
  };
};

/**
 * A 555 in one of its two circuits, on a 5 V supply with rails above and below. The timer sits at the
 * origin; the LED on OUT and the capacitor on CTRL are the same in both.
 */
function timerCircuit(title: string, middle: { elements: Element[]; wires: Wire[] }): Circuit {
  return {
    title,
    elements: [
      part('v1', 'dcsupply', -320, 70, 90, 'V1', { amplitude: '5' }),
      part('u1', 'ne555', 0, 0, 0, 'U1'),
      part('c2', 'capacitor', 100, 60, 90, 'C2', { value: '10n' }),
      part('r3', 'resistor', 140, -20, 0, 'R3', { value: '220' }),
      part('d1', 'led', 220, 20, 90, 'D1', { model: 'LED_ROSSO' }),
      ground(-160, 180),
      ...middle.elements,
    ],
    wires: [
      wire('wtop', [-320, 30], [-320, -100], [20, -100]),
      wire('wbottom', [-320, 110], [-320, 180], [220, 180]),
      wire('wvcc', [-20, -100], [-20, -60]),
      wire('wreset', [20, -100], [20, -60]),
      wire('wgnd', [0, 60], [0, 180]),
      wire('wctrl', [60, 20], [100, 20]),
      wire('wc2', [100, 100], [100, 180]),
      wire('wout', [60, -20], [100, -20]),
      wire('wled', [180, -20], [220, -20]),
      wire('wk', [220, 60], [220, 180]),
      ...middle.wires,
    ],
    models: [],
  };
}

/** Astable: R1 from VCC to DIS, R2 from DIS to THR and TRIG together, C1 from there to GND. */
const timerAstable = () =>
  timerCircuit('555 astabile', {
    elements: [part('r1', 'resistor', -140, -60, 90, 'R1', { value: '1k' }), part('r2', 'resistor', -100, 20, 90, 'R2', { value: '75k' }), part('c1', 'capacitor', -80, 100, 90, 'C1', { value: '10u' })],
    wires: [
      wire('wdis', [-60, -20], [-140, -20]),
      wire('wthr', [-60, 0], [-80, 0], [-80, 60]),
      wire('wtrig', [-60, 20], [-80, 20]),
      wire('wr2', [-100, 60], [-80, 60]),
      wire('wc1', [-80, 140], [-80, 180]),
    ],
  });

/** Monostable: R from VCC to DIS and THR together, C to GND; TRIG held high by R2, a push button takes it low. */
const timerMonostable = () =>
  timerCircuit('555 monostabile', {
    elements: [
      part('r1', 'resistor', -140, -60, 90, 'R1', { value: '100k' }),
      part('c1', 'capacitor', -100, 20, 90, 'C1', { value: '10u' }),
      part('r2', 'resistor', -260, -60, 90, 'R2', { value: '10k' }),
      part('s1', 'pushno', -220, 140, 90, 'S1'),
    ],
    wires: [
      wire('wdis', [-60, -20], [-140, -20]),
      wire('wthr', [-60, 0], [-80, 0], [-80, -20]),
      wire('wc1', [-100, 60], [-100, 180]),
      wire('wtrig', [-60, 20], [-70, 20], [-70, 100], [-220, 100]),
      wire('wr2', [-260, -20], [-260, 100], [-220, 100]),
    ],
  });

/** What Nuovo opens: an empty sheet, but with the ground that every circuit needs. */
export const emptyCircuit = (): Circuit => ({ title: 'Circuito', elements: [ground(0, 0)], wires: [], models: [] });

export const EXAMPLES: Example[] = [
  { id: 'divider', title: 'Partitore di tensione', hint: 'Il multimetro legge 12 V × 4,7k / 14,7k, circa 3,84 V', build: divider },
  { id: 'rectifier', title: 'Raddrizzatore a semionda', hint: 'Con l’Analisi precisa si vede il ripple sul condensatore', build: () => halfWaveRectifier({ capacitor: '100u' }) },
  { id: 'lowpass', title: 'Filtro RC passa-basso', hint: 'Con l’analisi In frequenza il taglio è a 1/(2πRC), circa 1,59 kHz', build: lowPass },
  { id: 'zener', title: 'Stabilizzatore con zener', hint: 'Il carico resta a circa 5,1 V: lo zener prende la corrente in più', build: zener },
  { id: 'inverting', title: 'Amplificatore invertente', hint: 'Guadagno −RF/R1 = −10: 0,5 V in ingresso, 5 V in uscita, in opposizione', build: inverting },
  { id: 'switch', title: 'Transistor come interruttore', hint: 'Un’onda quadra tra 0 e 5 V, a 1 Hz, accende e spegne la corrente nel collettore', build: transistorSwitch },
  { id: 'gates', title: 'Porte logiche e LED', hint: 'Tocca 0 e 1 sugli ingressi: il LED rosso si accende con AND, il verde con XOR', build: gates },
  { id: 'switches', title: 'Pulsante, interruttore e porta logica', hint: 'Chiudi l’interruttore e tieni premuto il pulsante: il LED si accende solo con entrambi', build: switches },
  { id: 'sevenseg', title: 'Driver BCD e display a 7 segmenti', hint: 'Tocca gli ingressi D C B A: il display mostra la cifra del numero binario, da 0 a 9', build: sevenSegment },
  { id: 'counter', title: 'Contatore decimale e display', hint: 'Un clock da 1 Hz fa avanzare il contatore: il display conta da 0 a 9 e ricomincia. Tocca IN1 per portare RST a 1 e azzerarlo', build: counterDisplay },
  { id: 'fulladder', title: 'Full adder', hint: 'Tocca A, B e Cin: il LED rosso è la somma S, il verde il riporto Cout. Nelle proprietà di U1, Mostra l’interno apre i due half adder e l’OR di cui è fatto', build: fullAdderExample },
  { id: 'mux', title: 'Multiplexer 4:1', hint: 'S1 e S0 scelgono quale ingresso tra D0 e D3 arriva al LED: tocca i dati e la selezione. Mostra l’interno, nelle proprietà di U1, apre i tre MUX 2:1 di cui è fatto', build: muxExample },
  { id: 'astable', title: '555 astabile', hint: 'Il LED lampeggia a circa 1 Hz: f = 1,44/((R1 + 2·R2)·C1) = 0,96 Hz. All’oscilloscopio, THR di U1 sale e scende fra 1/3 e 2/3 di Vcc', build: timerAstable },
  { id: 'monostable', title: '555 monostabile', hint: 'Tieni premuto S1 un attimo: il LED resta acceso per circa 1,1·R1·C1, 1,1 s, poi si spegne da solo', build: timerMonostable },
  { id: 'dual', title: 'Alimentatore duale con presa centrale', hint: 'Trasformatore 230 V → 12+12 V, ponte di Graetz e due condensatori: circa +17 V e −17 V rispetto alla presa centrale', build: dualSupply },
  { id: 'motor', title: 'Motoriduttore IG22', hint: 'Chiudi S1: all’avvio la corrente fa uno spunto, poi scende a circa 0,2 A e il motore gira a 789 giri/min. Alza il carico di M1: la velocità scende e la corrente sale', build: gearMotor },
  { id: 'relay', title: 'Relè che comanda un motore', hint: 'Chiudi S1: la bobina di K1 si eccita, il contatto 13–14 si chiude e il motore da 12 V parte. Riapri S1: D1 porta la corrente della bobina e il contatto si riapre', build: relayMotor },
  { id: 'arduino_blink', title: 'Arduino: Blink', hint: 'Il programma Blink accende e spegne il LED L della scheda e il LED su D12 ogni secondo, in tempo reale. Nelle proprietà di A1 si cambia programma o se ne carica uno .hex', build: arduinoBlink },
  { id: 'arduino_pot', title: 'Arduino: potenziometro e LED', hint: 'Sposta il cursore di P1: Arduino legge A0 e regola con il PWM la luminosità del LED su D9. I valori compaiono nel Monitor seriale', build: arduinoPot },
  { id: 'arduino_lm35', title: 'Arduino: termometro LM35', hint: 'Cambia la temperatura di U1: Arduino legge A0 e scrive i gradi nel Monitor seriale ogni mezzo secondo', build: arduinoThermometer },
  { id: 'sensors', title: 'Sensori di temperatura LM35 e TMP36', hint: 'Sposta la temperatura nelle proprietà di U1 e U2: 10 mV per grado. LM35: 0 V a 0 °C; TMP36: 0,5 V a 0 °C', build: sensors },
  { id: 'regulator', title: 'Regolatore 7805', hint: '5 V sul carico da 100 Ω: guarda la potenza e la temperatura del regolatore', build: regulator },
];
