import { AVRADC, AVRIOPort, AVRTimer, AVRUSART, CPU, adcConfig, avrInstruction, PinState, portBConfig, portCConfig, portDConfig, timer0Config, timer1Config, timer2Config, usart0Config } from 'avr8js';

/** The clock of the Uno. */
export const UNO_CLOCK = 16e6;

import { UNO_PINS } from './unoPins';

export { parseIntelHex } from './intelHex';

export { LED_PIN, UNO_PINS } from './unoPins';

/** From the datasheet of the ATmega328P: an output at 5 V drops about 0.5 V at 20 mA. */
export const PIN_OUTPUT_RESISTANCE = 25;
/** The internal pull-up, 20 to 50 kΩ: the middle of it. */
export const PIN_PULLUP_RESISTANCE = 35e3;
/** An input takes at most 1 µA: as good as nothing. */
export const PIN_INPUT_RESISTANCE = 1e8;
/** Absolute maximum current of a pin. */
export const PIN_MAX_CURRENT = 0.04;
/** The resettable fuse on the USB supply of the board. */
export const SUPPLY_MAX_CURRENT = 0.5;
export const UNO_VCC = 5;
/** The 5V pin of a board fed by USB: the regulator and the fuse, as a small resistance. */
export const UNO_SUPPLY_RESISTANCE = 0.1;
/** Input thresholds of the datasheet: low below 0.3 Vcc, high above 0.6 Vcc. */
const INPUT_LOW = 0.3 * UNO_VCC;
const INPUT_HIGH = 0.6 * UNO_VCC;
/** What the serial monitor keeps when nobody reads it. */
const SERIAL_KEEP = 4096;

/** How a pin meets the circuit: a high-impedance input, an input with its pull-up, or an output. */
export const PinMode = { Input: 0, PullUp: 1, Output: 2 } as const;

/** Each pin of the Uno on its port: D0–D7 on port D, D8–D13 on port B, A0–A5 on port C. */
const PIN_PORT = UNO_PINS.map((_, k) => (k < 8 ? { port: 'D', bit: k } : k < 14 ? { port: 'B', bit: k - 8 } : { port: 'C', bit: k - 14 })) as { port: 'B' | 'C' | 'D'; bit: number }[];

/**
 * The microcontroller of an Arduino Uno, with the peripherals a sketch uses: timers (millis, delay,
 * analogWrite), ports, the serial port and the converter.
 */
export class ArduinoUno {
  readonly cpu: CPU;
  private readonly ports: Record<'B' | 'C' | 'D', AVRIOPort>;
  private readonly adc: AVRADC;
  /** Mode of each pin at the end of the last run. */
  readonly modes = new Uint8Array(UNO_PINS.length);
  /** For an output, the share of the last run it spent high. */
  readonly highShare = new Float64Array(UNO_PINS.length);
  /**
   * For an output, the level it gives the circuit for the step: always a full 0 or 5 V, as a real pin,
   * with the share it could not give carried to the next step. A PWM shorter than a step so keeps its
   * mean, and an LED still sees its full current for the right part of the time.
   */
  private readonly drive = new Uint8Array(UNO_PINS.length);
  private readonly residual = new Float64Array(UNO_PINS.length);
  /** Level each input reads now, kept for the hysteresis. */
  private readonly inputLevel = new Uint8Array(UNO_PINS.length);
  private readonly level = new Uint8Array(UNO_PINS.length);
  private readonly lastChange = new Float64Array(UNO_PINS.length);
  private readonly highCycles = new Float64Array(UNO_PINS.length);
  private serial = '';
  /** Cycles owed by the fractions of past steps. */
  private carry = 0;

  constructor(program: Uint16Array) {
    this.cpu = new CPU(program);
    new AVRTimer(this.cpu, timer0Config);
    new AVRTimer(this.cpu, timer1Config);
    new AVRTimer(this.cpu, timer2Config);
    this.ports = { B: new AVRIOPort(this.cpu, portBConfig), C: new AVRIOPort(this.cpu, portCConfig), D: new AVRIOPort(this.cpu, portDConfig) };
    this.adc = new AVRADC(this.cpu, adcConfig);
    const usart = new AVRUSART(this.cpu, usart0Config, UNO_CLOCK);
    usart.onByteTransmit = (byte) => {
      this.serial += String.fromCharCode(byte);
      if (this.serial.length > 2 * SERIAL_KEEP) this.serial = this.serial.slice(-SERIAL_KEEP);
    };
    for (const name of ['B', 'C', 'D'] as const) {
      this.ports[name].addListener((value) => {
        PIN_PORT.forEach(({ port, bit }, k) => {
          if (port !== name) return;
          const level = (value >> bit) & 1;
          if (level === this.level[k]) return;
          if (this.level[k]) this.highCycles[k] += this.cpu.cycles - this.lastChange[k];
          this.level[k] = level;
          this.lastChange[k] = this.cpu.cycles;
        });
      });
    }
  }

  /** Runs for a time, and returns whether a pin changed its mode: the circuit sees a new matrix then. */
  run(seconds: number): boolean {
    const { cpu } = this;
    const exact = seconds * UNO_CLOCK + this.carry;
    const cycles = Math.floor(exact);
    this.carry = exact - cycles;
    const start = cpu.cycles;
    const end = start + cycles;
    this.highCycles.fill(0);
    this.lastChange.fill(start);
    while (cpu.cycles < end) {
      avrInstruction(cpu);
      cpu.tick();
    }
    let hasChanged = false;
    const span = Math.max(cpu.cycles - start, 1);
    PIN_PORT.forEach(({ port, bit }, k) => {
      if (this.level[k]) this.highCycles[k] += cpu.cycles - this.lastChange[k];
      this.highShare[k] = this.highCycles[k] / span;
      const wanted = this.highShare[k] + this.residual[k];
      this.drive[k] = wanted >= 0.5 ? 1 : 0;
      this.residual[k] = wanted - this.drive[k];
      const state = this.ports[port].pinState(bit);
      const mode = state === PinState.Input ? PinMode.Input : state === PinState.InputPullUp ? PinMode.PullUp : PinMode.Output;
      if (mode !== this.modes[k]) hasChanged = true;
      this.modes[k] = mode;
    });
    return hasChanged;
  }

  /** The voltage of each pin, to the ground of the board: digital levels with hysteresis, and the converter. */
  setInputs(volts: ArrayLike<number>) {
    PIN_PORT.forEach(({ port, bit }, k) => {
      const v = volts[k];
      const level = v > INPUT_HIGH ? 1 : v < INPUT_LOW ? 0 : this.inputLevel[k];
      if (level !== this.inputLevel[k]) {
        this.inputLevel[k] = level;
        this.ports[port].setPin(bit, level === 1);
      }
      if (port === 'C') this.adc.channelValues[bit] = Math.min(Math.max(v, 0), UNO_VCC);
    });
  }

  /** What the sketch has written on the serial port since the last call. */
  takeSerial(): string {
    const text = this.serial;
    this.serial = '';
    return text;
  }

  /** The source voltage each pin puts behind its resistance, from its mode and its level for the step. */
  pinSource(k: number): number {
    return this.modes[k] === PinMode.Output ? UNO_VCC * this.drive[k] : this.modes[k] === PinMode.PullUp ? UNO_VCC : 0;
  }

  pinResistance(k: number): number {
    return this.modes[k] === PinMode.Output ? PIN_OUTPUT_RESISTANCE : this.modes[k] === PinMode.PullUp ? PIN_PULLUP_RESISTANCE : PIN_INPUT_RESISTANCE;
  }

  /** Time the program has run, in seconds. */
  get time(): number {
    return this.cpu.cycles / UNO_CLOCK;
  }
}

