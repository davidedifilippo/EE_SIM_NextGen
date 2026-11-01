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

/** Transform local terminal point to absolute world coords */
export function localToWorld(elemX: number, elemY: number, local: Pt, rot: Rotation): Pt {
  const r = rotatePt(local, rot);
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
