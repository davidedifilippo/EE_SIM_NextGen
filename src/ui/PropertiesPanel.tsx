import { TruthTableEditor } from './TruthTableEditor';
import React from 'react';
import { Circuit, Element, SpiceModel } from '../model/types';
import { blockId, canMirror, getDevice } from '../library/devices';
import { ImportedModel } from '../library/modelImport';
import { fitsModelType, modelsOfType } from '../library/models';
import { OPAMP_ROLES, OpAmpRole, readOpAmpRoles, readRegulatorRoles, REGULATOR_ROLES, RegulatorRole, subcircuitPins } from '../library/subcircuit';
import { drawingSign, LiveFrame, LiveLayout, ScopeProbe } from '../realtime/liveSimulation';
import { LiveReadout } from './LiveControls';
import { ArduinoProgram } from './ArduinoProgram';
import { InsideView } from './InsideView';
import { TimerNote } from './TimerView';
import { LampNote } from './LampNote';
import { SsrNote } from './SsrNote';
import { compositeParts } from '../library/composites';
import { CUSTOM_SKETCH } from '../samples/arduino/sketches';
import { ModelImporter } from './ModelImporter';
import { elementProbes, nodeWire, wireProbe } from './scopeTraces';
import { SourceInspector } from './SourceInspector';
import { RangeSlider, ValueSlider } from './ValueSlider';

interface Props {
  circuit: Circuit;
  selectedIds: Set<string>;
  onChange: (next: Circuit, record?: boolean) => void;
  onMirrorSelected: () => void;
  onSelectAll: () => void;
  onDeleteSelected: () => void;
  /** Null with nothing to paste. */
  onPaste: (() => void) | null;
  layout: LiveLayout | null;
  frameRef: React.MutableRefObject<LiveFrame | null>;
  library: SpiceModel[];
  onImportModels: (models: ImportedModel[]) => boolean;
  onRemoveModel: (name: string) => void;
  scopeIds: Set<string>;
  isScopeFull: boolean;
  onToggleProbe: (probe: ScopeProbe) => void;
  /** Opens the inside of a block as a circuit of its own. */
  onOpenBlock?: (id: string) => void;
}

const OPAMP_LABELS: Record<OpAmpRole, string> = { plus: 'Ingresso +', minus: 'Ingresso −', high: 'Alimentazione +', low: 'Alimentazione −', out: 'Uscita' };
const REGULATOR_LABELS: Record<RegulatorRole, string> = { in: 'Ingresso', ref: 'Massa o ADJ', out: 'Uscita' };

/** Which pin of a manufacturer's model does what. Names rarely tell, and the order is only a habit. */
function ModelPins<Role extends string>({ pins, roles, allRoles, labels, onChange }: { pins: string[]; roles: Role[]; allRoles: Role[]; labels: Record<Role, string>; onChange: (next: string) => void }) {
  // Giving a pin the role of another swaps them, so that each role always stays on one pin
  const assign = (index: number, role: Role) => onChange(roles.map((r, k) => (k === index ? role : r === role ? roles[index] : r)).join(' '));
  return (
    <details className="model-library">
      <summary>Piedini del modello</summary>
      {pins.map((pin, k) => (
        <label key={pin}>
          {pin}
          <select value={roles[k]} onChange={(e) => assign(k, e.target.value as Role)}>
            {allRoles.map((role) => (
              <option key={role} value={role}>
                {labels[role]}
              </option>
            ))}
          </select>
        </label>
      ))}
    </details>
  );
}

/** How each part with a memory behaves, as the datasheets give it. */
const SEQUENTIAL_NOTES: Partial<Record<string, string>> = {
  dff: 'Sul fronte di salita di CLK, Q prende il valore di D. S e R agiscono subito, senza clock; con entrambi prevale R.',
  tff: 'Sul fronte di salita di CLK: con T = 1 Q si inverte, con T = 0 resta com\'è. S e R agiscono subito; con entrambi prevale R.',
  jkff: 'Sul fronte di salita di CLK: J K = 0 0 tiene, 0 1 azzera, 1 0 porta a 1, 1 1 inverte. S e R agiscono subito; con entrambi prevale R.',
  srff: 'Sul fronte di salita di CLK: S porta Q a 1, R lo porta a 0, con S = R = 0 tiene. S = R = 1 sul fronte è vietato: Q e Q̄ vanno entrambe a 0 fino al prossimo fronte valido.',
  srlatch: 'Senza clock: S = 1 porta Q a 1, R = 1 lo porta a 0, con entrambi a 0 tiene. Con S = R = 1, vietato, Q e Q̄ vanno a 0; tornando a 0 0 resta quello che ha lasciato l\'ultimo ingresso tolto.',
};

export const PropertiesPanel: React.FC<Props> = ({ circuit, selectedIds, onChange, onMirrorSelected, onSelectAll, onDeleteSelected, onPaste, layout, frameRef, library, onImportModels, onRemoveModel, scopeIds, isScopeFull, onToggleProbe, onOpenBlock }) => {
  const [insideOf, setInsideOf] = React.useState<Element | null>(null);
  // Choosing another part, or none, closes it for good: selecting the same part again does not reopen it
  React.useEffect(() => {
    if (insideOf && !(selectedIds.size === 1 && selectedIds.has(insideOf.id))) setInsideOf(null);
  }, [selectedIds, insideOf]);
  if (selectedIds.size === 0) {
    return (
      <div className="properties">
        <p className="hint">Seleziona un componente per modificarne i valori. Per collegare, parti da un terminale. Per un'area, tieni fermo un dito sul foglio e poi trascina, oppure trascina con il mouse.</p>
        {circuit.elements.length + circuit.wires.length > 0 && <button onClick={onSelectAll}>Seleziona tutto</button>}
        {onPaste && <button onClick={() => onPaste()}>Incolla</button>}
      </div>
    );
  }

  const selected = circuit.elements.filter((el) => selectedIds.has(el.id));
  const single = selectedIds.size === 1 && selected.length === 1 ? selected[0] : null;
  const def = single ? getDevice(single.def) : null;
  const singleWire = selectedIds.size === 1 && !single ? circuit.wires.find((w) => selectedIds.has(w.id)) : undefined;
  const probeChoices = single ? elementProbes(single) : singleWire ? [wireProbe(nodeWire(singleWire.id, circuit))] : [];
  const deviceIndex = single && layout ? layout.devices.findIndex((d) => d.elementId === single.id) : -1;

  const positive = def?.id === 'multimeter' ? 'la boccola rossa' : 'il lato +';

  const update = (patch: Partial<Element>, record = true) => {
    if (!single) return;
    onChange({ ...circuit, elements: circuit.elements.map((el) => (el.id === single.id ? { ...el, ...patch } : el)) }, record);
  };

  return (
    <div className="properties">
      <strong>{def ? def.name : singleWire ? 'Filo' : `${selectedIds.size} oggetti selezionati`}</strong>
      {deviceIndex >= 0 && (
        <LiveReadout deviceIndex={deviceIndex} sign={single ? drawingSign(single) : 1} transistorFirstDot={def?.spice.kind === 'bjt' || def?.spice.kind === 'mos' ? layout!.devices[deviceIndex].firstDot : null} isMos={def?.spice.kind === 'mos'} windingsFirstDot={def?.spice.kind === 'transformer' ? layout!.devices[deviceIndex].firstDot : null} relayFirstDot={def?.spice.kind === 'relay' ? layout!.devices[deviceIndex].firstDot : null} isChangeover={def?.spice.kind === 'relay' && !!def.spice.nc} isPot={def?.spice.kind === 'pot'} isLamp={def?.spice.kind === 'lamp'} boardFirstDot={def?.spice.kind === 'mcu' ? layout!.devices[deviceIndex].firstDot : null} timerFirstDot={def?.spice.kind === 'timer' ? layout!.devices[deviceIndex].firstDot : null} optoFirstDot={def?.spice.kind === 'opto' ? layout!.devices[deviceIndex].firstDot : null} ssrFirstDot={def?.spice.kind === 'ssr' ? layout!.devices[deviceIndex].firstDot : null} regulatorFirstDot={def?.spice.kind === 'regulator' ? layout!.devices[deviceIndex].firstDot : null} isSensor={def?.spice.kind === 'regulator' && !!def.spice.sensor} frameRef={frameRef} />
      )}
      {single && def?.spice.kind === 'logic' && def.spice.gate === 'table' && def.spice.tableProp && (
        <TruthTableEditor element={single} inputs={def.spice.inputs} outputs={def.spice.outputs} onChange={(patch) => update(patch)} />
      )}
      {single && def?.spice.kind === 'vsource' && <SourceInspector props={single.props} isDcOnly={def.id !== 'vsource'} onChange={(props, record) => update({ props }, record)} />}
      {single &&
        def?.spice.kind !== 'vsource' &&
        def?.props.map((p) => {
          // With a manufacturer's model the bandwidth is in the model
          if (p.key === 'gbw' && single.props.model) return null;
          if (p.isHidden) return null;
          // A truth table has its own grid above
          if (def.spice.kind === 'logic' && p.key === def.spice.tableProp) return null;
          const value = String(single.props[p.key] ?? '');
          const isOpAmpModel = p.modelType === 'OPAMP';
          const isRegulatorModel = p.modelType === 'REGULATOR';
          const isBlock = p.modelType === 'SUBCKT';
          const options = p.type === 'model' ? modelsOfType(circuit, p.modelType ?? 'D', library) : [];
          const chosenCard = options.find((m) => m.name === value)?.card;
          // A block takes the shape of its model: the pins are part of the kind of part
          const chosen = (next: string, card: string | undefined): Partial<Element> => ({
            props: { ...single.props, [p.key]: next, ...(isOpAmpModel || isRegulatorModel ? { pins: '' } : {}), ...(isBlock && card ? { pinNames: subcircuitPins(card).join(' ') } : {}) },
            ...(isBlock && card ? { def: blockId(subcircuitPins(card).length) } : {}),
          });
          const setValue = (next: string, record = true) => update(chosen(next, options.find((m) => m.name === next)?.card), record);
          const addModels = (models: ImportedModel[]) => {
            const isKept = onImportModels(models);
            // The part takes a model imported for it; out of a whole library, the choice is the user's
            const fitting = models.filter((m) => fitsModelType(m.card, p.modelType ?? 'D'));
            const usable = fitting.length === 1 ? fitting[0] : undefined;
            // A copy the circuit already has must follow, or the new version would never be used
            const imported = new Map(models.map((m) => [m.name, m.card]));
            const hasOwnCopy = circuit.models.some((m) => imported.has(m.name));
            if (usable || hasOwnCopy) {
              onChange({
                ...circuit,
                models: circuit.models.map((m) => ({ name: m.name, card: imported.get(m.name) ?? m.card })),
                elements: circuit.elements.map((el) => (el.id === single.id && usable ? { ...el, ...chosen(usable.name, usable.card) } : el)),
              });
            }
            return isKept;
          };
          return (
            <React.Fragment key={p.key}>
              <label>
                {p.label}
                {p.type === 'choice' ? (
                  <select value={value} onChange={(e) => setValue(e.target.value)}>
                    {p.options?.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : p.type === 'model' ? (
                  <select value={value} onChange={(e) => setValue(e.target.value)}>
                    {(isOpAmpModel || isRegulatorModel) && <option value="">{isOpAmpModel ? 'Ideale' : 'Semplice'}</option>}
                    {isBlock && !chosenCard && <option value="">Scegli…</option>}
                    {options.map((m) => (
                      <option key={m.name} value={m.name}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input value={value} onChange={(e) => setValue(e.target.value)} />
                )}
                {(def.spice.kind === 'passive' || def.spice.kind === 'isource' || (def.spice.kind === 'pot' && p.key === def.spice.valueProp)) && <ValueSlider value={value} label={p.label} onChange={setValue} />}
                {p.type === 'range' && <RangeSlider value={value} label={p.label} min={p.min ?? 0} max={p.max ?? 100} step={p.step} onChange={setValue} />}
              </label>
              {p.type === 'model' && <ModelImporter library={library} onImport={addModels} onRemove={onRemoveModel} />}
              {isBlock && chosenCard && (
                <p className="hint">Piedini, da sinistra in alto e poi a destra: {subcircuitPins(chosenCard).join(', ')}. Vale per l'Analisi precisa: con un sottocircuito l'animazione non parte.</p>
              )}
              {isRegulatorModel && chosenCard && (
                <>
                  <ModelPins pins={subcircuitPins(chosenCard)} roles={readRegulatorRoles(single.props.pins, subcircuitPins(chosenCard)) ?? REGULATOR_ROLES} allRoles={REGULATOR_ROLES} labels={REGULATOR_LABELS} onChange={(pins) => update({ props: { ...single.props, pins } })} />
                  <p className="hint">Il modello vale per l'Analisi precisa. L'animazione usa il comportamento semplice.</p>
                </>
              )}
              {isOpAmpModel && chosenCard && (
                <>
                  <ModelPins pins={subcircuitPins(chosenCard)} roles={readOpAmpRoles(single.props.pins, subcircuitPins(chosenCard)) ?? OPAMP_ROLES} allRoles={OPAMP_ROLES} labels={OPAMP_LABELS} onChange={(pins) => update({ props: { ...single.props, pins } })} />
                  <p className="hint">Il modello vale per l'Analisi precisa. L'animazione usa un operazionale ideale con queste alimentazioni.</p>
                </>
              )}
            </React.Fragment>
          );
        })}
      {single && def?.spice.kind === 'motor' && (
        <p className="hint">
          {def.spice.plate.volts} V nominali: a vuoto {def.spice.plate.noLoadRpm} giri/min e {String(def.spice.plate.noLoadCurrent).replace('.', ',')} A, in stallo {String(def.spice.plate.stallCurrent).replace('.', ',')} A e {String(def.spice.plate.stallTorque).replace('.', ',')} kgf·cm. Il carico frena l'albero d'uscita; oltre la coppia di stallo il motore si blocca. Induttanza e inerzia sono stimate.
        </p>
      )}
      {single && def?.spice.kind === 'mcu' && (
        <ArduinoProgram
          element={single}
          onLoad={(name, hex) => update({ props: { ...single.props, sketch: CUSTOM_SKETCH, hex, hexName: name } })}
          onReset={() => update({ props: { ...single.props, resets: String(Number(single.props.resets ?? 0) + 1) } })}
        />
      )}
      {single && def?.spice.kind === 'logic' && def.spice.gate === 'network' && (
        <>
          <p className="hint">
            Fatto di: {compositeParts(def.id).map((el) => `${getDevice(el.def)?.name} ${el.tag}`).join(', ')}. Nei due motori si comporta come un'unica parte logica, senza ritardi all'interno.
          </p>
          <button onClick={() => setInsideOf(single)}>Mostra l'interno</button>
        </>
      )}
      {single && def?.spice.kind === 'userblock' && (
        <>
          <p className="hint">
            Piedini: {def.terminals.map((t) => t.id).join(', ')}. Nei due motori il blocco si apre nei suoi componenti, come se fossero disegnati qui; la massa interna è la massa del circuito. Interruttori, pulsanti,
            cursori e ingressi logici interni restano come nello schema salvato. Le grandezze interne non si vedono dal vivo: misura sui piedini, anche con l'oscilloscopio.
          </p>
          <div className="button-row">
            <button onClick={() => setInsideOf(single)}>Mostra l'interno</button>
            {onOpenBlock && (
              <button onClick={() => onOpenBlock(def.id)} title="Apre lo schema interno al posto di questo circuito, per cambiarlo e salvarlo; Annulla torna qui">
                Apri come circuito
              </button>
            )}
          </div>
        </>
      )}
      {single && def?.spice.kind === 'logic' && SEQUENTIAL_NOTES[def.spice.gate] && <p className="hint">{SEQUENTIAL_NOTES[def.spice.gate]}</p>}
      {/* Only for the part still selected: another selection, or none, closes it */}
      {insideOf && insideOf.id === single?.id && <InsideView key={insideOf.id} id={insideOf.def} tag={insideOf.tag} onClose={() => setInsideOf(null)} />}
      {single && def?.spice.kind === 'timer' && <TimerNote circuit={circuit} element={single} spec={def.spice.spec} />}
      {single && def?.spice.kind === 'opto' && (
        <p className="hint">
          Dal datasheet del PC817: LED infrarosso da 1,2 V tipici a 20 mA; la corrente di collettore è CTR volte quella del LED finché il circuito di uscita la lascia passare, poi il fototransistor satura a circa 0,1 V. La classe dice il CTR a 5 mA. Ingresso e uscita non sono collegati: possono avere masse diverse. Massimi: 50 mA sul LED e in uscita, 35 V fra collettore ed emettitore. Il CTR è costante e i tempi di commutazione (pochi µs) non sono simulati.
        </p>
      )}
      {single && def?.spice.kind === 'ssr' && <SsrNote element={single} />}
      {single && def?.spice.kind === 'lamp' && <LampNote element={single} spice={def.spice} />}
      {single && def?.spice.kind === 'pot' && (
        <p className="hint">Il cursore va da 0 % sull'estremo a, a sinistra nel simbolo non ruotato, a 100 % sull'estremo b. All'oscilloscopio, Cursore è la tensione del cursore verso massa.</p>
      )}
      {single && def?.spice.kind === 'relay' && (
        <p className="hint">
          Bobina da {def.spice.spec.coilVolts} V, {def.spice.spec.coilResistance} Ω: il contatto si chiude sopra {String(def.spice.spec.pickup).replace('.', ',')} V e si riapre sotto {String(def.spice.spec.dropout).replace('.', ',')} V, i limiti del datasheet. {def.spice.nc ? 'Bobina A1–A2; contatto di scambio: comune 11, normalmente chiuso 12 (chiuso a riposo), normalmente aperto 14 (chiuso con la bobina eccitata).' : 'Bobina A1–A2, contatto normalmente aperto 13–14.'} Senza un diodo sulla bobina, allo spegnimento compare una sovratensione. L'induttanza è stimata e il contatto scatta senza ritardo meccanico.
        </p>
      )}
      {single && def?.spice.kind === 'regulator' && def.spice.sensor && (
        <p className="hint">
          Uscita {def.spice.sensor.offset > 0 ? `${String(def.spice.sensor.offset).replace('.', ',')} V più ` : ''}10 mV per grado. Alimentazione da {String(def.spice.sensor.vMin).replace('.', ',')} a {def.spice.sensor.vMax} V: fuori campo l'uscita non vale, sopra {def.spice.sensor.vAbsMax} V il sensore si danneggia. L'uscita dà corrente ma non la assorbe.
        </p>
      )}
      {single && def?.spice.kind === 'regulator' && !def.spice.sensor && (
        <p className="hint">Oltre 150 °C l'uscita si spegne e sotto 125 °C riparte. La temperatura è giusta, i tempi sono accorciati per vederla: circa 2 s di animazione.</p>
      )}
      {single && def?.spice.kind === 'meter' && (
        <p className="hint">
          {single.props.mode === 'ohm' ? `Collega i fili ai capi del componente, a circuito spento: inietta 1 mA da ${positive} e una tensione nel circuito falsa la lettura. OL vuol dire che non c'è collegamento.` : String(single.props.mode).startsWith('v') ? `Collega i due fili in parallelo ai punti da misurare. Legge ${positive} rispetto all'altro capo. Con RMS esclude la componente continua.` : `Apri il ramo e collega il multimetro in serie, con la corrente che entra da ${positive}. Con RMS esclude la componente continua.`}{def.id === 'multimeter' ? ' Si cambia misura anche toccando le scritte attorno alla manopola.' : ''} Vale per l'animazione.
        </p>
      )}
      {single && def?.tagPrefix && (
        <label>
          Nome
          <input value={single.tag} onChange={(e) => update({ tag: e.target.value })} />
        </label>
      )}
      {probeChoices.length > 0 && (
        <div className="scope-buttons">
          <span id="scope-buttons-label">All'oscilloscopio</span>
          <div role="group" aria-labelledby="scope-buttons-label">
            {probeChoices.map(({ label, probe }) => {
              const isActive = scopeIds.has(probe.id);
              return (
                <button key={probe.id} className={isActive ? 'active' : ''} aria-pressed={isActive} disabled={!isActive && isScopeFull} onClick={() => onToggleProbe(probe)}>
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="button-row">
        {selected.some((el) => canMirror(getDevice(el.def))) && (
          <button title="Scambia sopra e sotto: per un op. amp, gli ingressi + e −" onClick={onMirrorSelected}>
            Specchia
          </button>
        )}
        <button className="danger" onClick={onDeleteSelected}>
          Elimina
        </button>
      </div>
      <p className="hint">Per copiare, tagliare o duplicare, tieni premuto un componente o usa il tasto destro del mouse.</p>
    </div>
  );
};
