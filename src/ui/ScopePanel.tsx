import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MIN_SAMPLES_PER_PERIOD, samplesPerPeriod, speedLabel } from '../realtime/liveRate';
import { formatEngineering, formatSi, niceTicks, pickTimeUnit } from './chartMath';
import { ScopeBuffer } from './scopeBuffer';
import { ScopeUnit, unitOf, ScopeTrace } from './scopeTraces';

interface Props {
  traces: ScopeTrace[];
  labels: Map<string, string>;
  bufferRef: React.MutableRefObject<ScopeBuffer>;
  /** Simulated seconds per real second. */
  speed: number;
  /** Period of the fastest generator, to say when the speed is too high to draw it. */
  signalPeriod: number | null;
  onRemove: (id: string) => void;
}

/** Two plots share the room of the panel. */
const plotHeightFor = (plots: number) => (plots > 1 ? 104 : 140);
/** Height of each trace of its own, as on a logic analyser: enough to tell a 0 from a 1. */
const LANE_HEIGHT = 34;

/**
 * Where a value goes on a plot: on the whole height, or in the lane of its trace, from the top, with a
 * margin so that the 1 of one lane does not touch the 0 of the next.
 */
export function laneY(value: number, lo: number, hi: number, top: number, height: number, lane: number | null, lanes: number): number {
  const fraction = 1 - (value - lo) / (hi - lo || 1);
  if (lane === null) return top + fraction * height;
  const laneHeight = height / lanes;
  const pad = laneHeight * 0.18;
  return top + lane * laneHeight + pad + fraction * (laneHeight - 2 * pad);
}
const MARGIN = { top: 8, right: 12, bottom: 22, left: 58 };
/** How long a sweep lasts on screen, as the time menu offers it. */
/** Seconds of real time across the screen. The short ones show a few periods of a fast signal, kept still by the trigger. */
const SWEEPS_SECONDS = [0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 4, 10];
const DEFAULT_SWEEP_SECONDS = 2;
/** Periods of the fastest signal the window shows until the viewer picks one: enough to see its shape. */
const PERIODS_IN_VIEW = 4;

/** How many points fall in a period, in words: below one there is not even a point for each period. */
const pointsText = (samples: number) => (samples < 1 ? 'meno di un punto' : Math.round(samples) === 1 ? 'un solo punto' : `solo ${Math.round(samples)} punti`);

/** The shortest window that holds a few periods, or the usual one with no signal to follow. */
function sweepFor(period: number | null, speed: number): number {
  if (period === null) return DEFAULT_SWEEP_SECONDS;
  return SWEEPS_SECONDS.find((seconds) => speed * seconds >= PERIODS_IN_VIEW * period) ?? SWEEPS_SECONDS[SWEEPS_SECONDS.length - 1];
}
const STATS_EVERY_MS = 250;
const AUTO_TRIGGER = 'auto';

/**
 * The trace the automatic trigger follows: the one with the fewest rising edges, among those that have
 * some. On a counter it is the most significant bit, which repeats once a cycle; with an input and what
 * a circuit makes of it, usually the input. Null when no trace has an edge.
 *
 * The current choice stays unless another trace is clearly slower: two traces that both repeat once a
 * cycle, as two bits of a counter, differ by one edge depending on where the buffer starts.
 */
export function slowestChannel(buffer: ScopeBuffer, channels: number, current: number | null = null): number | null {
  const edges = Array.from({ length: channels }, (_, channel) => buffer.risingEdges(channel));
  let best: number | null = null;
  edges.forEach((count, channel) => {
    if (count > 0 && (best === null || count < edges[best])) best = channel;
  });
  if (best === null || current === null || current >= channels || edges[current] === 0) return best;
  // Fewer by a share and by at least two: with few edges in the buffer, one more or less means nothing
  return edges[best] < edges[current] * CLEARLY_SLOWER && edges[current] - edges[best] >= 2 ? best : current;
}

/** How many fewer edges another trace needs to take over the automatic trigger. */
const CLEARLY_SLOWER = 0.7;

/**
 * Where a triggered sweep starts: on the latest edge that fills it, or else where the last one started,
 * as long as the buffer still holds it, as an oscilloscope keeps the last sweep on screen. Null before
 * any edge: then the trace runs free.
 */
export function triggeredStart(buffer: ScopeBuffer, span: number, held: number | null, channel = 0, pretrigger = 0): number | null {
  const found = buffer.triggerStart(channel, span, pretrigger);
  if (found !== null) return found;
  const oldest = buffer.oldestTime;
  const latest = buffer.latestTime;
  return held !== null && oldest !== null && latest !== null && held >= oldest && held + span <= latest ? held : null;
}

/** The short name of a lane, for the narrow margin: the pin of a part without the V( ), or the start of the name. */
const laneName = (label: string) => {
  const pin = /^V\((.+)\)$/.exec(label)?.[1] ?? label;
  return pin.length > 9 ? pin.slice(pin.length - 9) : pin;
};
const UNIT_NAMES: Record<ScopeUnit, string> = { V: 'Tensione (V)', A: 'Corrente (A)' };

const buildPath = (columns: Float64Array, width: number, toY: (v: number) => number): string => {
  const count = columns.length / 2;
  let path = '';
  for (let c = 0; c < count; c++) {
    const [min, max] = [columns[c * 2], columns[c * 2 + 1]];
    if (Number.isNaN(min)) continue;
    const x = (MARGIN.left + (c * width) / count).toFixed(1);
    path += `${path ? 'L' : 'M'}${x} ${toY(min).toFixed(1)}`;
    if (max !== min) path += `L${x} ${toY(max).toFixed(1)}`;
  }
  return path;
};

/** Live traces of the running circuit, on one plot per unit: volts and amperes never share an axis. */
export const ScopePanel: React.FC<Props> = ({ traces, labels, bufferRef, speed, signalPeriod, onRemove }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [pickedSweep, setPickedSweep] = useState<number | null>(null);
  // Follows the signal until the viewer chooses a window: then it stays where it was put
  const sweepSeconds = pickedSweep ?? Math.min(DEFAULT_SWEEP_SECONDS, sweepFor(signalPeriod, speed));
  const [isTriggered, setIsTriggered] = useState(true);
  // The trace the trigger follows: the first until the viewer picks another, and the first again if that one goes
  const [pickedTriggerId, setPickedTriggerId] = useState<string>(AUTO_TRIGGER);
  // For the automatic choice: the slowest trace, found again a few times a second
  const [slowestId, setSlowestId] = useState<string | null>(null);
  const triggerTrace = traces.find((t) => t.id === (pickedTriggerId === AUTO_TRIGGER ? slowestId : pickedTriggerId)) ?? traces[0];
  const triggerChannel = triggerTrace ? traces.indexOf(triggerTrace) : -1;
  // Separate lanes for the voltages: by itself when they are all outputs of logic parts, until the viewer chooses
  const [pickedSeparate, setPickedSeparate] = useState<boolean | null>(null);
  const voltageTraces = traces.filter((t) => unitOf(t) === 'V');
  const canSeparate = voltageTraces.length > 1;
  const isSeparate = canSeparate && (pickedSeparate ?? voltageTraces.every((t) => t.kind === 'pin'));
  const laneOf = useMemo(() => new Map(isSeparate ? voltageTraces.map((t, k) => [t.id, k]) : []), [isSeparate, voltageTraces.map((t) => t.id).join()]);
  const [axes, setAxes] = useState<Partial<Record<ScopeUnit, number[]>>>({});
  const [measures, setMeasures] = useState<Map<string, string>>(new Map());
  const hoverRef = useRef<number | null>(null);

  const units = useMemo(() => (['V', 'A'] as ScopeUnit[]).filter((u) => traces.some((t) => unitOf(t) === u)), [traces]);
  const span = speed * sweepSeconds;
  const plotWidth = Math.max(width - MARGIN.left - MARGIN.right, 60);
  const baseHeight = plotHeightFor(units.length) - MARGIN.top - MARGIN.bottom;
  const plotHeightOf = (unit: ScopeUnit) => (unit === 'V' && isSeparate ? Math.max(baseHeight, voltageTraces.length * LANE_HEIGHT) : baseHeight);
  const vHeight = plotHeightOf('V');

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(entry.contentRect.width, 240)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let handle = 0;
    let lastStats = 0;
    const currentAxes = new Map<ScopeUnit, number[]>();
    // The start of the last triggered sweep, kept while no new edge comes
    let heldStart: number | null = null;
    let slowestNow = slowestId;

    const draw = (now: number) => {
      handle = requestAnimationFrame(draw);
      const buffer = bufferRef.current;
      const latest = buffer.latestTime;
      if (latest === null) return;
      const t0 = isTriggered && triggerChannel >= 0 ? (heldStart = triggeredStart(buffer, span, heldStart, triggerChannel)) ?? latest - span : latest - span;
      const t1 = t0 + span;
      const columns = traces.map((_, i) => buffer.columns(i, t0, t1, Math.round(plotWidth)));

      let hasNewAxis = false;
      for (const unit of units) {
        let [min, max] = [Infinity, -Infinity];
        traces.forEach((trace, i) => {
          if (unitOf(trace) !== unit) return;
          for (const v of columns[i]) {
            if (v < min) min = v;
            if (v > max) max = v;
          }
        });
        if (min > max) continue;
        if (max - min < 1e-9 * Math.max(Math.abs(max), 1e-9)) max = min;
        const ticks = niceTicks(min, max, 5);
        const old = currentAxes.get(unit);
        if (!old || old.length !== ticks.length || old.some((v, k) => v !== ticks[k])) hasNewAxis = true;
        currentAxes.set(unit, ticks);
      }
      if (hasNewAxis) setAxes(Object.fromEntries(currentAxes));

      traces.forEach((trace, i) => {
        const ticks = currentAxes.get(unitOf(trace));
        const path = root.querySelector<SVGPathElement>(`[data-trace="${trace.slot}"]`);
        if (!ticks || !path) return;
        const [lo, hi] = [ticks[0], ticks[ticks.length - 1]];
        const unit = unitOf(trace);
        const height = unit === 'V' ? vHeight : baseHeight;
        const lane = laneOf.get(trace.id) ?? null;
        path.setAttribute('d', buildPath(columns[i], plotWidth, (v) => laneY(v, lo, hi, MARGIN.top, height, lane, laneOf.size)));
      });

      const hover = hoverRef.current;
      const tooltip = root.querySelector<HTMLDivElement>('[data-scope-tooltip]');
      root.querySelectorAll<SVGLineElement>('[data-crosshair]').forEach((line) => {
        line.style.display = hover === null ? 'none' : '';
        if (hover !== null) {
          line.setAttribute('x1', String(MARGIN.left + hover * plotWidth));
          line.setAttribute('x2', String(MARGIN.left + hover * plotWidth));
        }
      });
      if (tooltip) {
        tooltip.hidden = hover === null;
        if (hover !== null) {
          const t = t0 + hover * span;
          const unit = pickTimeUnit(span);
          const rows = traces.map((trace, i) => `${labels.get(trace.id)}: ${formatEngineering(buffer.sampleAt(i, t) ?? 0, unitOf(trace))}`);
          tooltip.textContent = [`${formatSi((hover * span) / unit.factor)} ${unit.symbol}`, ...rows].join('\n');
          const x = MARGIN.left + hover * plotWidth;
          tooltip.style.left = x > plotWidth / 2 ? '' : `${x + 10}px`;
          tooltip.style.right = x > plotWidth / 2 ? `${plotWidth + MARGIN.left + MARGIN.right - x + 10}px` : '';
        }
      }

      if (now - lastStats > STATS_EVERY_MS) {
        lastStats = now;
        const current = traces.findIndex((t) => t.id === slowestNow);
        const slowest = slowestChannel(buffer, traces.length, current >= 0 ? current : null);
        slowestNow = slowest === null ? null : traces[slowest].id;
        setSlowestId(slowestNow);
        const next = new Map<string, string>();
        traces.forEach((trace, i) => {
          const s = buffer.stats(i, t0, t1);
          if (!s) return;
          const u = unitOf(trace);
          const f = (v: number) => formatEngineering(v, u);
          const parts = s.max - s.min < 1e-9 * Math.max(Math.abs(s.max), 1e-9) ? [f(s.mean)] : [`max ${f(s.max)}`, `min ${f(s.min)}`, `pp ${f(s.max - s.min)}`, `media ${f(s.mean)}`, `RMS ${f(s.rms)}`];
          if (s.frequency !== null) parts.push(formatEngineering(s.frequency, 'Hz'));
          next.set(trace.id, parts.join(' · '));
        });
        setMeasures(next);
      }
    };
    handle = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(handle);
  }, [traces, labels, units, span, isTriggered, triggerChannel, plotWidth, baseHeight, vHeight, laneOf, bufferRef]);

  const onHover = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    hoverRef.current = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  };

  const timeUnit = pickTimeUnit(span);
  const xTicks = niceTicks(0, span, Math.max(3, Math.floor(plotWidth / 90))).filter((t) => t <= span * 1.0001);

  return (
    <section className="scope-panel viz-root" ref={rootRef} aria-label="Oscilloscopio">
      {signalPeriod !== null && samplesPerPeriod(signalPeriod, speed) < MIN_SAMPLES_PER_PERIOD && (
        <p className="scope-warning" role="status">
          Segnale da {formatEngineering(1 / signalPeriod, 'Hz')} troppo veloce per {speedLabel(speed)}: {pointsText(samplesPerPeriod(signalPeriod, speed))} per periodo, la traccia non è fedele.
          Scegli una velocità più lenta, o Automatica, oppure usa l'Analisi precisa.
        </p>
      )}
      <div className="scope-header">
        <strong>Oscilloscopio</strong>
        <label>
          Finestra
          <select value={sweepSeconds} onChange={(e) => setPickedSweep(Number(e.target.value))}>
            {SWEEPS_SECONDS.map((seconds) => {
              const unit = pickTimeUnit(speed * seconds);
              return (
                <option key={seconds} value={seconds}>
                  {formatSi((speed * seconds) / unit.factor)} {unit.symbol}
                </option>
              );
            })}
          </select>
        </label>
        <label title="Ogni scansione parte da un fronte di salita della traccia di riferimento, a metà della sua escursione, così un segnale periodico sta fermo">
          <input type="checkbox" checked={isTriggered} onChange={(e) => setIsTriggered(e.target.checked)} />
          Trigger
        </label>
        {isTriggered && traces.length > 1 && (
          <label title="La traccia di riferimento. Automatico sceglie la più lenta: per un contatore il bit più significativo, che si ripete una volta per ciclo">
            su
            <select value={traces.some((t) => t.id === pickedTriggerId) ? pickedTriggerId : AUTO_TRIGGER} onChange={(e) => setPickedTriggerId(e.target.value)}>
              <option value={AUTO_TRIGGER}>Automatico{triggerTrace ? `: ${labels.get(triggerTrace.id)}` : ''}</option>
              {traces.map((trace) => (
                <option key={trace.id} value={trace.id}>
                  {labels.get(trace.id)}
                </option>
              ))}
            </select>
          </label>
        )}
        {canSeparate && (
          <label title="Ogni tensione nella sua fascia, una sotto l'altra, come in un analizzatore logico">
            <input type="checkbox" checked={isSeparate} onChange={(e) => setPickedSeparate(e.target.checked)} />
            Tracce separate
          </label>
        )}
      </div>

      <ul className="scope-traces">
        {traces.map((trace) => (
          <li key={trace.id}>
            <span className="viz-swatch" style={{ background: `var(--series-${trace.slot})` }} />
            <strong>{labels.get(trace.id)}</strong>
            <span className="scope-measures">{measures.get(trace.id) ?? ''}</span>
            <button aria-label={`Togli ${labels.get(trace.id)}`} title="Togli la traccia" onClick={() => onRemove(trace.id)}>
              ×
            </button>
          </li>
        ))}
      </ul>

      <div className="scope-plots">
        {units.map((unit, index) => {
          const ticks = axes[unit] ?? [0, 1];
          const [lo, hi] = [ticks[0], ticks[ticks.length - 1]];
          const plotHeight = plotHeightOf(unit);
          const totalHeight = plotHeight + MARGIN.top + MARGIN.bottom;
          const toY = (v: number) => MARGIN.top + (1 - (v - lo) / (hi - lo || 1)) * plotHeight;
          const isLast = index === units.length - 1;
          const lanes = unit === 'V' && isSeparate ? voltageTraces : [];
          return (
            <svg key={unit} width={width} height={totalHeight} role="img" aria-label={`Andamento nel tempo: ${UNIT_NAMES[unit]}`}>
              {/* Each lane: its name on the left, a line at its 0 and a fainter one at its top */}
              {lanes.map((trace, k) => {
                const [y0, y1] = [laneY(lo, lo, hi, MARGIN.top, plotHeight, k, lanes.length), laneY(hi, lo, hi, MARGIN.top, plotHeight, k, lanes.length)];
                return (
                  <g key={trace.id}>
                    <line x1={MARGIN.left} x2={MARGIN.left + plotWidth} y1={y0} y2={y0} className="viz-zero" />
                    <line x1={MARGIN.left} x2={MARGIN.left + plotWidth} y1={y1} y2={y1} className="viz-grid" />
                    <text x={MARGIN.left - 6} y={(y0 + y1) / 2 + 4} textAnchor="end" className="viz-tick">
                      {laneName(labels.get(trace.id) ?? '')}
                    </text>
                  </g>
                );
              })}
              {lanes.length === 0 && ticks.map((v) => (
                <g key={v}>
                  <line x1={MARGIN.left} x2={MARGIN.left + plotWidth} y1={toY(v)} y2={toY(v)} className={v === 0 ? 'viz-zero' : 'viz-grid'} />
                  <text x={MARGIN.left - 6} y={toY(v) + 4} textAnchor="end" className="viz-tick">
                    {formatEngineering(v, unit)}
                  </text>
                </g>
              ))}
              {xTicks.map((t) => (
                <text key={t} x={MARGIN.left + (t / span) * plotWidth} y={totalHeight - 8} textAnchor="middle" className="viz-tick">
                  {isLast ? formatSi(t / timeUnit.factor) + (t === 0 ? ` ${timeUnit.symbol}` : '') : ''}
                </text>
              ))}
              {traces
                .filter((trace) => unitOf(trace) === unit)
                .map((trace) => (
                  <path key={trace.id} data-trace={trace.slot} fill="none" stroke={`var(--series-${trace.slot})`} strokeWidth={2} strokeLinejoin="round" />
                ))}
              <line data-crosshair y1={MARGIN.top} y2={MARGIN.top + plotHeight} className="viz-crosshair" style={{ display: 'none' }} />
              <rect
                x={MARGIN.left}
                y={MARGIN.top}
                width={plotWidth}
                height={plotHeight}
                fill="transparent"
                style={{ touchAction: 'pan-y' }}
                onPointerMove={onHover}
                onPointerDown={onHover}
                onPointerLeave={() => (hoverRef.current = null)}
              />
            </svg>
          );
        })}
        <div data-scope-tooltip className="viz-tooltip scope-tooltip" hidden />
      </div>
    </section>
  );
};
