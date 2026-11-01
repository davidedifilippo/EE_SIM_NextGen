import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AcResult } from '../engine/ngspice';
import { bodeCurve, BodeCurve, bodeSummary, decadeTicks, phaseTicks } from './bode';
import { formatEngineering, formatFixed, nearestIndex, niceTicks } from './chartMath';

export interface AcSeries {
  node: string;
  label: string;
}

interface Props {
  result: AcResult;
  series: AcSeries[];
}

const PLOT_HEIGHT = 170;
const MARGIN = { top: 10, right: 44, bottom: 24, left: 50 };
const MAX_SERIES = 8;
const LABEL_GAP = 13;
/** A node this far down, such as a virtual ground, starts hidden: it would flatten all the other curves. */
const NEGLIGIBLE_DB = -60;

/** One of the two plots: they share the frequency axis and differ in what they draw. */
const Plot: React.FC<{
  width: number;
  frequency: number[];
  curves: { node: string; slot: number; values: number[] }[];
  yTicks: number[];
  yLabel: string;
  formatY: (v: number) => string;
  hoverIndex: number | null;
  onHover: (index: number | null) => void;
  showDirectLabels: boolean;
}> = ({ width, frequency, curves, yTicks, yLabel, formatY, hoverIndex, onHover, showDirectLabels }) => {
  const plotW = Math.max(width - MARGIN.left - MARGIN.right, 60);
  const plotH = PLOT_HEIGHT - MARGIN.top - MARGIN.bottom;
  const [fMin, fMax] = [frequency[0], frequency[frequency.length - 1]];
  const sx = (f: number) => MARGIN.left + (Math.log(f / fMin) / Math.log(fMax / fMin || 10)) * plotW;
  const [yMin, yMax] = [yTicks[0], yTicks[yTicks.length - 1]];
  const sy = (v: number) => MARGIN.top + (1 - (v - yMin) / (yMax - yMin || 1)) * plotH;

  const labels = curves
    .map((c) => ({ node: c.node, y: sy(c.values[c.values.length - 1]) }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + LABEL_GAP);

  const handleMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const f = fMin * (fMax / fMin) ** ((e.clientX - rect.left) / rect.width);
    onHover(nearestIndex(frequency, f));
  };

  return (
    <svg width={width} height={PLOT_HEIGHT} role="img" aria-label={`Diagramma di Bode: ${yLabel}`}>
      {yTicks.map((v) => (
        <g key={v}>
          <line x1={MARGIN.left} x2={MARGIN.left + plotW} y1={sy(v)} y2={sy(v)} className={v === 0 ? 'viz-zero' : 'viz-grid'} />
          <text x={MARGIN.left - 6} y={sy(v) + 4} textAnchor="end" className="viz-tick">
            {formatY(v)}
          </text>
        </g>
      ))}
      {decadeTicks(fMin, fMax).map((f) => (
        <g key={f}>
          <line x1={sx(f)} x2={sx(f)} y1={MARGIN.top} y2={MARGIN.top + plotH} className="viz-grid" />
          <text x={sx(f)} y={PLOT_HEIGHT - 8} textAnchor="middle" className="viz-tick">
            {formatEngineering(f, 'Hz')}
          </text>
        </g>
      ))}
      {curves.map((c) => (
        <path
          key={c.node}
          d={c.values.map((v, i) => `${i === 0 ? 'M' : 'L'}${sx(frequency[i]).toFixed(1)} ${sy(v).toFixed(1)}`).join('')}
          fill="none"
          stroke={`var(--series-${c.slot})`}
          strokeWidth={2}
          strokeLinejoin="round"
        />
      ))}
      {showDirectLabels &&
        labels.map((l) => (
          <text key={l.node} x={MARGIN.left + plotW + 6} y={l.y + 4} className="viz-direct">
            {l.node}
          </text>
        ))}
      {hoverIndex !== null && (
        <g pointerEvents="none">
          <line x1={sx(frequency[hoverIndex])} x2={sx(frequency[hoverIndex])} y1={MARGIN.top} y2={MARGIN.top + plotH} className="viz-crosshair" />
          {curves.map((c) => (
            <circle key={c.node} cx={sx(frequency[hoverIndex])} cy={sy(c.values[hoverIndex])} r={4} fill={`var(--series-${c.slot})`} stroke="var(--surface-1)" strokeWidth={2} />
          ))}
        </g>
      )}
      <rect
        x={MARGIN.left}
        y={MARGIN.top}
        width={plotW}
        height={plotH}
        fill="transparent"
        style={{ touchAction: 'pan-y' }}
        onPointerMove={handleMove}
        onPointerDown={handleMove}
        onPointerLeave={() => onHover(null)}
      />
    </svg>
  );
};

/** Gain and phase against frequency, in two plots: decibels and degrees never share an axis. */
export const BodeChart: React.FC<Props> = ({ result, series }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  // The chart is keyed by its run, so this holds for each new one
  const [hidden, setHidden] = useState<Set<string>>(() => {
    const low = series.filter((s) => {
      const v = result.voltages.get(s.node)!;
      return Math.max(...bodeCurve(v.re, v.im).gain) < NEGLIGIBLE_DB;
    });
    return new Set(low.map((s) => s.node));
  });
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(entry.contentRect.width, 240)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { frequency } = result;
  const plotted = useMemo(
    () =>
      series.slice(0, MAX_SERIES).map((s, i) => {
        const v = result.voltages.get(s.node)!;
        const curve: BodeCurve = bodeCurve(v.re, v.im);
        return { ...s, slot: i + 1, ...curve, summary: bodeSummary(frequency, curve.gain) };
      }),
    [result, series, frequency],
  );
  const visible = plotted.filter((s) => !hidden.has(s.node));

  const range = (pick: (s: (typeof plotted)[number]) => number[]) => {
    const values = visible.flatMap(pick);
    return values.length > 0 ? [Math.min(...values), Math.max(...values)] : [0, 1];
  };
  const [gainMin, gainMax] = range((s) => s.gain);
  const [phaseMin, phaseMax] = range((s) => s.phase);
  const gainTicks = niceTicks(gainMin, gainMax, 6);
  const angleTicks = phaseTicks(phaseMin, phaseMax);

  const toggle = (node: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(node)) next.delete(node);
      else next.add(node);
      return next;
    });

  const describe = ({ summary: s }: (typeof plotted)[number]) => {
    const parts = [`max ${formatFixed(s.peak, 1)} dB a ${formatEngineering(s.peakFrequency, 'Hz')}`];
    if (s.lower !== null) parts.push(`−3 dB in basso a ${formatEngineering(s.lower, 'Hz')}`);
    if (s.upper !== null) parts.push(`−3 dB in alto a ${formatEngineering(s.upper, 'Hz')}`);
    return parts.join(' · ');
  };

  const tableRows = useMemo(() => {
    const step = Math.max(1, Math.floor(frequency.length / 25));
    return frequency.flatMap((_, i) => (i % step === 0 ? [i] : []));
  }, [frequency]);
  const hoverX = hoverIndex === null ? 0 : MARGIN.left + (Math.log(frequency[hoverIndex] / frequency[0]) / Math.log(frequency[frequency.length - 1] / frequency[0] || 10)) * (width - MARGIN.left - MARGIN.right);

  return (
    <div className="viz-root" ref={rootRef}>
      <div className="viz-header">
        <strong>Diagramma di Bode, con 1 V di ingresso sui generatori di segnale</strong>
        <button className="link-button" onClick={() => setShowTable((v) => !v)}>
          {showTable ? 'Mostra grafico' : 'Mostra tabella'}
        </button>
      </div>

      <div className="viz-legend bode-legend">
        {plotted.map((s) => (
          <button key={s.node} className={`viz-legend-item ${hidden.has(s.node) ? 'off' : ''}`} aria-pressed={!hidden.has(s.node)} onClick={() => toggle(s.node)}>
            <span className="viz-swatch" style={{ background: `var(--series-${s.slot})` }} />
            {s.label}
            <span className="scope-measures">{describe(s)}</span>
          </button>
        ))}
        {series.length > MAX_SERIES && <span className="viz-note">Altri {series.length - MAX_SERIES} nodi non mostrati</span>}
      </div>

      {showTable ? (
        <div className="viz-table-wrap">
          <table className="viz-table">
            <thead>
              <tr>
                <th>Frequenza</th>
                {plotted.map((s) => (
                  <th key={s.node}>
                    {s.node}: dB, gradi
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((i) => (
                <tr key={i}>
                  <td>{formatEngineering(frequency[i], 'Hz')}</td>
                  {plotted.map((s) => (
                    <td key={s.node}>
                      {formatFixed(s.gain[i], 2)}, {formatFixed(s.phase[i], 1)}°
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="viz-plot">
          <Plot
            width={width}
            frequency={frequency}
            curves={visible.map((s) => ({ node: s.node, slot: s.slot, values: s.gain }))}
            yTicks={gainTicks}
            yLabel="guadagno in dB"
            formatY={(v) => `${formatFixed(v, Number.isInteger(v) ? 0 : 1)} dB`}
            hoverIndex={hoverIndex}
            onHover={setHoverIndex}
            showDirectLabels={visible.length <= 4}
          />
          <Plot
            width={width}
            frequency={frequency}
            curves={visible.map((s) => ({ node: s.node, slot: s.slot, values: s.phase }))}
            yTicks={angleTicks}
            yLabel="fase in gradi"
            formatY={(v) => `${v}°`}
            hoverIndex={hoverIndex}
            onHover={setHoverIndex}
            showDirectLabels={visible.length <= 4}
          />
          {hoverIndex !== null && (
            <div className="viz-tooltip" style={hoverX > width / 2 ? { right: width - hoverX + 10 } : { left: hoverX + 10 }}>
              <div className="viz-tooltip-title">{formatEngineering(frequency[hoverIndex], 'Hz')}</div>
              {visible.map((s) => (
                <div key={s.node} className="viz-tooltip-row">
                  <span className="viz-swatch" style={{ background: `var(--series-${s.slot})` }} />
                  <span>{s.node}</span>
                  <strong>
                    {formatFixed(s.gain[hoverIndex], 2)} dB, {formatFixed(s.phase[hoverIndex], 1)}°
                  </strong>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
