import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DcResult } from '../engine/ngspice';
import { formatEngineering, formatFixed, formatSi, nearestIndex, niceTicks } from './chartMath';
import { PLOT_MARGIN, PlotCurve, XYPlot } from './XYPlot';

export interface DcSeries {
  key: string;
  label: string;
  unit: 'V' | 'A';
  /** One line per value of the second generator. */
  curves: number[][];
}

/** The second generator of a family of curves. */
export interface DcFamily {
  name: string;
  values: number[];
}

interface Props {
  result: DcResult;
  series: DcSeries[];
  xLabel: string;
  family: DcFamily | null;
}

const MAX_SERIES = 8;
const MAX_TOOLTIP_ROWS = 12;

/**
 * A curve that only repeats what is being swept, stays at zero or, in a family, is the second
 * generator's own flat line says nothing: it starts hidden, and the rest gets the room.
 */
export function startsHidden(curves: number[][], x: number[]): boolean {
  const repeatsSweep = curves.every((c) => c.every((v, i) => Math.abs(v - x[i]) < 1e-9));
  const isZero = curves.every((c) => c.every((v) => Math.abs(v) < 1e-12));
  const isFamilyLevel = curves.length > 1 && curves.every((c) => c.every((v) => Math.abs(v - c[0]) < 1e-9));
  return repeatsSweep || isZero || isFamilyLevel;
}

/** The curves against the swept voltage, with one plot per unit: volts and amperes never share an axis. */
export const DcSweepChart: React.FC<Props> = ({ result, series, xLabel, family }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  // The chart is keyed by its run, so this holds for each new one
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(series.filter((s) => startsHidden(s.curves, result.x)).map((s) => s.key)));
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(entry.contentRect.width, 240)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { x } = result;
  const plotted = useMemo(() => series.slice(0, MAX_SERIES).map((s, i) => ({ ...s, slot: i + 1 })), [series]);
  const visible = plotted.filter((s) => !hidden.has(s.key));
  const [xMin, xMax] = [x[0], x[x.length - 1]];
  const xFraction = (v: number) => (v - xMin) / (xMax - xMin || 1);
  const xTicks = niceTicks(xMin, xMax, Math.max(3, Math.floor((width - PLOT_MARGIN.left - PLOT_MARGIN.right) / 90)))
    .filter((v) => v >= xMin - 1e-12 && v <= xMax + 1e-12)
    .map((value) => ({ value, label: formatEngineering(value, 'V') }));

  const curveLabel = (k: number) => (family ? `${family.name} = ${formatEngineering(family.values[k], 'V')}` : '');

  const toggle = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const hoverX = hoverIndex === null ? 0 : PLOT_MARGIN.left + xFraction(x[hoverIndex]) * (width - PLOT_MARGIN.left - PLOT_MARGIN.right);
  const tooltipRows = visible.flatMap((s) => s.curves.map((c, k) => ({ key: `${s.key}:${k}`, slot: s.slot, name: family ? `${s.label}, ${curveLabel(k)}` : s.label, value: hoverIndex === null ? 0 : c[hoverIndex], unit: s.unit })));

  const tableRows = useMemo(() => {
    const step = Math.max(1, Math.floor(x.length / 25));
    return x.flatMap((_, i) => (i % step === 0 ? [i] : []));
  }, [x]);
  const tableColumns = visible.flatMap((s) => s.curves.map((c, k) => ({ key: `${s.key}:${k}`, title: family ? `${s.label}, ${curveLabel(k)}` : s.label, values: c, unit: s.unit })));

  return (
    <div className="viz-root" ref={rootRef}>
      <div className="viz-header">
        <strong>Curve al variare di {xLabel}</strong>
        <button className="link-button" onClick={() => setShowTable((v) => !v)}>
          {showTable ? 'Mostra grafico' : 'Mostra tabella'}
        </button>
      </div>

      <div className="viz-legend">
        {plotted.map((s) => (
          <button key={s.key} className={`viz-legend-item ${hidden.has(s.key) ? 'off' : ''}`} aria-pressed={!hidden.has(s.key)} onClick={() => toggle(s.key)}>
            <span className="viz-swatch" style={{ background: `var(--series-${s.slot})` }} />
            {s.label}
          </button>
        ))}
        {series.length > MAX_SERIES && <span className="viz-note">Altri {series.length - MAX_SERIES} non mostrati</span>}
      </div>

      {showTable ? (
        <div className="viz-table-wrap">
          <table className="viz-table">
            <thead>
              <tr>
                <th>{xLabel}</th>
                {tableColumns.map((c) => (
                  <th key={c.key}>{c.title}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((i) => (
                <tr key={i}>
                  <td>{formatFixed(x[i], 3)} V</td>
                  {tableColumns.map((c) => (
                    <td key={c.key}>{formatEngineering(c.values[i], c.unit)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="viz-plot">
          {(['V', 'A'] as const).map((unit) => {
            const own = visible.filter((s) => s.unit === unit);
            if (own.length === 0) return null;
            const all = own.flatMap((s) => s.curves.flat());
            const curves: PlotCurve[] = own.flatMap((s) =>
              s.curves.map((values, k) => ({
                key: `${s.key}:${k}`,
                slot: s.slot,
                values,
                endLabel: family ? formatEngineering(family.values[k], 'V') : s.key,
              })),
            );
            return (
              <XYPlot
                key={unit}
                width={width}
                xs={x}
                xFraction={xFraction}
                indexAt={(fraction) => nearestIndex(x, xMin + fraction * (xMax - xMin))}
                xTicks={xTicks}
                curves={curves}
                yTicks={niceTicks(Math.min(...all), Math.max(...all), 6)}
                yLabel={unit === 'V' ? 'Tensioni in volt' : 'Correnti in ampere'}
                formatY={(v) => (Math.abs(v) < 1e-15 ? `0 ${unit}` : formatEngineering(v, unit))}
                hoverIndex={hoverIndex}
                onHover={setHoverIndex}
                showEndLabels={curves.length <= 12}
              />
            );
          })}
          {hoverIndex !== null && (
            <div className="viz-tooltip" style={hoverX > width / 2 ? { right: width - hoverX + 10 } : { left: hoverX + 10 }}>
              <div className="viz-tooltip-title">
                {xLabel} = {formatSi(x[hoverIndex])} V
              </div>
              {tooltipRows.slice(0, MAX_TOOLTIP_ROWS).map((row) => (
                <div key={row.key} className="viz-tooltip-row">
                  <span className="viz-swatch" style={{ background: `var(--series-${row.slot})` }} />
                  <span>{row.name}</span>
                  <strong>{formatEngineering(row.value, row.unit)}</strong>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
