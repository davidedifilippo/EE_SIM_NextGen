import React from 'react';
import { Workbench } from '../workbench/useWorkbench';
import { BodeChart } from './BodeChart';
import { formatEngineering } from './chartMath';
import { DcSweepChart } from './DcSweepChart';
import { RegulatorSummary } from './regulatorPower';
import { TransientChart } from './TransientChart';

/** What each regulator dissipated in the analysis, and whether its protection would act. */
const RegulatorTable: React.FC<{ regulators: RegulatorSummary[] }> = ({ regulators }) => (
  <ul className="regulator-summary">
    {regulators.map((r) => (
      <li key={r.tag} className={r.wouldShutDown ? 'failed' : ''}>
        <strong>
          {r.tag} ({r.name})
        </strong>
        : potenza media {formatEngineering(r.power, 'W')}, giunzione a regime {Math.round(r.temperature)} °C
        {r.wouldShutDown ? '. Interverrebbe la protezione termica: serve un dissipatore o meno caduta' : ''}
      </li>
    ))}
  </ul>
);

/** Errors and charts of the last precise analysis. */
export const ResultsView: React.FC<{ wb: Workbench }> = ({ wb }) => (
  <>
    {wb.errors.length > 0 && (
      <ul className="errors" role="alert">
        {wb.errors.map((err) => (
          <li key={err}>{err}</li>
        ))}
      </ul>
    )}
    {wb.isStale && <p className="stale">Il circuito o l'analisi sono cambiati: il grafico mostra la simulazione precedente.</p>}
    {wb.run?.kind === 'tran' && <TransientChart result={wb.run.result} series={wb.run.series} />}
    {wb.run?.kind === 'tran' && wb.run.regulators.length > 0 && <RegulatorTable regulators={wb.run.regulators} />}
    {wb.run?.kind === 'ac' && <BodeChart key={wb.run.netlist} result={wb.run.result} series={wb.run.series} />}
    {wb.run?.kind === 'dc' && <DcSweepChart key={wb.run.netlist} result={wb.run.result} series={wb.run.series} xLabel={wb.run.xLabel} family={wb.run.family} />}
  </>
);
