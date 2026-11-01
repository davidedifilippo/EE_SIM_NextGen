import React, { useEffect, useRef } from 'react';
import { LiveFrame, LiveLayout } from '../realtime/liveSimulation';

interface Props {
  layout: LiveLayout;
  frameRef: React.MutableRefObject<LiveFrame | null>;
  /** Called on every animation frame with the voltage scale, for the legend. */
  onScale: (maxVoltage: number, frame: LiveFrame | null) => void;
}

/** World units per second of a dot in the wire carrying the largest current. */
const MAX_DOT_SPEED = 90;
const DOT_SPACING = 14;
/** The scales follow the signals but shrink slowly, so they do not pulse with every cycle. */
const SCALE_DECAY_PER_SECOND = 0.7;
const MIN_VOLTAGE_SCALE = 1e-3;
const MIN_CURRENT_SCALE = 1e-9;
/** Below this fraction of the largest current a wire shows no dots. */
const DOT_THRESHOLD = 0.01;
const DOT_COLOR = '#f97316';

/**
 * Draws the currents as moving dots. It updates SVG attributes directly: going through
 * React at animation rate would re-render the whole schematic.
 */
export const LiveOverlay: React.FC<Props> = ({ layout, frameRef, onScale }) => {
  const rootRef = useRef<SVGGElement>(null);
  const onScaleRef = useRef(onScale);
  onScaleRef.current = onScale;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const edgeDots = [...root.querySelectorAll<SVGLineElement>('[data-live="edge-dots"]')];
    const deviceDots = [...root.querySelectorAll<SVGLineElement>('[data-live="device-dots"]')];
    const edgeOffset = new Float64Array(edgeDots.length);
    const deviceOffset = new Float64Array(deviceDots.length);
    let maxV = MIN_VOLTAGE_SCALE;
    let maxI = MIN_CURRENT_SCALE;
    let last = performance.now();
    let lastTime = NaN;
    let handle = 0;

    const moveDots = (dots: SVGLineElement[], offsets: Float64Array, currents: Float64Array, dt: number) => {
      dots.forEach((line, i) => {
        const fraction = (currents[i] ?? 0) / maxI;
        offsets[i] = (offsets[i] - fraction * MAX_DOT_SPEED * dt) % DOT_SPACING;
        line.style.strokeDashoffset = String(offsets[i]);
        line.style.opacity = Math.abs(fraction) < DOT_THRESHOLD ? '0' : '1';
      });
    };

    const draw = (now: number) => {
      handle = requestAnimationFrame(draw);
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      const frame = frameRef.current;
      if (!frame || frame.edgeCurrent.length !== edgeDots.length || frame.deviceCurrent.length !== deviceDots.length) {
        onScaleRef.current(maxV, null);
        return;
      }

      const decay = Math.pow(SCALE_DECAY_PER_SECOND, dt);
      let peakV = 0;
      for (const v of frame.edgeVoltage) peakV = Math.max(peakV, Math.abs(v));
      let peakI = 0;
      for (const i of frame.edgeCurrent) peakI = Math.max(peakI, Math.abs(i));
      for (const i of frame.deviceCurrent) peakI = Math.max(peakI, Math.abs(i));
      maxV = Math.max(peakV, maxV * decay, MIN_VOLTAGE_SCALE);
      maxI = Math.max(peakI, maxI * decay, MIN_CURRENT_SCALE);

      // No new frame means paused: the dots stop with the simulation
      const moving = frame.time !== lastTime;
      lastTime = frame.time;
      if (moving || dt > 0) {
        const step = moving ? dt : 0;
        moveDots(edgeDots, edgeOffset, frame.edgeCurrent, step);
        moveDots(deviceDots, deviceOffset, frame.deviceCurrent, step);
      }
      onScaleRef.current(maxV, frame);
    };
    handle = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(handle);
  }, [layout, frameRef]);

  const dotStyle: React.CSSProperties = { strokeDasharray: `0.1 ${DOT_SPACING - 0.1}`, opacity: 0 };

  return (
    <g ref={rootRef} pointerEvents="none" data-testid="live-overlay">
      {layout.devices.map((d) => (
        <line key={d.elementId} data-live="device-dots" x1={d.a.x} y1={d.a.y} x2={d.b.x} y2={d.b.y} stroke={DOT_COLOR} strokeWidth={4.5} strokeLinecap="round" style={dotStyle} />
      ))}
      {layout.graph.edges.map((e, i) => (
        <line key={i} data-live="edge-dots" x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y} stroke={DOT_COLOR} strokeWidth={4.5} strokeLinecap="round" style={dotStyle} />
      ))}
    </g>
  );
};
