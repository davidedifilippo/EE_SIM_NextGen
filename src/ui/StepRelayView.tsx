import React, { useEffect, useMemo, useRef } from 'react';
import { getDevice, stepBlade } from '../library/devices';
import { Circuit } from '../model/types';
import { LiveFrame, LiveLayout } from '../realtime/liveSimulation';
import { localToWorld } from '../utils/geometry';

interface Props {
  circuit: Circuit;
  layout: LiveLayout;
  frameRef: React.MutableRefObject<LiveFrame | null>;
}

const HALO = { paintOrder: 'stroke', stroke: 'var(--sch-halo)', strokeWidth: 3, strokeLinejoin: 'round' } as const;
/** Above the name of the part. */
const WARNING_AT = { x: 0, y: -62 };

/**
 * The contacts of each step relay as the sequence has them: a closed one covers the blade at rest and is
 * drawn straight up; in red above the part, what is beyond its ratings.
 */
export const StepRelayView: React.FC<Props> = ({ circuit, layout, frameRef }) => {
  const rootRef = useRef<SVGGElement>(null);
  const relays = useMemo(() => {
    const byId = new Map(circuit.elements.map((el) => [el.id, el]));
    return layout.devices.flatMap((device, index) => {
      // The parts inside a block have no drawing of their own
      const el = byId.get(device.elementId);
      if (!el) return [];
      const spice = getDevice(el.def)?.spice;
      if (spice?.kind !== 'steprelay') return [];
      const at = (x: number, y: number) => localToWorld(el.x, el.y, { x, y }, el.rot, el.flip);
      const blades = (spice.c4 ? [20, 40] : [20]).map((x) => {
        const blade = stepBlade(x);
        const line = ({ x1, y1, x2, y2 }: typeof blade.rest) => ({ a: at(x1, y1), b: at(x2, y2) });
        return { open: line(blade.rest), closed: line(blade.pulled), contacts: blade.contacts.map(([cx, cy]) => at(cx, cy)) };
      });
      return [{ id: el.id, index, blades, warning: at(WARNING_AT.x, WARNING_AT.y) }];
    });
  }, [circuit, layout]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let handle = 0;
    const draw = () => {
      handle = requestAnimationFrame(draw);
      const frame = frameRef.current;
      if (!frame) return;
      relays.forEach(({ id, index }) => {
        const status = frame.stepRelays[index];
        root.querySelectorAll<SVGGElement>(`[data-step="${id}"]`).forEach((group, k) => group.setAttribute('visibility', status?.contacts[k] ? 'visible' : 'hidden'));
        const text = root.querySelector<SVGTextElement>(`[data-step-warning="${id}"]`);
        if (text) text.textContent = status?.warnings.join(', ') ?? '';
      });
    };
    handle = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(handle);
  }, [frameRef, relays]);

  return (
    <g ref={rootRef} pointerEvents="none" data-testid="step-relay-view">
      {relays.map(({ id, blades, warning }) => (
        <g key={id}>
          {blades.map(({ open, closed, contacts }, k) => (
            <g key={k} data-step={id} visibility="hidden">
              <line x1={open.a.x} y1={open.a.y} x2={open.b.x} y2={open.b.y} stroke="var(--sheet)" strokeWidth={5} strokeLinecap="round" />
              <line x1={closed.a.x} y1={closed.a.y} x2={closed.b.x} y2={closed.b.y} stroke="var(--sch-ink)" strokeWidth={2} strokeLinecap="round" />
              {contacts.map((c, j) => (
                <circle key={j} cx={c.x} cy={c.y} r={2.5} fill="var(--sch-part)" stroke="var(--sch-ink)" strokeWidth={1.5} />
              ))}
            </g>
          ))}
          <text data-step-warning={id} x={warning.x} y={warning.y} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--sch-alert)" style={HALO} />
        </g>
      ))}
    </g>
  );
};
