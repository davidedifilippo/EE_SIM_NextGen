import { Pt, Wire } from '../model/types';
import { dist, isPointOnSegment, ptKey } from '../utils/geometry';

export interface WireEdge {
  a: Pt;
  b: Pt;
  /** Vertex indices of a and b. */
  va: number;
  vb: number;
  wireId: string;
}

export interface WireGraph {
  edges: WireEdge[];
  vertexCount: number;
  vertexOf: Map<string, number>;
  /** Vertices from the leaves towards the roots, each with the edge to its parent. */
  order: { vertex: number; parent: number; edge: number }[];
}

/**
 * Splits wires into edges at every junction and terminal: current changes along a wire wherever
 * something connects to it. Roots are the given vertices first (ground), which absorb what is
 * left over, so the wire currents always add up even without a separate ground current.
 */
export function buildWireGraph(wires: Wire[], terminals: Pt[], rootPoints: Pt[]): WireGraph {
  const vertexOf = new Map<string, number>();
  const vertex = (p: Pt) => {
    const key = ptKey(p);
    if (!vertexOf.has(key)) vertexOf.set(key, vertexOf.size);
    return vertexOf.get(key)!;
  };

  const wireEnds = wires.flatMap((w) => [w.pts[0], w.pts[w.pts.length - 1]]);
  const edges: WireEdge[] = [];
  for (const w of wires) {
    for (let i = 0; i + 1 < w.pts.length; i++) {
      const [a, b] = [w.pts[i], w.pts[i + 1]];
      const stops = [a, b, ...terminals, ...wireEnds].filter((p) => isPointOnSegment(p, a, b));
      const unique = [...new Map(stops.map((p) => [ptKey(p), p])).values()].sort((p, q) => dist(a, p) - dist(a, q));
      for (let k = 0; k + 1 < unique.length; k++) {
        edges.push({ a: unique[k], b: unique[k + 1], va: vertex(unique[k]), vb: vertex(unique[k + 1]), wireId: w.id });
      }
    }
  }

  const adjacency: { edge: number; other: number }[][] = Array.from({ length: vertexOf.size }, () => []);
  edges.forEach((e, i) => {
    adjacency[e.va].push({ edge: i, other: e.vb });
    adjacency[e.vb].push({ edge: i, other: e.va });
  });

  // Breadth-first spanning forest: edges closing a loop of wires carry no current of their own
  const visited = new Array<boolean>(vertexOf.size).fill(false);
  const visitOrder: { vertex: number; parent: number; edge: number }[] = [];
  const grow = (root: number) => {
    if (visited[root]) return;
    visited[root] = true;
    const queue = [root];
    for (let head = 0; head < queue.length; head++) {
      const v = queue[head];
      for (const { edge, other } of adjacency[v]) {
        if (visited[other]) continue;
        visited[other] = true;
        visitOrder.push({ vertex: other, parent: v, edge });
        queue.push(other);
      }
    }
  };
  for (const p of rootPoints) {
    const root = vertexOf.get(ptKey(p));
    if (root !== undefined) grow(root);
  }
  for (let v = 0; v < vertexOf.size; v++) grow(v);

  return { edges, vertexCount: vertexOf.size, vertexOf, order: visitOrder.reverse() };
}

/**
 * Current in each edge from a to b, given the current entering the wires at each vertex
 * (Kirchhoff's current law, solved from the leaves to the roots). The array is overwritten.
 */
export function solveWireCurrents(graph: WireGraph, injected: Float64Array, out: Float64Array): void {
  out.fill(0);
  for (const { vertex, parent, edge } of graph.order) {
    const current = injected[vertex];
    out[edge] = graph.edges[edge].va === vertex ? current : -current;
    injected[parent] += current;
  }
}
