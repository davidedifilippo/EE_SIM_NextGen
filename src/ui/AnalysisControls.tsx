import React from 'react';
import { isEngineReady } from '../engine/ngspiceClient';
import { Workbench } from '../workbench/useWorkbench';

/** Kind of analysis, its settings and the button that runs it. */
export const AnalysisControls: React.FC<{ wb: Workbench; className?: string }> = ({ wb, className = 'analysis' }) => (
  <div className={className}>
    <label>
      Analisi
      <select className="analysis-kind" value={wb.analysisKind} onChange={(e) => wb.setAnalysisKind(e.target.value as 'tran' | 'ac' | 'dc')}>
        <option value="tran">Nel tempo</option>
        <option value="ac">In frequenza (AC)</option>
        <option value="dc">In continua (DC sweep)</option>
      </select>
    </label>
    {wb.analysisKind === 'tran' ? (
      <>
        <label>
          Durata
          <input value={wb.stop} onChange={(e) => wb.setStop(e.target.value)} />
        </label>
        <label>
          Passo
          <input value={wb.step} onChange={(e) => wb.setStep(e.target.value)} />
        </label>
      </>
    ) : wb.analysisKind === 'dc' ? (
      <>
        <label>
          Varia
          <select value={wb.sweptId} onChange={(e) => wb.setDcSource(e.target.value)}>
            {wb.generators.map((g) => (
              <option key={g.id} value={g.id}>
                {g.tag}
              </option>
            ))}
          </select>
        </label>
        <label>
          Da (V)
          <input value={wb.dcFrom} onChange={(e) => wb.setDcFrom(e.target.value)} />
        </label>
        <label>
          A (V)
          <input value={wb.dcTo} onChange={(e) => wb.setDcTo(e.target.value)} />
        </label>
        <label>
          Passo
          <input value={wb.dcStep} onChange={(e) => wb.setDcStep(e.target.value)} />
        </label>
        <label title="Una curva per ogni valore di un secondo generatore">
          Famiglia
          <select value={wb.familyId} onChange={(e) => wb.setDcFamilySource(e.target.value)}>
            <option value="">Nessuna</option>
            {wb.generators
              .filter((g) => g.id !== wb.sweptId)
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {g.tag}
                </option>
              ))}
          </select>
        </label>
        {wb.familyId && (
          <>
            <label>
              Da (V)
              <input value={wb.dcFamilyFrom} onChange={(e) => wb.setDcFamilyFrom(e.target.value)} />
            </label>
            <label>
              A (V)
              <input value={wb.dcFamilyTo} onChange={(e) => wb.setDcFamilyTo(e.target.value)} />
            </label>
            <label>
              Passo
              <input value={wb.dcFamilyStep} onChange={(e) => wb.setDcFamilyStep(e.target.value)} />
            </label>
          </>
        )}
      </>
    ) : (
      <>
        <label>
          Da (Hz)
          <input value={wb.acFrom} onChange={(e) => wb.setAcFrom(e.target.value)} />
        </label>
        <label>
          A (Hz)
          <input value={wb.acTo} onChange={(e) => wb.setAcTo(e.target.value)} />
        </label>
      </>
    )}
    <button className="primary run" onClick={wb.runSimulation} disabled={wb.running}>
      {wb.running ? (isEngineReady() ? 'Analisi…' : 'Carico ngspice…') : 'Analisi precisa'}
    </button>
  </div>
);
