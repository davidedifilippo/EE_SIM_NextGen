import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { Circuit } from '../model/types';
import { UNO_PINS } from '../realtime/unoPins';
import { sourceSpec } from '../netlist/source';
import { LiveFrame } from '../realtime/liveSimulation';
import { waveformStats } from '../realtime/waveform';
import { formatEngineering, pickTimeUnit } from './chartMath';

export { SPEEDS } from '../realtime/liveRate';

export interface LiveLegendHandle {
  update: (maxVoltage: number, frame: LiveFrame | null, keptUp: number) => void;
}

/** Voltage peak and clock, updated directly at animation rate. */
export const LiveLegend = forwardRef<LiveLegendHandle, { errors: string[] }>(({ errors }, ref) => {
  const peakRef = useRef<HTMLSpanElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const slowRef = useRef<HTMLSpanElement>(null);

  useImperativeHandle(ref, () => ({
    update(maxVoltage, frame, keptUp) {
      if (peakRef.current) peakRef.current.textContent = `±${formatEngineering(maxVoltage, 'V')}`;
      if (timeRef.current && frame) {
        const unit = pickTimeUnit(frame.time || 1e-3);
        timeRef.current.textContent = `t = ${(frame.time / unit.factor).toFixed(1).replace('.', ',')} ${unit.symbol}`;
      }
      if (slowRef.current) slowRef.current.hidden = keptUp > 0.9;
    },
  }));

  return (
    <div className="live-legend">
      {errors.length > 0 ? (
        <div className="live-message" role="status">
          {errors[0]}
        </div>
      ) : (
        <>
          <span ref={peakRef} className="live-peak" />
          <span ref={timeRef} className="live-time" />
          <span ref={slowRef} className="live-slow" hidden>
            Circuito troppo pesante: animazione rallentata
          </span>
        </>
      )}
    </div>
  );
});
LiveLegend.displayName = 'LiveLegend';

/** Bar over the canvas with the values of the selected signal generator. */
export const SourceStats: React.FC<{ circuit: Circuit; selectedIds: Set<string> }> = ({ circuit, selectedIds }) => {
  const source = selectedIds.size === 1 ? circuit.elements.find((el) => selectedIds.has(el.id) && el.def === 'vsource') : undefined;
  const spec = source ? sourceSpec(source.props) : null;
  const stats = spec ? waveformStats(spec) : null;
  if (!stats) return null;

  const rows: [string, string][] = [
    ['Max', formatEngineering(stats.max, 'V')],
    ['Min', formatEngineering(stats.min, 'V')],
    ['Escursione', formatEngineering(stats.range, 'V')],
    ['Freq', formatEngineering(stats.frequency, 'Hz')],
    ['RMS', formatEngineering(stats.rms, 'V')],
  ];
  return (
    <dl className="source-stats">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
};

/** Voltages and currents of the selected component, refreshed a few times per second. */
export const LiveReadout: React.FC<{
  deviceIndex: number;
  /** See drawingSign. */
  sign: 1 | -1;
  /** Set for a transistor: where its dots start, collector or drain first. */
  transistorFirstDot: number | null;
  isMos: boolean;
  /** Set for a transformer or a relay: where the dots of its windings, or of coil and contact, start. */
  windingsFirstDot: number | null;
  /** A potentiometer: the voltage of its wiper too. */
  isPot?: boolean;
  /** A lamp: the power it takes too. */
  isLamp?: boolean;
  /** Set for an Arduino: where the dots of its pins start, the 5V after the twenty of the program. */
  boardFirstDot?: number | null;
  /** Set for a 555: where the dots of its pins start, OUT the third. */
  timerFirstDot?: number | null;
  /** Set for an optocoupler: where its dots start, the LED then the output. */
  optoFirstDot?: number | null;
  /** Set for a regulator: where the dots of its pins start. */
  regulatorFirstDot: number | null;
  /** A temperature sensor: no heat to show. */
  isSensor?: boolean;
  frameRef: React.MutableRefObject<LiveFrame | null>;
}> = ({ deviceIndex, sign, transistorFirstDot, isMos, windingsFirstDot, regulatorFirstDot, isSensor = false, isPot = false, isLamp = false, boardFirstDot = null, timerFirstDot = null, optoFirstDot = null, frameRef }) => {
  const [rows, setRows] = React.useState<[string, string][] | null>(null);

  React.useEffect(() => {
    const refresh = () => {
      const frame = frameRef.current;
      if (!frame) return;
      const volts = (v: number | undefined) => formatEngineering(v ?? 0, 'V');
      const amps = (i: number | undefined) => formatEngineering(i ?? 0, 'A');
      const regulator = frame.regulators[deviceIndex];
      const relay = frame.relays[deviceIndex];
      const timer = frame.timers[deviceIndex];
      setRows(
        optoFirstDot !== null
          ? [
              ['VF', volts(frame.deviceVoltage[deviceIndex])],
              ['IF', amps(frame.deviceCurrent[deviceIndex])],
              ['VCE', volts(frame.deviceVbe[deviceIndex])],
              ['IC', amps(frame.dotCurrent[optoFirstDot + 1])],
            ]
          : timer && timerFirstDot !== null
          ? [
              ['Vcc', volts(frame.deviceVbe[deviceIndex])],
              ['OUT', volts(frame.deviceVoltage[deviceIndex])],
              ['Uscita', timer.isHigh ? 'Alta' : 'Bassa'],
              // Out of OUT is what it gives the load
              ['I OUT', amps(-frame.dotCurrent[timerFirstDot + 2])],
            ]
          : boardFirstDot !== null
          ? [
              ['5V', volts(frame.deviceVoltage[deviceIndex])],
              // Into the 5V pin is what the board takes: out of it, what it gives the circuit
              ['Erogati', amps(-frame.dotCurrent[boardFirstDot + UNO_PINS.length])],
            ]
          : relay !== null && relay !== undefined && windingsFirstDot !== null
          ? [
              ['Bobina', volts(frame.deviceVoltage[deviceIndex])],
              ['I bobina', amps(frame.deviceCurrent[deviceIndex])],
              ['Contatto', relay ? 'Chiuso' : 'Aperto'],
              ['I contatto', amps(frame.dotCurrent[windingsFirstDot + 1])],
            ]
          : isLamp
          ? [
              ['Tensione', volts(frame.deviceVoltage[deviceIndex])],
              ['Corrente', amps(frame.deviceCurrent[deviceIndex])],
              ['Potenza', formatEngineering(frame.glowMean[deviceIndex], 'W')],
            ]
          : isPot
          ? [
              ['Tensione', volts(frame.deviceVoltage[deviceIndex])],
              ['Corrente', amps(frame.deviceCurrent[deviceIndex])],
              ['Cursore', volts(frame.deviceVbe[deviceIndex])],
            ]
          : 
        regulator && regulatorFirstDot !== null
          ? [
              [isSensor ? 'Vs' : 'Vin', volts(frame.deviceVoltage[deviceIndex] + frame.deviceVbe[deviceIndex])],
              ['Vout', volts(frame.deviceVbe[deviceIndex])],
              ['Iout', amps(Math.abs(frame.dotCurrent[regulatorFirstDot + 1]))],
              ...(isSensor
                ? []
                : ([
                    ['Potenza', formatEngineering(regulator.power, 'W')],
                    ['Giunzione', `${Math.round(regulator.temperature)} °C`],
                  ] as [string, string][])),
            ]
          : windingsFirstDot !== null
          ? [
              ['V1', volts(frame.deviceVoltage[deviceIndex])],
              ['I1', amps(frame.dotCurrent[windingsFirstDot])],
              ['V2', volts(frame.deviceVbe[deviceIndex])],
              ['I2', amps(frame.dotCurrent[windingsFirstDot + 1])],
            ]
          : isMos && transistorFirstDot !== null
          ? [
              ['Vds', volts(frame.deviceVoltage[deviceIndex])],
              ['Vgs', volts(frame.deviceVbe[deviceIndex])],
              ['Id', amps(frame.dotCurrent[transistorFirstDot])],
            ]
          : frame.motors[deviceIndex]
          ? [
              ['Tensione', volts(frame.deviceVoltage[deviceIndex])],
              ['Corrente', amps(frame.deviceCurrent[deviceIndex])],
              ['Velocità', `${frame.motors[deviceIndex]!.state === 'stalled' ? 0 : Math.round(frame.motors[deviceIndex]!.rpm)} giri/min`],
            ]
          : transistorFirstDot === null
          ? [
              ['Tensione', volts(sign * frame.deviceVoltage[deviceIndex])],
              ['Corrente', amps(sign * frame.deviceCurrent[deviceIndex])],
            ]
          : [
              ['Vce', volts(frame.deviceVoltage[deviceIndex])],
              ['Vbe', volts(frame.deviceVbe[deviceIndex])],
              ['Ic', amps(frame.dotCurrent[transistorFirstDot])],
              ['Ib', amps(frame.dotCurrent[transistorFirstDot + 1])],
            ],
      );
    };
    refresh();
    const timer = setInterval(refresh, 200);
    return () => clearInterval(timer);
  }, [deviceIndex, sign, transistorFirstDot, isMos, windingsFirstDot, regulatorFirstDot, isSensor, isPot, isLamp, boardFirstDot, timerFirstDot, optoFirstDot, frameRef]);

  if (!rows) return null;
  return (
    <dl className="live-readout">
      {rows.map(([label, value]) => (
        <React.Fragment key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
};
