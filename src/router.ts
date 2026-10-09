import type { Rect, Vec } from './types';
import { simplifyPolyline } from './geometry';

/**
 * Orthogonal wire router.
 *
 * A* search over a rectilinear grid (the drawing grid plus extra lines through
 * the two endpoints, so off-grid ports route cleanly). Costs, highest priority
 * first:
 *   1. collisions: running through objects, overlapping other wires, crossing other wires
 *   2. bends
 *   3. length
 */

export interface Obstacle extends Rect {
  /** cost per unit length of travelling inside this rect */
  cost: number;
  /** soft obstacles (labels) have no "keep clear" zone around them */
  soft?: boolean;
}

export interface Seg {
  a: Vec;
  b: Vec;
}

export interface RouteContext {
  obstacles: Obstacle[];
  segments: Seg[];
  grid: number;
}

export const COST_LABEL = 4; // per unit of length crossing a text label
export const COST_OBJECT = 400; // per unit of length inside an object
const COST_OVERLAP = 60; // per unit of length lying on another wire
const COST_CROSS = 600; // per crossing
const COST_NEAR = 1.5; // per unit of length hugging an object edge
const BEND_GRIDS = 4; // a bend costs this many grid steps of length

class Heap {
  private k: number[] = [];
  private v: number[] = [];
  get size() {
    return this.k.length;
  }
  push(key: number, val: number) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop(): number {
    const k = this.k, v = this.v;
    const top = v[0];
    const lk = k.pop()!, lv = v.pop()!;
    const n = k.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lk;
      v[i] = lv;
    }
    return top;
  }
}

function lines(min: number, max: number, g: number, extra: number[]): number[] {
  const s = new Set<number>();
  for (let x = Math.floor(min / g) * g; x <= max; x += g) s.add(Math.round(x * 1000) / 1000);
  for (const e of extra) s.add(Math.round(e * 1000) / 1000);
  return [...s].sort((a, b) => a - b);
}

// directions: 0 right, 1 down, 2 left, 3 up
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

function dirIndex(d: Vec | null | undefined): number {
  if (!d) return -1;
  if (Math.abs(d.x) >= Math.abs(d.y)) return d.x >= 0 ? 0 : 2;
  return d.y >= 0 ? 1 : 3;
}

/**
 * Route from `start` to `end`. Returns the full polyline (including both endpoints),
 * or null if no route exists.
 */
export function routeOrtho(
  start: Vec,
  startDir: Vec | null,
  end: Vec,
  endDir: Vec | null,
  ctx: RouteContext,
): Vec[] | null {
  const g = ctx.grid;
  const margin = g * 6;
  let bx1 = Math.min(start.x, end.x) - margin;
  let by1 = Math.min(start.y, end.y) - margin;
  let bx2 = Math.max(start.x, end.x) + margin;
  let by2 = Math.max(start.y, end.y) + margin;
  // grow the search area to fit obstacles that intersect it (so we can go around them)
  for (let pass = 0; pass < 2; pass++) {
    for (const o of ctx.obstacles) {
      if (o.x > bx2 || o.x + o.w < bx1 || o.y > by2 || o.y + o.h < by1) continue;
      bx1 = Math.min(bx1, o.x - g * 3);
      by1 = Math.min(by1, o.y - g * 3);
      bx2 = Math.max(bx2, o.x + o.w + g * 3);
      by2 = Math.max(by2, o.y + o.h + g * 3);
    }
  }
  // keep the grid size bounded
  let step = g;
  while (((bx2 - bx1) / step) * ((by2 - by1) / step) > 90000) step *= 2;

  const xs = lines(bx1, bx2, step, [start.x, end.x]);
  const ys = lines(by1, by2, step, [start.y, end.y]);
  const nx = xs.length, ny = ys.length;
  const idxOf = (arr: number[], val: number) => {
    const r = Math.round(val * 1000) / 1000;
    let lo = 0, hi = arr.length - 1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (arr[m] === r) return m;
      if (arr[m] < r) lo = m + 1;
      else hi = m - 1;
    }
    return -1;
  };
  const si = idxOf(xs, start.x), sj = idxOf(ys, start.y);
  const ei = idxOf(xs, end.x), ej = idxOf(ys, end.y);
  if (si < 0 || sj < 0 || ei < 0 || ej < 0) return null;

  const obs = ctx.obstacles.filter((o) => !(o.x > bx2 || o.x + o.w < bx1 || o.y > by2 || o.y + o.h < by1));
  const hSegs: { y: number; x1: number; x2: number }[] = [];
  const vSegs: { x: number; y1: number; y2: number }[] = [];
  for (const s of ctx.segments) {
    if (Math.abs(s.a.y - s.b.y) < 0.01 && Math.abs(s.a.x - s.b.x) > 0.01) {
      hSegs.push({ y: s.a.y, x1: Math.min(s.a.x, s.b.x), x2: Math.max(s.a.x, s.b.x) });
    } else if (Math.abs(s.a.x - s.b.x) < 0.01 && Math.abs(s.a.y - s.b.y) > 0.01) {
      vSegs.push({ x: s.a.x, y1: Math.min(s.a.y, s.b.y), y2: Math.max(s.a.y, s.b.y) });
    }
  }

  const near = g * 1.5;
  function edgeCost(x1: number, y1: number, x2: number, y2: number): number {
    const len = Math.abs(x2 - x1) + Math.abs(y2 - y1);
    let c = len;
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    for (const o of obs) {
      // the border counts as inside, so wires don't run along object edges over other pins
      if (mx >= o.x - 0.01 && mx <= o.x + o.w + 0.01 && my >= o.y - 0.01 && my <= o.y + o.h + 0.01) c += o.cost * len;
      else if (!o.soft && mx > o.x - near && mx < o.x + o.w + near && my > o.y - near && my < o.y + o.h + near) c += COST_NEAR * len;
    }
    if (y1 === y2) {
      const lo = Math.min(x1, x2), hi = Math.max(x1, x2);
      for (const s of hSegs) {
        if (Math.abs(s.y - y1) < 0.01) {
          const ov = Math.min(hi, s.x2) - Math.max(lo, s.x1);
          if (ov > 0.01) c += COST_OVERLAP * ov;
        }
      }
      for (const s of vSegs) {
        if (s.x >= lo && s.x < hi && y1 > s.y1 + 0.01 && y1 < s.y2 - 0.01) c += COST_CROSS;
      }
    } else {
      const lo = Math.min(y1, y2), hi = Math.max(y1, y2);
      for (const s of vSegs) {
        if (Math.abs(s.x - x1) < 0.01) {
          const ov = Math.min(hi, s.y2) - Math.max(lo, s.y1);
          if (ov > 0.01) c += COST_OVERLAP * ov;
        }
      }
      for (const s of hSegs) {
        if (s.y >= lo && s.y < hi && x1 > s.x1 + 0.01 && x1 < s.x2 - 0.01) c += COST_CROSS;
      }
    }
    return c;
  }

  const bend = BEND_GRIDS * g;
  const sd = dirIndex(startDir);
  const edEntry = endDir ? (dirIndex(endDir) + 2) % 4 : -1; // direction of travel when arriving
  const N = nx * ny * 4;
  const gScore = new Float64Array(N).fill(Infinity);
  const from = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const heap = new Heap();
  const h = (i: number, j: number) => Math.abs(xs[i] - end.x) + Math.abs(ys[j] - end.y);
  const key = (i: number, j: number, d: number) => ((j * nx + i) << 2) | d;

  // seed: leave the start in its exit direction (or any direction for junctions)
  for (let d = 0; d < 4; d++) {
    if (sd >= 0 && d !== sd) continue;
    const k = key(si, sj, d);
    gScore[k] = 0;
    heap.push(h(si, sj), k);
  }

  let goal = -1;
  let expanded = 0;
  while (heap.size) {
    const k = heap.pop();
    if (closed[k]) continue;
    closed[k] = 1;
    const d = k & 3;
    const cell = k >> 2;
    const i = cell % nx, j = (cell / nx) | 0;
    if (i === ei && j === ej) {
      goal = k;
      break;
    }
    if (++expanded > 400000) break;
    const atStart = i === si && j === sj;
    for (let nd = 0; nd < 4; nd++) {
      if (nd === (d + 2) % 4) continue; // no U-turns in place
      if (atStart && sd >= 0 && nd !== sd) continue; // leave a pin straight out
      const ni = i + DX[nd], nj = j + DY[nd];
      if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
      let c = gScore[k] + edgeCost(xs[i], ys[j], xs[ni], ys[nj]);
      if (nd !== d) c += bend;
      if (ni === ei && nj === ej && edEntry >= 0 && nd !== edEntry) c += bend * 4;
      const nk = key(ni, nj, nd);
      if (c < gScore[nk]) {
        gScore[nk] = c;
        from[nk] = k;
        heap.push(c + h(ni, nj), nk);
      }
    }
  }
  if (goal < 0) return null;
  const path: Vec[] = [];
  for (let k = goal; k >= 0; k = from[k]) {
    const cell = k >> 2;
    path.push({ x: xs[cell % nx], y: ys[(cell / nx) | 0] });
  }
  path.reverse();
  return simplifyPolyline(path);
}
