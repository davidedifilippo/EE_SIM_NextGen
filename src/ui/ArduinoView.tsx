import React, { useEffect, useMemo, useRef } from 'react';
import { ARDUINO_HALF, getDevice } from '../library/devices';
import { Circuit } from '../model/types';
import { LiveFrame, LiveLayout } from '../realtime/liveSimulation';
import { localToWorld } from '../utils/geometry';

interface Props {
  circuit: Circuit;
  layout: LiveLayout;
  frameRef: React.MutableRefObject<LiveFrame | null>;
}

/** The LED L sits by D13, as on the board. */
const LED_AT = { x: 4, y: -ARDUINO_HALF + 12 };
const WARNING_AT = { x: 0, y: ARDUINO_HALF + 32 };
const HALO = { paintOrder: 'stroke', stroke: 'var(--sch-halo)', strokeWidth: 3, strokeLinejoin: 'round' } as const;

/** Each Arduino as it runs: the LED L on D13, and in red what draws beyond its maximum current. */
export const ArduinoView: React.FC<Props> = ({ circuit, layout, frameRef }) => {
  const rootRef = useRef<SVGGElement>(null);
  const boards = useMemo(() => {
    const byId = new Map(circuit.elements.map((el) => [el.id, el]));
    return layout.devices.flatMap((device, index) => {
      const el = byId.get(device.elementId)!;
      if (getDevice(el.def)?.spice.kind !== 'mcu') return [];
      const at = (p: { x: number; y: number }) => localToWorld(el.x, el.y, p, el.rot, el.flip);
      return [{ id: el.id, index, led: at(LED_AT), warning: at(WARNING_AT) }];
    });
  }, [circuit, layout]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const leds = [...root.querySelectorAll<SVGCircleElement>('[data-led]')];
    const warnings = [...root.querySelectorAll<SVGTextElement>('[data-warning]')];
    let handle = 0;
    let shown = boards.map(() => '');
    const draw = () => {
      handle = requestAnimationFrame(draw);
      const frame = frameRef.current;
      if (!frame) return;
      boards.forEach(({ index }, i) => {
        const status = frame.mcus[index];
        if (!status) return;
        leds[i]?.setAttribute('fill', status.led ? '#f59e0b' : 'var(--sch-part)');
        const text = status.warnings.join(', ');
        if (text !== shown[i] && warnings[i]) {
          warnings[i].textContent = text;
          shown = shown.map((t, j) => (j === i ? text : t));
        }
      });
    };
    handle = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(handle);
  }, [frameRef, boards]);

  return (
    <g ref={rootRef} pointerEvents="none" data-testid="arduino-view">
      {boards.map(({ id, led, warning }) => (
        <g key={id}>
          <circle data-led cx={led.x} cy={led.y} r={4} fill="var(--sch-part)" stroke="var(--sch-ink)" strokeWidth={1} />
          <text x={led.x - 9} y={led.y + 3.5} textAnchor="end" fontSize={9} fontWeight={700} fill="var(--sch-muted)">
            L
          </text>
          <text data-warning x={warning.x} y={warning.y} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--sch-alert)" style={HALO} />
        </g>
      ))}
    </g>
  );
};
