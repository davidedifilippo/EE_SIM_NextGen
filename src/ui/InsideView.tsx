import React, { useEffect, useMemo, useState } from 'react';
import { getDevice } from '../library/devices';
import { compositeSchematic } from '../library/composites';
import { knownBlock } from '../library/blocks';

/** The inner schematic of a part made of parts or of a block, or null for any other part. */
const schematicOf = (id: string) => compositeSchematic(id) ?? knownBlock(id)?.circuit ?? null;
import { getBounds, Renderer } from '../editor/Renderer';
import { Element } from '../model/types';

/** Room around the drawing, for the names above and below the parts. */
const MARGIN = 50;
const nothing = () => {};
/** A, B o C. */
const orList = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} o ${names[names.length - 1]}` : names[0]);

/**
 * The inner schematic of a part made of parts, read-only. A part inside that is itself made of parts
 * opens at a touch; the path at the top goes back up.
 */
export const InsideView: React.FC<{ id: string; tag: string; onClose: () => void }> = ({ id, tag, onClose }) => {
  const [path, setPath] = useState<{ id: string; tag: string }[]>([{ id, tag }]);
  const current = path[path.length - 1];
  const circuit = schematicOf(current.id);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const box = useMemo(() => {
    if (!circuit) return null;
    const xs: number[] = [];
    const ys: number[] = [];
    for (const el of circuit.elements) {
      const def = getDevice(el.def);
      if (!def) continue;
      const b = getBounds(def);
      xs.push(el.x + b.x, el.x + b.x + b.w);
      ys.push(el.y + b.y, el.y + b.y + b.h);
    }
    for (const w of circuit.wires) {
      for (const p of w.pts) {
        xs.push(p.x);
        ys.push(p.y);
      }
    }
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    return { x: minX - MARGIN, y: minY - MARGIN, w: maxX - minX + 2 * MARGIN, h: maxY - minY + 2 * MARGIN };
  }, [circuit]);

  if (!circuit || !box) return null;
  const openPart = (el: Element) => {
    if (schematicOf(el.def)) setPath((p) => [...p, { id: el.def, tag: el.tag }]);
  };
  const parts = circuit.elements.filter((el) => schematicOf(el.def));

  return (
    <div className="dialog-backdrop" onPointerDown={onClose}>
      <div className="share-panel inside-view" role="dialog" aria-label={`Interno di ${tag}`} onPointerDown={(e) => e.stopPropagation()}>
        <div className="inside-header">
          <nav aria-label="Livelli" className="inside-path">
            {path.map((step, k) => (
              <React.Fragment key={k}>
                {k > 0 && <span aria-hidden="true"> › </span>}
                {k < path.length - 1 ? (
                  <button className="link" onClick={() => setPath((p) => p.slice(0, k + 1))}>
                    {step.tag} ({getDevice(step.id)?.name})
                  </button>
                ) : (
                  <strong>
                    {step.tag} ({getDevice(step.id)?.name})
                  </strong>
                )}
              </React.Fragment>
            ))}
          </nav>
          <button className="icon" aria-label="Chiudi" title="Chiudi" onClick={onClose}>
            ×
          </button>
        </div>
        <svg className="inside-drawing" viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} role="img" aria-label={`Schema interno di ${getDevice(current.id)?.name}`}>
          <Renderer
            circuit={circuit}
            selectedIds={new Set()}
            selectionBox={null}
            groupBounds={null}
            onElementDown={(el) => openPart(el)}
            onSetProp={nothing}
            onWireDown={nothing}
            onWireHandleDown={nothing}
            onTerminalDown={nothing}
            onTerminalUp={nothing}
            wireDraft={[]}
            ghost={null}
            hoveredTerminal={null}
          />
        </svg>
        <p className="hint">
          {parts.length > 0 ? `Tocca ${orList(parts.map((el) => el.tag))} per vedere com'è fatto dentro. ` : ''}Le bandierine sono i piedini del componente. Solo da guardare: il componente si usa come un'unica parte.
        </p>
      </div>
    </div>
  );
};
