import { getDevice } from '../library/devices';
import { Circuit, Pt } from '../model/types';
import { DeviceDots, LiveLayout } from '../realtime/liveSimulation';
import { formatEngineering } from './chartMath';

export interface TextAnchorPoint {
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
}

export interface NodeLabel extends TextAnchorPoint {
  /** The wire edge that carries the label: its voltage is the node's. */
  edge: number;
}

export interface CurrentLabel extends TextAnchorPoint {
  dot: number;
  name: string;
}

/** Below this a current is not written, or unconnected parts would fill up with "0 A". */
const MIN_CURRENT = 1e-9;
const WIRE_GAP = 5;
const LINE_HEIGHT = 13;

/** One label per node, halfway along its longest edge; between equal edges, a horizontal one. */
export function nodeLabels({ graph, edgeNode }: LiveLayout): NodeLabel[] {
  const best = new Map<number, number>();
  const length = (edge: number) => Math.hypot(graph.edges[edge].b.x - graph.edges[edge].a.x, graph.edges[edge].b.y - graph.edges[edge].a.y);
  const isHorizontal = (edge: number) => graph.edges[edge].a.y === graph.edges[edge].b.y;

  edgeNode.forEach((node, edge) => {
    if (node < 0) return;
    const current = best.get(node);
    if (current === undefined || length(edge) > length(current) || (length(edge) === length(current) && isHorizontal(edge) && !isHorizontal(current))) {
      best.set(node, edge);
    }
  });

  return [...best.values()].map((edge) => {
    const { a, b } = graph.edges[edge];
    const [x, y] = [(a.x + b.x) / 2, (a.y + b.y) / 2];
    return isHorizontal(edge) ? { edge, x, y: y - WIRE_GAP, anchor: 'middle' as const } : { edge, x: x + WIRE_GAP, y: y + 4, anchor: 'start' as const };
  });
}

/** Under the name and value of each component, in the place Renderer leaves for them. */
export function currentLabels(circuit: Circuit, layout: LiveLayout): CurrentLabel[] {
  const byId = new Map(circuit.elements.map((el) => [el.id, el]));
  return layout.devices.flatMap((device): CurrentLabel[] => {
    const el = byId.get(device.elementId)!;
    if (getDevice(el.def)?.spice.kind === 'bjt') {
      const isFlipped = el.rot === 180;
      return ['Ic', 'Ib', 'Ie'].map((name, k) => ({
        dot: device.firstDot + k,
        name,
        x: el.x + (isFlipped ? -28 : 28),
        y: el.y + 24 + k * LINE_HEIGHT,
        anchor: isFlipped ? ('end' as const) : ('start' as const),
      }));
    }
    const isVertical = el.rot === 90 || el.rot === 270;
    return [
      isVertical
        ? { dot: device.firstDot, name: '', x: el.x + 24, y: el.y + 24, anchor: 'start' as const }
        : { dot: device.firstDot, name: '', x: el.x, y: el.y + 48, anchor: 'middle' as const },
    ];
  });
}

/** The arrow of a current along a path, on the path's main axis. Positive current flows from a to b. */
export function currentArrow({ a, b }: DeviceDots, current: number): string {
  const direction: Pt = { x: (b.x - a.x) * Math.sign(current), y: (b.y - a.y) * Math.sign(current) };
  if (Math.abs(direction.x) >= Math.abs(direction.y)) return direction.x > 0 ? '→' : '←';
  return direction.y > 0 ? '↓' : '↑';
}

export function currentText(name: string, dots: DeviceDots, current: number): string {
  if (Math.abs(current) < MIN_CURRENT) return '';
  const text = `${currentArrow(dots, current)} ${formatEngineering(Math.abs(current), 'A')}`;
  return name ? `${name} ${text}` : text;
}
