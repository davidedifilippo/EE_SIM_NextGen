import React, { useEffect, useMemo, useRef } from 'react';
import { getDevice } from '../library/devices';
import { Circuit } from '../model/types';
import { LiveFrame, LiveLayout } from '../realtime/liveSimulation';
import { SEGMENT_LINES, segmentColor } from '../realtime/display7';
import { localToWorld } from '../utils/geometry';
import { LAMP_OVERVOLTAGE, lampBrightness, lampRating } from '../realtime/lamp';

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

export const LED_COLORS: Record<string, string> = {
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
    return layout.devices.flatMap((device, index) => {
      // The parts inside a block have no drawing of their own
      const el = byId.get(device.elementId);
      if (!el) return [];
      const def = getDevice(el.def);
      if (def?.spice.kind !== 'logic') return [];
      // An SR says when both its inputs are high: below the box, clear of its name above
      const isSR = def.spice.gate === 'srff' || def.spice.gate === 'srlatch';
      const below = Math.max(...def.terminals.map((t) => Math.abs(t.y))) + 34;
      return [{ device, index, warning: isSR ? localToWorld(el.x, el.y, { x: 0, y: below }, el.rot, el.flip) : null }];
    });
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
        // Q and its complement both at 0 happen only with S and R both at 1
        const warning = groups[i]?.querySelector('text');
        if (warning) warning.textContent = levels && !levels[0] && !levels[1] ? 'S = R = 1: combinazione vietata' : '';
      });
    };
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [frameRef, parts]);

  return (
    <g ref={rootRef} pointerEvents="none" data-testid="logic-levels">
      {parts.map(({ device, warning }) => (
        <g key={device.elementId} data-logic={device.elementId}>
          {device.terminals.map((p, k) => (
            <circle key={k} cx={p.x} cy={p.y} r={4.5} className="logic-low" />
          ))}
          {warning && <text x={warning.x} y={warning.y} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--sch-alert)" style={{ paintOrder: 'stroke', stroke: 'var(--sch-halo)', strokeWidth: 3 }} />}
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
      // The parts inside a block have no drawing of their own
      const el = byId.get(device.elementId);
      if (!el) return [];
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
      // The mean since the last frame: a PWM faster than the frames shows as a dimmer light, not a flicker
      leds.forEach(({ index }, i) => {
        const mean = frame.glowMean[index];
        glows[i]?.setAttribute('opacity', String(0.75 * ledBrightness(Number.isNaN(mean) ? frame.deviceCurrent[index] : mean)));
      });
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

/**
 * The light of each lamp, from the power it takes against its rating; in red above it, when its voltage
 * is more than a real one would stand for long.
 */
export const LampGlow: React.FC<Props> = ({ circuit, layout, frameRef }) => {
  const rootRef = useRef<SVGGElement>(null);
  const lamps = useMemo(() => {
    const byId = new Map(circuit.elements.map((el) => [el.id, el]));
    return layout.devices.flatMap((device, index) => {
      // The parts inside a block have no drawing of their own
      const el = byId.get(device.elementId);
      if (!el) return [];
      const def = getDevice(el.def);
      if (def?.spice.kind !== 'lamp') return [];
      const rating = lampRating(el, def.spice);
      return rating ? [{ el, index, rated: rating.power, volts: rating.volts }] : [];
    });
  }, [circuit, layout]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const glows = [...root.querySelectorAll<SVGCircleElement>('circle')];
    const warnings = [...root.querySelectorAll<SVGTextElement>('text')];
    const refresh = () => {
      const frame = frameRef.current;
      if (!frame) return;
      lamps.forEach(({ index, rated, volts }, i) => {
        const power = frame.glowMean[index];
        glows[i]?.setAttribute('opacity', String(0.85 * lampBrightness(power, rated)));
        // By the voltage, RMS on alternating current: the inrush of a cold filament is no fault of the supply
        if (warnings[i]) warnings[i].textContent = frame.lampRms[index] > LAMP_OVERVOLTAGE * volts ? 'Oltre la tensione nominale' : '';
      });
    };
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [frameRef, lamps]);

  return (
    <g ref={rootRef} pointerEvents="none" data-testid="lamp-glow">
      {lamps.map(({ el }) => (
        <g key={el.id}>
          <circle cx={el.x} cy={el.y} r={20} fill="#fde047" opacity={0} style={{ filter: 'drop-shadow(0 0 10px #facc15)' }} />
          <text x={el.x} y={el.y - 30} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--sch-alert)" style={{ paintOrder: 'stroke', stroke: 'var(--sch-halo)', strokeWidth: 3 }} />
        </g>
      ))}
    </g>
  );
};

/** The segments of each seven segment display, lit by the current through them, in the colour of the display. */
export const SegmentGlow: React.FC<Props> = ({ circuit, layout, frameRef }) => {
  const rootRef = useRef<SVGGElement>(null);
  const displays = useMemo(() => {
    const byId = new Map(circuit.elements.map((el) => [el.id, el]));
    return layout.devices.flatMap((device, index) => {
      // The parts inside a block have no drawing of their own
      const el = byId.get(device.elementId);
      if (!el) return [];
      return el.def === 'display7' ? [{ el, index, firstDot: device.firstDot, color: segmentColor(el.props.color).color }] : [];
    });
  }, [circuit, layout]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const groups = [...root.querySelectorAll<SVGGElement>('[data-display]')];
    const refresh = () => {
      const frame = frameRef.current;
      if (!frame) return;
      displays.forEach(({ firstDot }, i) => {
        groups[i]?.querySelectorAll('line').forEach((line, k) => line.setAttribute('opacity', String(ledBrightness(frame.dotCurrent[firstDot + k] ?? 0))));
      });
    };
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [frameRef, displays]);

  return (
    <g ref={rootRef} pointerEvents="none" data-testid="segment-glow">
      {displays.map(({ el, color }) => (
        <g key={el.id} data-display={el.id} transform={`translate(${el.x}, ${el.y}) rotate(${el.rot})${el.flip ? ' scale(1, -1)' : ''}`}>
          {SEGMENT_LINES.map(([x1, y1, x2, y2], k) => (
            <line key={k} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={4} strokeLinecap="round" opacity={0} style={{ filter: `drop-shadow(0 0 3px ${color})` }} />
          ))}
        </g>
      ))}
    </g>
  );
};
