import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DEVICES, elementSymbol } from '../library/devices';
import { getBounds, PrimitiveItem } from '../editor/Renderer';
import { ComponentDef } from '../model/types';

const ALL = 'Tutti';
const SECTION_KEY = 'ee-sim-nextgen/library-section';
const PARTS = DEVICES.filter((def) => !def.isHidden);
/** Sources first: every circuit starts from them, and from ground. */
const SECTIONS = ['Sorgenti', 'Passivi', 'Semiconduttori', 'Operazionali', 'Regolatori', 'Sensori', 'Motori', 'Logica', 'Arduino', 'Blocchi', 'Strumenti', 'Altri'];

const loadSection = () => {
  try {
    const stored = localStorage.getItem(SECTION_KEY);
    return stored && SECTIONS.includes(stored) ? stored : ALL;
  } catch {
    return ALL;
  }
};

const saveSection = (section: string) => {
  try {
    localStorage.setItem(SECTION_KEY, section);
  } catch {
    // Only a convenience: next time it opens on all the parts
  }
};

/** The parts matching what was typed, on the name or on the prefix of the tag. */
export function searchParts(parts: ComponentDef[], query: string): ComponentDef[] {
  const text = query.trim().toLowerCase();
  return text ? parts.filter((def) => def.name.toLowerCase().includes(text) || def.tagPrefix?.toLowerCase() === text || def.category.toLowerCase().includes(text) || def.searchTerms?.includes(text)) : parts;
}

const MIN_THUMB = 20;

/** Where the thumb of a bar goes, in percent of the track. Null when everything fits and there is nothing to scroll. */
export function thumbGeometry(position: number, content: number, view: number): { left: number; width: number } | null {
  if (content <= view + 1) return null;
  const width = Math.max(MIN_THUMB, (view / content) * 100);
  return { left: (position / (content - view)) * (100 - width), width };
}

/**
 * A bar of its own: the system's is hidden on Mac and iPad, and with a mouse the sections
 * could not be reached at all. The thumb can be dragged, and a press on the track moves there.
 */
const SectionsBar: React.FC<{ target: React.RefObject<HTMLElement> }> = ({ target }) => {
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; scroll: number } | null>(null);

  useEffect(() => {
    const element = target.current;
    if (!element) return;
    const update = () => setThumb(thumbGeometry(element.scrollLeft, element.scrollWidth, element.clientWidth));
    update();
    element.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      element.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [target]);

  if (!thumb) return null;

  /** Scroll for each pixel the thumb moves. */
  const scrollPerPixel = () => {
    const element = target.current!;
    const free = trackRef.current!.clientWidth * (1 - thumb.width / 100);
    return free > 0 ? (element.scrollWidth - element.clientWidth) / free : 0;
  };

  const handleDown = (e: React.PointerEvent) => {
    const element = target.current!;
    const box = trackRef.current!.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * 100;
    // On the track, the thumb first comes under the pointer
    if (x < thumb.left || x > thumb.left + thumb.width) element.scrollLeft += ((x - thumb.left - thumb.width / 2) / 100) * box.width * scrollPerPixel();
    dragRef.current = { x: e.clientX, scroll: element.scrollLeft };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const handleMove = (e: React.PointerEvent) => {
    if (dragRef.current) target.current!.scrollLeft = dragRef.current.scroll + (e.clientX - dragRef.current.x) * scrollPerPixel();
  };

  return (
    <div ref={trackRef} className="palette-bar" aria-hidden="true" onPointerDown={handleDown} onPointerMove={handleMove} onPointerUp={() => (dragRef.current = null)} onPointerCancel={() => (dragRef.current = null)}>
      <div className="palette-bar-thumb" style={{ left: `${thumb.left}%`, width: `${thumb.width}%` }} />
    </div>
  );
};

/** The drawing of a part, fitted to its card. */
const PartIcon: React.FC<{ def: ComponentDef }> = ({ def }) => {
  const xs = def.terminals.map((t) => t.x);
  const ys = def.terminals.map((t) => t.y);
  const body = getBounds(def);
  const [minX, maxX] = [Math.min(-24, body.x, ...xs), Math.max(24, body.x + body.w, ...xs)];
  const [minY, maxY] = [Math.min(-24, body.y, ...ys), Math.max(24, body.y + body.h, ...ys)];
  const symbol = elementSymbol(def, { id: '', def: def.id, x: 0, y: 0, rot: 0, tag: '', props: Object.fromEntries(def.props.map((p) => [p.key, p.default])) });
  return (
    <svg viewBox={`${minX - 4} ${minY - 4} ${maxX - minX + 8} ${maxY - minY + 8}`} aria-hidden="true">
      {symbol.map((prim, k) => (
        <PrimitiveItem key={k} prim={prim} />
      ))}
    </svg>
  );
};

interface Props {
  active: ComponentDef | null;
  onChoose: (def: ComponentDef) => void;
  /** The blocks of the personal library and of the open circuit, beside the pin flags. */
  blocks?: ComponentDef[];
  /** The blocks of the personal library, which can be taken out of it. */
  removableBlocks?: Set<string>;
  onRemoveBlock?: (id: string) => void;
  /** Reads a saved circuit as a block: null, or what went wrong. */
  onImportBlock?: (file: File) => Promise<string | null>;
}

export const ComponentLibrary: React.FC<Props> = ({ active, onChoose, blocks = [], removableBlocks = new Set(), onRemoveBlock, onImportBlock }) => {
  const [section, setSection] = useState(loadSection);
  const [query, setQuery] = useState('');
  const [importNote, setImportNote] = useState<string | null>(null);
  const sectionsRef = useRef<HTMLDivElement>(null);
  const blockFileRef = useRef<HTMLInputElement>(null);
  const parts = useMemo(() => [...PARTS, ...blocks], [blocks]);

  // The remembered section may be beyond the edge
  useEffect(() => {
    sectionsRef.current?.querySelector<HTMLElement>('.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, []);

  const groups = useMemo(() => {
    if (query.trim()) return [{ title: null, parts: searchParts(parts, query) }];
    const shown = section === ALL ? SECTIONS : [section];
    return shown.map((title) => ({ title: section === ALL ? title : null, parts: parts.filter((def) => def.category === title) }));
  }, [section, query, parts]);

  const showsBlocks = !query.trim() && (section === ALL || section === 'Blocchi');

  return (
    <nav className="palette" aria-label="Componenti">
      <input type="search" className="palette-search" placeholder="Cerca per nome o sigla" aria-label="Cerca un componente" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div ref={sectionsRef} className="palette-sections" role="group" aria-label="Sezioni">
        {[ALL, ...SECTIONS].map((name) => (
          <button
            key={name}
            className={name === section ? 'active' : ''}
            aria-pressed={name === section}
            onClick={() => {
              setSection(name);
              setQuery('');
              saveSection(name);
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <SectionsBar target={sectionsRef} />
      <div className="palette-parts">
        {groups.map(({ title, parts }) => (
          <section key={title ?? 'parts'}>
            {title && <h3>{title}</h3>}
            <div className="palette-grid">
              {parts.map((def) => (
                <div key={def.id} className="part-slot">
                  <button className={active?.id === def.id ? 'part active' : 'part'} aria-pressed={active?.id === def.id} onClick={() => onChoose(def)}>
                    <PartIcon def={def} />
                    <span>{def.name}</span>
                  </button>
                  {removableBlocks.has(def.id) && onRemoveBlock && (
                    <button className="part-remove" aria-label={`Togli ${def.name} dalla libreria`} title="Togli dalla libreria: i circuiti che lo usano lo tengono" onClick={() => onRemoveBlock(def.id)}>
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
            {showsBlocks && (title === 'Blocchi' || (title === null && section === 'Blocchi')) && onImportBlock && (
              <div className="palette-blocks">
                <button onClick={() => blockFileRef.current?.click()}>Importa da file…</button>
                <p className="hint">
                  {importNote ??
                    'Un circuito salvato diventa un blocco: i piedini sono le sue bandierine. Oppure seleziona una parte del circuito e scegli Crea blocco dal menu (tasto destro o dito fermo).'}
                </p>
                <input
                  ref={blockFileRef}
                  type="file"
                  accept=".json,application/json"
                  hidden
                  aria-label="Importa un blocco"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    const problem = await onImportBlock(file);
                    setImportNote(problem ?? `Importato "${file.name}": lo trovi qui sopra`);
                  }}
                />
              </div>
            )}
          </section>
        ))}
        {groups.every(({ parts }) => parts.length === 0) && <p className="hint">Nessun componente</p>}
      </div>
    </nav>
  );
};
