// Adapted from PowerCad_NextGen (see THIRD_PARTY_NOTICES.md).
import { Pt, Rotation } from '../model/types';

export const GRID_SIZE = 10;

export function snap(val: number, step = GRID_SIZE): number {
  return Math.round(val / step) * step;
}

/** Rotate a relative point around (0,0) by rotation angle */
export function rotatePt(p: Pt, rot: Rotation): Pt {
  switch (rot) {
    case 90:
      return { x: -p.y, y: p.x };
    case 180:
      return { x: -p.x, y: -p.y };
    case 270:
      return { x: p.y, y: -p.x };
    default:
      return { x: p.x, y: p.y };
  }
}

/** Transform local terminal point to absolute world coords. A mirrored part is flipped top to bottom before it turns. */
export function localToWorld(elemX: number, elemY: number, local: Pt, rot: Rotation, flip = false): Pt {
  const r = rotatePt(flip ? { x: local.x, y: -local.y } : local, rot);
  return { x: elemX + r.x, y: elemY + r.y };
}

export function dist(a: Pt, b: Pt): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function ptKey(p: Pt): string {
  return `${snap(p.x)},${snap(p.y)}`;
}

/** Check if point P lies on line segment AB within a tolerance */
export function isPointOnSegment(p: Pt, a: Pt, b: Pt, tol = 3): boolean {
  const minX = Math.min(a.x, b.x) - tol;
  const maxX = Math.max(a.x, b.x) + tol;
  const minY = Math.min(a.y, b.y) - tol;
  const maxY = Math.max(a.y, b.y) + tol;

  if (p.x < minX || p.x > maxX || p.y < minY || p.y > maxY) {
    return false;
  }

  const cross = Math.abs((b.y - a.y) * p.x - (b.x - a.x) * p.y + b.x * a.y - b.y * a.x);
  const len = dist(a, b);
  if (len < 1e-4) return dist(p, a) <= tol;
  return cross / len <= tol;
}

export function snapPt(p: Pt, step = GRID_SIZE): Pt {
  return { x: snap(p.x, step), y: snap(p.y, step) };
}

export interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function normalizeBox(box: Box): { minX: number; minY: number; maxX: number; maxY: number } {
  return {
    minX: Math.min(box.x1, box.x2),
    minY: Math.min(box.y1, box.y2),
    maxX: Math.max(box.x1, box.x2),
    maxY: Math.max(box.y1, box.y2),
  };
}

export function isPointInBox(p: Pt, box: Box): boolean {
  const { minX, minY, maxX, maxY } = normalizeBox(box);
  return p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
}

export function isElementInBox(elem: Pt, box: Box, radius = 22): boolean {
  const { minX, minY, maxX, maxY } = normalizeBox(box);
  return !(elem.x + radius < minX || elem.x - radius > maxX || elem.y + radius < minY || elem.y - radius > maxY);
}

/** Bounding-box overlap: exact for the orthogonal segments the editor draws. */
export function isWireInBox(pts: Pt[], box: Box): boolean {
  return pts.every((p) => isPointInBox(p, box));
}
