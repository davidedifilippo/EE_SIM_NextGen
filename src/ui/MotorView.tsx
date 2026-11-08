import React, { useEffect, useMemo, useRef } from 'react';
import { getDevice } from '../library/devices';
import { Circuit } from '../model/types';
import { LiveFrame, LiveLayout } from '../realtime/liveSimulation';

interface Props {
  circuit: Circuit;
  layout: LiveLayout;
  frameRef: React.MutableRefObject<LiveFrame | null>;
}

/** The text changes a few times a second, to be read; the mark on the shaft moves at every frame. */
const TEXT_EVERY_MS = 200;
/** Where the mark of the shaft runs, inside the circle of the symbol. */
const MARK_RADIUS = 15;

const HALO = { paintOrder: 'stroke', stroke: 'var(--sch-halo)', strokeWidth: 3, strokeLinejoin: 'round' } as const;

const STATE_TEXT = { running: '', stalled: 'Bloccato', overvoltage: 'Sovratensione' } as const;

/**
 * Each motor as it turns: a mark that goes round at the simulated speed, so in slow motion at a slow
 * speed of the animation, the turns a minute under the symbol, and what is wrong above it.
 */
export const MotorView: React.FC<Props> = ({ circuit, layout, frameRef }) => {
  const rootRef = useRef<SVGGElement>(null);
  const motors = useMemo(() => {
    const byId = new Map(circuit.elements.map((el) => [el.id, el]));
    return layout.devices.flatMap((device, index) => {
      // The parts inside a block have no drawing of their own
      const el = byId.get(device.elementId);
      if (!el) return [];
      return getDevice(el.def)?.spice.kind === 'motor' ? [{ el, index }] : [];
    });
  }, [circuit, layout]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const marks = [...root.querySelectorAll<SVGCircleElement>('[data-mark]')];
    const speeds = [...root.querySelectorAll<SVGTextElement>('[data-rpm]')];
    const states = [...root.querySelectorAll<SVGTextElement>('[data-state]')];
    const angles = motors.map(() => -90);
    let lastTime: number | null = null;
    let lastText = 0;
    let handle = 0;
    const draw = (now: number) => {
      handle = requestAnimationFrame(draw);
      const frame = frameRef.current;
      if (!frame) return;
      // Turns from the simulated time gone by: the same speed as the circuit, whatever the animation
      const dt = lastTime === null || frame.time < lastTime ? 0 : frame.time - lastTime;
      lastTime = frame.time;
      motors.forEach(({ el, index }, i) => {
        const status = frame.motors[index];
        if (!status) return;
        angles[i] = (angles[i] + (status.rpm / 60) * 360 * dt) % 360;
        const rad = (angles[i] * Math.PI) / 180;
        marks[i]?.setAttribute('cx', String(el.x + MARK_RADIUS * Math.cos(rad)));
        marks[i]?.setAttribute('cy', String(el.y + MARK_RADIUS * Math.sin(rad)));
      });
      if (now - lastText < TEXT_EVERY_MS) return;
      lastText = now;
      motors.forEach(({ index }, i) => {
        const status = frame.motors[index];
        if (!status) return;
        // Stalled, what is left is the smooth sign of the friction, not a speed
        if (speeds[i]) speeds[i].textContent = `${status.state === 'stalled' ? 0 : Math.round(status.rpm)} giri/min`;
        if (states[i]) states[i].textContent = STATE_TEXT[status.state];
      });
    };
    handle = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(handle);
  }, [frameRef, motors]);

  return (
    <g ref={rootRef} pointerEvents="none" data-testid="motor-view">
      {motors.map(({ el }) => {
        // Standing, the leads run up and down: the texts go on the left, where the name is not
        const isStanding = el.rot === 90 || el.rot === 270;
        const [rpm, state] = isStanding ? [{ x: el.x - 26, y: el.y + 14 }, { x: el.x - 26, y: el.y - 6 }] : [{ x: el.x, y: el.y + 36 }, { x: el.x, y: el.y - 28 }];
        const anchor = isStanding ? 'end' : 'middle';
        return (
          <g key={el.id}>
            <circle data-mark cx={el.x} cy={el.y - MARK_RADIUS} r={3} fill="var(--sch-voltage)" />
            <text data-rpm x={rpm.x} y={rpm.y} textAnchor={anchor} fontSize={11} fontWeight={700} fill="var(--sch-ink)" style={HALO} />
            <text data-state x={state.x} y={state.y} textAnchor={anchor} fontSize={11} fontWeight={700} fill="var(--sch-alert)" style={HALO} />
          </g>
        );
      })}
    </g>
  );
};
