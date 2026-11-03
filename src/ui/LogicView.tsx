import React, { useEffect, useMemo, useRef } from 'react';
import { getDevice } from '../library/devices';
import { Circuit } from '../model/types';
import { LiveFrame, LiveLayout } from '../realtime/liveSimulation';

interface Props {
  circuit: Circuit;
  layout: LiveLayout;
  frameRef: React.MutableRefObject<LiveFrame | null>;
}

/** Fast enough for a level to follow a hand on an input, slow enough to cost nothing. */
const REFRESH_MS = 100;

/** Current at which a LED starts to glow, and at which it is fully lit. */
const LED_DIM = 1e-4;
const LED_FULL = 1e-2;

const LED_COLORS: Record<string, string> = {
  LED_ROSSO: '#ef4444',
  LED_GIALLO: '#facc15',
  LED_VERDE: '#22c55e',
  LED_BLU: '#3b82f6',
  LED_BIANCO: '#e2e8f0',
};

/** Brightness between 0 and 1, by decades of current: the eye sees a LED that way. */
export const ledBrightness = (current: number) => Math.min(1, Math.max(0, Math.log10(Math.max(current, 1e-12) / LED_DIM) / Math.log10(LED_FULL / LED_DIM)));

/** A dot on each pin of a gate or input, filled when its level is 1. Updates the dots directly, as LiveOverlay does. */
export const LogicLevels: React.FC<Props> = ({ circuit, layout, frameRef }) => {
  const rootRef = useRef<SVGGElement>(null);
  const parts = useMemo(() => {
    const byId = new Map(circuit.elements.map((el) => [el.id, el]));
    return layout.devices.flatMap((device, index) => (getDevice(byId.get(device.elementId)!.def)?.spice.kind === 'logic' ? [{ device, index }] : []));
  }, [circuit, layout]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const groups = [...root.querySelectorAll<SVGGElement>('[data-logic]')];
    const refresh = () => {
      const frame = frameRef.current;
      if (!frame?.logic) return;
      parts.forEach(({ index }, i) => {
        const levels = frame.logic[index];
        groups[i]?.querySelectorAll('circle').forEach((dot, k) => dot.setAttribute('class', levels?.[k] ? 'logic-high' : 'logic-low'));
      });
    };
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [frameRef, parts]);

  return (
    <g ref={rootRef} pointerEvents="none" data-testid="logic-levels">
      {parts.map(({ device }) => (
        <g key={device.elementId} data-logic={device.elementId}>
          {device.terminals.map((p, k) => (
            <circle key={k} cx={p.x} cy={p.y} r={4.5} className="logic-low" />
          ))}
        </g>
      ))}
    </g>
  );
};

/** The light of each LED, from the current through it. */
export const LedGlow: React.FC<Props> = ({ circuit, layout, frameRef }) => {
  const rootRef = useRef<SVGGElement>(null);
  const leds = useMemo(() => {
    const byId = new Map(circuit.elements.map((el) => [el.id, el]));
    return layout.devices.flatMap((device, index) => {
      const el = byId.get(device.elementId)!;
      return el.def === 'led' ? [{ el, index, color: LED_COLORS[String(el.props.model)] ?? LED_COLORS.LED_ROSSO }] : [];
    });
  }, [circuit, layout]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const glows = [...root.querySelectorAll<SVGCircleElement>('circle')];
    const refresh = () => {
      const frame = frameRef.current;
      if (!frame) return;
      leds.forEach(({ index }, i) => glows[i]?.setAttribute('opacity', String(0.75 * ledBrightness(frame.deviceCurrent[index]))));
    };
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [frameRef, leds]);

  return (
    <g ref={rootRef} pointerEvents="none" data-testid="led-glow">
      {leds.map(({ el, color }) => (
        <circle key={el.id} cx={el.x} cy={el.y} r={17} fill={color} opacity={0} style={{ filter: `drop-shadow(0 0 6px ${color})` }} />
      ))}
    </g>
  );
};
