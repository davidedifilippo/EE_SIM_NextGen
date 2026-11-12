import React from 'react';
import { ExamplesSelect, SpeedSelect, ThemeSelect, ValuesToggle } from '../workbench/parts';
import { HAS_BREADBOARD } from '../edition';
import { CONTROL_SIZES } from '../ui/layoutChoice';
import { Workbench } from '../workbench/useWorkbench';

interface Props {
  wb: Workbench;
  /** The pick of the viewer for the size of the controls, 1 for what the screen asks. */
  controlSize: number;
  onControlSize: (size: number) => void;
  onFullLayout: () => void;
  onClose: () => void;
}

/** What the toolbar holds on a large screen, in one list under ⋮. */
export const MobileMenu: React.FC<Props> = ({ wb, controlSize, onControlSize, onFullLayout, onClose }) => {
  const act = (action: () => void) => () => {
    onClose();
    action();
  };
  const sizeIndex = CONTROL_SIZES.indexOf(controlSize);
  return (
    <div className="dialog-backdrop mobile-menu-backdrop" onPointerDown={onClose}>
      <div className="mobile-menu" role="menu" onPointerDown={(e) => e.stopPropagation()}>
        <button onClick={act(wb.newCircuit)}>Nuovo</button>
        <button onClick={act(() => wb.fileInputRef.current?.click())}>Apri…</button>
        <ExamplesSelect wb={wb} onOpened={onClose} />
        <button onClick={act(() => wb.setIsSaving(true))}>Salva…</button>
        <button onClick={act(() => wb.setIsSharing(true))}>Condividi</button>
        <hr />
        {HAS_BREADBOARD && <button onClick={act(() => wb.setView(wb.view === 'schematic' ? 'breadboard' : 'schematic'))}>{wb.view === 'schematic' ? 'Vista breadboard' : 'Vista schema'}</button>}
        <SpeedSelect wb={wb} />
        <ValuesToggle wb={wb} />
        <ThemeSelect wb={wb} />
        {/* The menu stays open: each press shows at once on the menu itself */}
        <div className="control-size" role="group" aria-label="Grandezza dei comandi">
          <span>Grandezza comandi</span>
          <button aria-label="Comandi più piccoli" disabled={sizeIndex <= 0} onClick={() => onControlSize(CONTROL_SIZES[sizeIndex - 1])}>
            −
          </button>
          <output>{Math.round(controlSize * 100)}%</output>
          <button aria-label="Comandi più grandi" disabled={sizeIndex >= CONTROL_SIZES.length - 1} onClick={() => onControlSize(CONTROL_SIZES[sizeIndex + 1])}>
            +
          </button>
        </div>
        <hr />
        <button onClick={act(onFullLayout)}>Interfaccia completa</button>
      </div>
    </div>
  );
};
