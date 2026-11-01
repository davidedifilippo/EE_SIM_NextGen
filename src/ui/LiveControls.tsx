import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { Circuit } from '../model/types';
import { LiveFrame } from '../realtime/liveSimulation';
import { waveformStats } from '../realtime/waveform';
import { formatEngineering, pickTimeUnit } from './chartMath';
import { NEGATIVE, NEUTRAL, POSITIVE, toCss } from './liveColors';

export const SPEEDS: { label: string; simSecondsPerSecond: number }[] = [
  { label: '1 ms/s', simSecondsPerSecond: 1e-3 },
  { label: '5 ms/s', simSecondsPerSecond: 5e-3 },
  { label: '20 ms/s', simSecondsPerSecond: 20e-3 },
  { label: '100 ms/s', simSecondsPerSecond: 100e-3 },
  { label: '1 s/s', simSecondsPerSecond: 1 },
];

export interface LiveLegendHandle {
  update: (maxVoltage: number, frame: LiveFrame | null, keptUp: number) => void;
}

/** Color scale and clock, updated directly at animation rate. */
export const LiveLegend = forwardRef<LiveLegendHandle, { errors: string[] }>(({ errors }, ref) => {
  const lowRef = useRef<HTMLSpanElement>(null);
  const highRef = useRef<HTMLSpanElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const slowRef = useRef<HTMLSpanElement>(null);

  useImperativeHandle(ref, () => ({
    update(maxVoltage, frame, keptUp) {
      const label = formatEngineering(maxVoltage, 'V');
      if (highRef.current) highRef.current.textContent = `+${label}`;
      if (lowRef.current) lowRef.current.textContent = `-${label}`;
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
          <div className="live-scale">
            <span ref={lowRef}>-</span>
            <span
              className="live-scale-bar"
              style={{ background: `linear-gradient(to right, ${toCss(NEGATIVE)}, ${toCss(NEUTRAL)}, ${toCss(POSITIVE)})` }}
            />
            <span ref={highRef}>+</span>
          </div>
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
  const stats = source ? waveformStats(String(source.props.spec ?? '')) : null;
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

/** Voltage and current of the selected component, refreshed a few times per second. */
export const LiveReadout: React.FC<{
  deviceIndex: number;
  frameRef: React.MutableRefObject<LiveFrame | null>;
}> = ({ deviceIndex, frameRef }) => {
  const [text, setText] = React.useState<{ v: string; i: string } | null>(null);

  React.useEffect(() => {
    const refresh = () => {
      const frame = frameRef.current;
      if (!frame) return;
      setText({
        v: formatEngineering(frame.deviceVoltage[deviceIndex] ?? 0, 'V'),
        i: formatEngineering(frame.deviceCurrent[deviceIndex] ?? 0, 'A'),
      });
    };
    refresh();
    const timer = setInterval(refresh, 200);
    return () => clearInterval(timer);
  }, [deviceIndex, frameRef]);

  if (!text) return null;
  return (
    <dl className="live-readout">
      <dt>Tensione</dt>
      <dd>{text.v}</dd>
      <dt>Corrente</dt>
      <dd>{text.i}</dd>
    </dl>
  );
};
