import React, { useEffect, useMemo, useRef } from 'react';
import { getDevice, TIMER_EDGE } from '../library/devices';
import { Circuit, Element, TimerSpec } from '../model/types';
import { LiveFrame, LiveLayout } from '../realtime/liveSimulation';
import { timerEstimate } from '../realtime/timer555';
import { formatEngineering } from './chartMath';
import { localToWorld } from '../utils/geometry';

interface Props {
  circuit: Circuit;
  layout: LiveLayout;
  frameRef: React.MutableRefObject<LiveFrame | null>;
}

/** Above the name of the part, clear of VCC and RESET. */
const WARNING_AT = { x: 0, y: -TIMER_EDGE - 56 };
const HALO = { paintOrder: 'stroke', stroke: 'var(--sch-halo)', strokeWidth: 3, strokeLinejoin: 'round' } as const;
const REFRESH_MS = 200;

/** What a 555 has beyond the limits of its datasheet, in red above it. */
export const TimerView: React.FC<Props> = ({ circuit, layout, frameRef }) => {
  const rootRef = useRef<SVGGElement>(null);
  const timers = useMemo(() => {
    const byId = new Map(circuit.elements.map((el) => [el.id, el]));
    return layout.devices.flatMap((device, index) => {
      const el = byId.get(device.elementId)!;
      return getDevice(el.def)?.spice.kind === 'timer' ? [{ id: el.id, index, at: localToWorld(el.x, el.y, WARNING_AT, el.rot, el.flip) }] : [];
    });
  }, [circuit, layout]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const texts = [...root.querySelectorAll<SVGTextElement>('text')];
    const refresh = () => {
      const frame = frameRef.current;
      if (!frame) return;
      timers.forEach(({ index }, i) => {
        if (texts[i]) texts[i].textContent = frame.timers[index]?.warnings.join(', ') ?? '';
      });
    };
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [frameRef, timers]);

  return (
    <g ref={rootRef} pointerEvents="none" data-testid="timer-view">
      {timers.map(({ id, at }) => (
        <text key={id} x={at.x} y={at.y} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--sch-alert)" style={HALO} />
      ))}
    </g>
  );
};

const decimal = (value: number, digits: number) => value.toFixed(digits).replace('.', ',');

/** How a 555 works, and what this one is expected to do if it is wired as in the books. */
export const TimerNote: React.FC<{ circuit: Circuit; element: Element; spec: TimerSpec }> = ({ circuit, element, spec }) => {
  const estimate = timerEstimate(circuit, element);
  return (
    <>
      {estimate && (
        <p className="hint">
          <strong>
            {estimate.kind === 'astable'
              ? `Astabile: f = 1,44/((R1 + 2·R2)·C) ≈ ${estimate.frequency < 1 ? `${decimal(estimate.frequency, 2)} Hz` : formatEngineering(estimate.frequency, 'Hz')}, duty ${decimal(estimate.duty * 100, 1)}%`
              : `Monostabile: T = 1,1·R·C ≈ ${formatEngineering(estimate.duration, 's')}`}
          </strong>
        </p>
      )}
      <p className="hint">
        TRIG sotto 1/3 di Vcc porta l'uscita alta e spegne DIS; THR sopra 2/3 la porta bassa e accende DIS verso massa; RESET sotto {decimal(spec.resetLevel, 1)} V la tiene bassa. CTRL è il punto a 2/3 del partitore interno. {spec.name}: alimentazione da {decimal(spec.vMin, 1)} a {spec.vMax} V
        {spec.highDrop > 0 ? `, uscita alta circa ${decimal(spec.highDrop + 0.5, 1)} V sotto Vcc` : ', uscita da rail a rail'}. RESET lasciato scollegato resta alto.
      </p>
    </>
  );
};
