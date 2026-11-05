import React, { useEffect, useMemo, useRef } from 'react';
import { getDevice, RELAY_BLADE } from '../library/devices';
import { Circuit } from '../model/types';
import { LiveFrame, LiveLayout } from '../realtime/liveSimulation';
import { localToWorld } from '../utils/geometry';

interface Props {
  circuit: Circuit;
  layout: LiveLayout;
  frameRef: React.MutableRefObject<LiveFrame | null>;
}

/**
 * The contact of each relay as it stands: pulled in, the blade at rest is covered and the closed one
 * drawn over it, with its two contacts again on top.
 */
export const RelayView: React.FC<Props> = ({ circuit, layout, frameRef }) => {
  const rootRef = useRef<SVGGElement>(null);
  const relays = useMemo(() => {
    const byId = new Map(circuit.elements.map((el) => [el.id, el]));
    return layout.devices.flatMap((device, index) => {
      const el = byId.get(device.elementId)!;
      if (getDevice(el.def)?.spice.kind !== 'relay') return [];
      const at = (x: number, y: number) => localToWorld(el.x, el.y, { x, y }, el.rot, el.flip);
      const line = ({ x1, y1, x2, y2 }: typeof RELAY_BLADE.open) => ({ a: at(x1, y1), b: at(x2, y2) });
      return [{ id: el.id, index, open: line(RELAY_BLADE.open), closed: line(RELAY_BLADE.closed), contacts: [at(20, -14), at(20, 14)] }];
    });
  }, [circuit, layout]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const groups = [...root.querySelectorAll<SVGGElement>('[data-relay]')];
    let handle = 0;
    const draw = () => {
      handle = requestAnimationFrame(draw);
      const frame = frameRef.current;
      if (!frame) return;
      relays.forEach(({ index }, i) => groups[i]?.setAttribute('visibility', frame.relays[index] ? 'visible' : 'hidden'));
    };
    handle = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(handle);
  }, [frameRef, relays]);

  return (
    <g ref={rootRef} pointerEvents="none" data-testid="relay-view">
      {relays.map(({ id, open, closed, contacts }) => (
        <g key={id} data-relay visibility="hidden">
          <line x1={open.a.x} y1={open.a.y} x2={open.b.x} y2={open.b.y} stroke="var(--sheet)" strokeWidth={5} strokeLinecap="round" />
          <line x1={closed.a.x} y1={closed.a.y} x2={closed.b.x} y2={closed.b.y} stroke="var(--sch-ink)" strokeWidth={2} strokeLinecap="round" />
          {contacts.map((c, k) => (
            <circle key={k} cx={c.x} cy={c.y} r={2.5} fill="var(--sch-part)" stroke="var(--sch-ink)" strokeWidth={1.5} />
          ))}
        </g>
      ))}
    </g>
  );
};
