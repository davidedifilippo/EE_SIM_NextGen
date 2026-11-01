import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AcResult } from '../engine/ngspice';
import { bodeCurve, BodeCurve, bodeSummary, decadeTicks, phaseTicks } from './bode';
import { formatEngineering, formatFixed, nearestIndex, niceTicks } from './chartMath';
import { PLOT_MARGIN as MARGIN, XYPlot } from './XYPlot';

export interface AcSeries {
  node: string;
  label: string;
}

interface Props {
  result: AcResult;
  series: AcSeries[];
}

const MAX_SERIES = 8;
/** A node this far down, such as a virtual ground, starts hidden: it would flatten all the other curves. */
const NEGLIGIBLE_DB = -60;

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
  const [fMin, fMax] = [frequency[0], frequency[frequency.length - 1]];
  const xFraction = (f: number) => Math.log(f / fMin) / Math.log(fMax / fMin || 10);
  const indexAt = (fraction: number) => nearestIndex(frequency, fMin * (fMax / fMin) ** fraction);
  const xTicks = decadeTicks(fMin, fMax).map((value) => ({ value, label: formatEngineering(value, 'Hz') }));

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
          <XYPlot
            width={width}
            xs={frequency}
            xFraction={xFraction}
            indexAt={indexAt}
            xTicks={xTicks}
            curves={visible.map((s) => ({ key: s.node, slot: s.slot, values: s.gain, endLabel: s.node }))}
            yTicks={gainTicks}
            yLabel="guadagno in dB"
            formatY={(v) => `${formatFixed(v, Number.isInteger(v) ? 0 : 1)} dB`}
            hoverIndex={hoverIndex}
            onHover={setHoverIndex}
            showEndLabels={visible.length <= 4}
          />
          <XYPlot
            width={width}
            xs={frequency}
            xFraction={xFraction}
            indexAt={indexAt}
            xTicks={xTicks}
            curves={visible.map((s) => ({ key: s.node, slot: s.slot, values: s.phase, endLabel: s.node }))}
            yTicks={angleTicks}
            yLabel="fase in gradi"
            formatY={(v) => `${v}°`}
            hoverIndex={hoverIndex}
            onHover={setHoverIndex}
            showEndLabels={visible.length <= 4}
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
