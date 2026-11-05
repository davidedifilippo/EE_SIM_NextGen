import { describe, expect, it } from 'vitest';
import blink from '../samples/arduino/blink/blink.hex?raw';
import { EXAMPLES } from '../samples/examples';
import { getDevice } from '../library/devices';
import { Circuit } from '../model/types';
import { compileCircuit } from './compile';
import { RealtimeEngine } from './engine';
import { parseIntelHex } from './intelHex';
import { automaticSpeed, LIVE_STEPS_PER_SECOND } from './liveRate';

/** One step of the animation at real time, as an Arduino circuit runs. */
const H = 1 / LIVE_STEPS_PER_SECOND;

const example = (id: string) => EXAMPLES.find((e) => e.id === id)!.build();

function engineOf(circuit: Circuit) {
  const compiled = compileCircuit(circuit);
  if (!compiled.ok) throw new Error(compiled.errors.join());
  const engine = new RealtimeEngine(compiled.compiled);
  engine.initialize();
  const index = (id: string) => compiled.compiled.elementIds.indexOf(id);
  let serial = '';
  const run = (seconds: number, each?: () => void) => {
    for (let k = 0; k < Math.round(seconds / H); k++) {
      engine.step(H);
      each?.();
      serial += engine.mcuStatus(index('a1'))?.serial ?? '';
    }
  };
  return { engine, index, run, serial: () => serial, compiled: compiled.compiled };
}

const withProps = (circuit: Circuit, id: string, props: Record<string, string>): Circuit => ({
  ...circuit,
  elements: circuit.elements.map((el) => (el.id === id ? { ...el, props: { ...el.props, ...props } } : el)),
});

describe('the program file', () => {
  it('reads the Intel HEX of the IDE, and refuses a damaged one', () => {
    const program = parseIntelHex(blink);
    expect(program).not.toBeNull();
    // The reset vector: a jump at address 0
    expect(program![0] & 0xfe0e).toBe(0x940c);
    const damaged = blink.replace(/^(:10000000)(..)/m, (_, head, byte) => `${head}${byte === 'FF' ? '00' : 'FF'}`);
    expect(parseIntelHex(damaged)).toBeNull();
    expect(parseIntelHex('')).toBeNull();
    expect(parseIntelHex('ciao')).toBeNull();
  });

  it('a custom board without a file asks for one', () => {
    const circuit = withProps(example('arduino_blink'), 'a1', { sketch: 'custom', hex: '' });
    expect(compileCircuit(circuit)).toEqual({ ok: false, errors: ['A1: carica un file .hex nelle proprietà'] });
  });
});

describe('the examples on the board', () => {
  it('Blink: the LEDs change every second of simulated time', () => {
    const { engine, index, run } = engineOf(example('arduino_blink'));
    const edges: number[] = [];
    let last = true;
    run(2.3, () => {
      const isOn = engine.deviceCurrent(index('d1')) > 5e-3;
      if (isOn !== last) edges.push(engine.time);
      last = isOn;
    });
    // On from the start, off at 1 s, on again at 2 s: within a hundredth
    expect(edges).toHaveLength(2);
    expect(edges[0]).toBeCloseTo(1, 2);
    expect(edges[1]).toBeCloseTo(2, 2);
    expect(engine.mcuStatus(index('a1'))?.led).toBe(true);
  });

  it('potentiometer: the wiper sets the PWM on D9, and the values reach the serial port', () => {
    const mean = (position: string) => {
      const { engine, index, run, serial } = engineOf(withProps(example('arduino_pot'), 'p1', { position }));
      run(0.3);
      let sum = 0;
      let count = 0;
      run(0.2, () => {
        sum += engine.deviceCurrent(index('d1'));
        count++;
      });
      return { current: sum / count, serial: serial() };
    };
    const quarter = mean('25');
    const full = mean('100');
    expect(quarter.serial).toMatch(/A0 = 25[56]\s+PWM = 6[34]/);
    expect(full.serial).toMatch(/A0 = 1023\s+PWM = 255/);
    // A quarter of the time on, so about a quarter of the current
    expect(quarter.current / full.current).toBeGreaterThan(0.2);
    expect(quarter.current / full.current).toBeLessThan(0.3);
  });

  it('LM35 thermometer: the serial port reads the temperature of the sensor', () => {
    const { run, serial } = engineOf(withProps(example('arduino_lm35'), 'u1', { temp: '40' }));
    run(0.6);
    // 0.4 V is 81.8 steps of the converter, which keeps 81: 39.6 °C, as on a real board
    expect(serial()).toMatch(/Temperatura: 39\.6 C/);
  });
});

describe('the pins in the circuit', () => {
  /** Where a pin of the board at the origin is, to wire it. */
  const pin = (name: string) => getDevice('arduino_uno')!.terminals.find((t) => t.id === name)!;
  const base = (sketch: string): Circuit => ({
    title: 't',
    elements: [{ id: 'a1', def: 'arduino_uno', x: 0, y: 0, rot: 0, tag: 'A1', props: { sketch, hex: '', hexName: '', resets: '0' } }, { id: 'gnd', def: 'ground', x: -80, y: 70, rot: 0, tag: '', props: {} }],
    wires: [{ id: 'wg', pts: [{ x: -50, y: 70 }, { x: -80, y: 70 }] }],
    models: [],
  });
  /** A two-terminal part from a pin on the right of the board to its own ground. */
  const toGround = (circuit: Circuit, id: string, def: string, name: string, props: Record<string, string>) => {
    const { x, y } = pin(name);
    circuit.elements.push({ id, def, x: x + 50, y, rot: 0, tag: id.toUpperCase(), props }, { id: `g${id}`, def: 'ground', x: x + 110, y, rot: 0, tag: '', props: {} });
    circuit.wires.push({ id: `w${id}a`, pts: [{ x, y }, { x: x + 10, y }] }, { id: `w${id}b`, pts: [{ x: x + 90, y }, { x: x + 110, y }] });
    return circuit;
  };

  it('an input with its pull-up reads the push button', () => {
    for (const [pressed, volts] of [['0', 0], ['1', 5]] as const) {
      const circuit = toGround(toGround(base('pulsante'), 's1', 'pushno', 'D2', { pressed }), 'r1', 'resistor', 'D12', { value: '1k' });
      const { engine, index, run } = engineOf(circuit);
      run(0.05);
      // 5 V behind the 25 ohms of the pin
      expect(engine.deviceCurrent(index('r1')) * 1e3).toBeCloseTo((volts * 1000) / 1025, 2);
    }
  });

  it('a pin shorted to ground draws far beyond its maximum, and says so', () => {
    const circuit = base('blink');
    circuit.wires.push({ id: 'ws', pts: [pin('D13'), { x: 80, y: pin('D13').y }] });
    circuit.elements.push({ id: 'gs', def: 'ground', x: 80, y: pin('D13').y, rot: 0, tag: '', props: {} });
    const { engine, index, run } = engineOf(circuit);
    run(0.01);
    expect(engine.mcuStatus(index('a1'))!.warnings).toEqual(['D13 oltre 40 mA']);
    expect(-engine.terminalCurrents(index('a1'))[13]).toBeCloseTo(5 / 25, 2);
  });

  it('the 5V pin feeds the circuit through the potentiometer', () => {
    const { engine, index } = engineOf(example('arduino_pot'));
    // 10k across 5 V, behind the 0.1 ohm of the supply
    expect(Math.abs(engine.terminalCurrents(index('p1'))[1])).toBeCloseTo(5 / 10e3, 6);
  });
});

describe('the board through changes of the circuit', () => {
  /** The board after 1.5 s of Blink: the LED is off, where a board just started has it on. */
  function halfway() {
    const first = engineOf(example('arduino_blink'));
    first.run(1.5);
    expect(first.engine.mcuStatus(first.index('a1'))!.led).toBe(false);
    return first;
  }

  it('a new value goes on with the same program', () => {
    const first = halfway();
    const { engine, index } = engineOf(withProps(example('arduino_blink'), 'r1', { value: '330' }));
    engine.adoptState(first.engine);
    engine.step(H);
    expect(engine.mcuStatus(index('a1'))!.led).toBe(false);
  });

  it('rewiring keeps the board running; Reset starts the program again', () => {
    const first = halfway();
    const rewired = example('arduino_blink');
    rewired.elements.push({ id: 'rx', def: 'resistor', x: 400, y: 400, rot: 0, tag: 'RX', props: { value: '1k' } });
    const kept = engineOf(rewired);
    kept.engine.adoptMcus(first.engine);
    kept.engine.step(H);
    expect(kept.engine.mcuStatus(kept.index('a1'))!.led).toBe(false);
    const reset = engineOf(withProps(example('arduino_blink'), 'a1', { resets: '1' }));
    reset.engine.adoptMcus(first.engine);
    reset.engine.step(H);
    expect(reset.engine.mcuStatus(reset.index('a1'))!.led).toBe(true);
  });

  it('runs in real time with the automatic speed', () => {
    expect(automaticSpeed(null, true)).toBe(1);
    expect(automaticSpeed(1 / 50, true)).toBe(1);
  });
});
