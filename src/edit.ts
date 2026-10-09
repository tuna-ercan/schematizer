import { produce } from 'immer';
import type { Doc, Obj, Rect, Vec } from './types';
import { add, eq, objBBox, objCenter, portDir, projectOnSegment, snapN, snapV, worldToLocal } from './geometry';
import { defaultPortLabelOffset, endpointPos, reconcileWires, segOrients, wireFull, type Orient } from './model';

/** Move objects / junctions / wire bodies by `delta`, stretching attached wires. */
export function applyMove(orig: Doc, objs: Set<string>, juncs: Set<string>, wires: Set<string>, delta: Vec, grid: number): Doc {
  return produce(orig, (d) => {
    for (const id of objs) {
      d.objects[id].x += delta.x;
      d.objects[id].y += delta.y;
    }
    for (const id of juncs) {
      d.junctions[id].x += delta.x;
      d.junctions[id].y += delta.y;
    }
    reconcileWires(orig, d, grid, delta, wires);
  });
}

/** Drag corner `idx` (index into wire.points) to `m`. */
export function dragCorner(orig: Doc, wireId: string, idx: number, m: Vec, grid: number): Doc {
  return produce(orig, (d) => {
    const w = d.wires[wireId];
    if (!w.ortho) {
      w.points[idx] = { ...m };
      return;
    }
    const full = wireFull(orig, orig.wires[wireId]);
    const o = segOrients(full);
    const k = idx + 1;
    const pts = full.map((p) => ({ ...p }));
    pts[k] = { ...m };
    const last = pts.length - 1;
    const same = (a: number, b: number) => Math.abs(a - b) < 0.01;
    const flip = (x: Orient): Orient => (x === 'h' ? 'v' : 'h');
    // a midpoint for an inserted step, on the grid unless that would make a zero-length piece
    const mid = (a: number, b: number) => {
      const v = snapN((a + b) / 2, grid);
      return same(v, a) || same(v, b) ? (a + b) / 2 : v;
    };
    let insertBefore: Vec[] = [];
    let insertAfter: Vec[] = [];

    // previous side: which way does the piece arriving at the dragged corner run now?
    let prevO: Orient;
    if (k - 1 === 0) {
      const P = pts[0];
      if (same(P.y, m.y) && !same(P.x, m.x)) prevO = 'h'; // corner level with the node: leave it horizontally
      else if (same(P.x, m.x) && !same(P.y, m.y)) prevO = 'v'; // corner above/below the node: leave it vertically
      else if (same(P.x, m.x)) prevO = o[0];
      else if (o[0] === 'h') {
        const xm = mid(P.x, m.x);
        insertBefore = [{ x: xm, y: P.y }, { x: xm, y: m.y }];
        prevO = 'h';
      } else {
        const ym = mid(P.y, m.y);
        insertBefore = [{ x: P.x, y: ym }, { x: m.x, y: ym }];
        prevO = 'v';
      }
    } else {
      prevO = o[k - 1];
      if (prevO === 'h') pts[k - 1].y = m.y;
      else pts[k - 1].x = m.x;
    }

    // next side: it has to turn, i.e. run the other way
    const want = flip(prevO);
    if (k + 1 === last) {
      const E = pts[last];
      const aligned = want === 'h' ? same(E.y, m.y) : same(E.x, m.x);
      if (!aligned) {
        // keep entering the end the way it did before
        if (want === 'h') {
          if (o[k] === 'h') {
            const xm = mid(m.x, E.x);
            insertAfter = [{ x: xm, y: m.y }, { x: xm, y: E.y }];
          } else insertAfter = [{ x: E.x, y: m.y }];
        } else if (o[k] === 'v') {
          const ym = mid(m.y, E.y);
          insertAfter = [{ x: m.x, y: ym }, { x: E.x, y: ym }];
        } else insertAfter = [{ x: m.x, y: E.y }];
      }
    } else if (want === o[k]) {
      if (want === 'h') pts[k + 1].y = m.y;
      else pts[k + 1].x = m.x;
    } else {
      insertAfter = [want === 'h' ? { x: pts[k + 1].x, y: m.y } : { x: m.x, y: pts[k + 1].y }];
    }
    const corners = pts.slice(1, -1);
    const ci = idx;
    w.points = [...corners.slice(0, ci), ...insertBefore, corners[ci], ...insertAfter, ...corners.slice(ci + 1)];
  });
}

/** Drag segment `seg` (index in the full polyline) of an orthogonal wire sideways to `m`. */
export function dragSegment(orig: Doc, wireId: string, seg: number, m: Vec): Doc {
  return produce(orig, (d) => {
    const w = d.wires[wireId];
    const full = wireFull(orig, orig.wires[wireId]);
    const o = segOrients(full)[seg];
    const pts = full.map((p) => ({ ...p }));
    let i = seg, j = seg + 1;
    if (i === 0) {
      pts.splice(1, 0, { ...pts[0] });
      i = 1;
      j = 2;
    }
    if (j === pts.length - 1) pts.splice(j, 0, { ...pts[j] });
    if (o === 'h') pts[i].y = pts[j].y = m.y;
    else pts[i].x = pts[j].x = m.x;
    w.points = pts.slice(1, -1);
  });
}

/** Insert a corner on a wire at point p (on segment `seg` of the full polyline). */
export function insertCorner(d: Doc, wireId: string, seg: number, p: Vec, grid: number) {
  const w = d.wires[wireId];
  const full = wireFull(d, w);
  const a = full[seg], b = full[seg + 1];
  const pt = projectOnSegment(p, a, b).point;
  if (!w.ortho) {
    w.points.splice(seg, 0, pt);
    return;
  }
  // orthogonal: insert a flat "bump" that can be dragged out into a detour
  const horiz = Math.abs(a.y - b.y) < Math.abs(a.x - b.x);
  const half = Math.max(1, Math.min(grid * 2, (Math.abs(b.x - a.x) + Math.abs(b.y - a.y)) / 4));
  let p1: Vec, p2: Vec;
  if (horiz) {
    const s = Math.sign(b.x - a.x) || 1;
    const c = Math.max(Math.min(snapN(pt.x, grid), Math.max(a.x, b.x) - half), Math.min(a.x, b.x) + half);
    p1 = { x: c - s * half, y: a.y };
    p2 = { x: c + s * half, y: a.y };
  } else {
    const s = Math.sign(b.y - a.y) || 1;
    const c = Math.max(Math.min(snapN(pt.y, grid), Math.max(a.y, b.y) - half), Math.min(a.y, b.y) + half);
    p1 = { x: a.x, y: c - s * half };
    p2 = { x: a.x, y: c + s * half };
  }
  w.points.splice(seg, 0, p1, { ...p1 }, p2, { ...p2 });
}

/** Resize an object to a new world-space bounding box. */
export function resizeObject(orig: Doc, id: string, nb: Rect, grid: number): Doc {
  return produce(orig, (d) => {
    const o = d.objects[id];
    const ob = orig.objects[id];
    const swap = ob.rot === 90 || ob.rot === 270;
    const nw = Math.max(swap ? nb.h : nb.w, 4);
    const nh = Math.max(swap ? nb.w : nb.h, 4);
    const sx = nw / ob.w, sy = nh / ob.h;
    for (const s of o.shapes) {
      if (s.kind === 'poly') {
        s.points = (s.points ?? []).map((p) => ({ x: p.x * sx, y: p.y * sy }));
        continue;
      }
      const cx = (s.x + s.w / 2) * sx, cy = (s.y + s.h / 2) * sy;
      const r = s.rot === 90 || s.rot === 270;
      s.w *= r ? sy : sx;
      s.h *= r ? sx : sy;
      s.x = cx - s.w / 2;
      s.y = cy - s.h / 2;
    }
    for (const p of o.ports) {
      p.x *= sx;
      p.y *= sy;
    }
    const wsx = nb.w / objBBox(ob).w, wsy = nb.h / objBBox(ob).h;
    o.labelOffset = { x: ob.labelOffset.x * wsx, y: ob.labelOffset.y * wsy };
    o.w = nw;
    o.h = nh;
    o.x = nb.x + nb.w / 2 - nw / 2;
    o.y = nb.y + nb.h / 2 - nh / 2;
    reconcileWires(orig, d, grid);
  });
}

/** Local position for a node placed at world point m on object o (snapped to grid and edges). */
export function portLocalAt(o: Obj, m: Vec, grid: number, snap: boolean): Vec {
  let p = worldToLocal(o, m);
  if (snap) p = snapV(p, grid);
  p.x = Math.max(0, Math.min(o.w, p.x));
  p.y = Math.max(0, Math.min(o.h, p.y));
  const edge = Math.max(grid, 8);
  const raw = worldToLocal(o, m);
  if (raw.x < edge) p.x = 0;
  else if (o.w - raw.x < edge) p.x = o.w;
  if (raw.y < edge) p.y = 0;
  else if (o.h - raw.y < edge) p.y = o.h;
  return p;
}

export function movePort(orig: Doc, objId: string, portId: string, m: Vec, grid: number, snap: boolean): Doc {
  return produce(orig, (d) => {
    const o = d.objects[objId];
    const p = o.ports.find((x) => x.id === portId)!;
    const op = orig.objects[objId].ports.find((x) => x.id === portId)!;
    const lp = portLocalAt(o, m, grid, snap);
    p.x = lp.x;
    p.y = lp.y;
    const od = portDir(orig.objects[objId], op), nd = portDir(o, p);
    if (!eq(od, nd)) p.labelOffset = defaultPortLabelOffset(o, p);
    reconcileWires(orig, d, grid);
  });
}

/** Rotate (by +90) or flip the given objects around their own centers. */
export function transformObjects(orig: Doc, ids: string[], op: 'rotate' | 'flipX' | 'flipY', grid: number): Doc {
  return produce(orig, (d) => {
    for (const id of ids) {
      const o = d.objects[id];
      if (!o) continue;
      if (op === 'rotate') o.rot = (((o.rot + 90) % 360) as Obj['rot']);
      else if (op === 'flipX') o.flipX = !o.flipX;
      else {
        o.flipX = !o.flipX;
        o.rot = (((o.rot + 180) % 360) as Obj['rot']);
      }
      // keep the rotated bounding box on the grid
      const bb = objBBox(o);
      const c = objCenter(o);
      const nx = snapN(bb.x, grid) - bb.x, ny = snapN(bb.y, grid) - bb.y;
      o.x = c.x + nx - o.w / 2;
      o.y = c.y + ny - o.h / 2;
      // keep port labels outside the body
      for (const p of o.ports) p.labelOffset = defaultPortLabelOffset(o, p);
    }
    reconcileWires(orig, d, grid);
  });
}

export const translate = (p: Vec, dlt: Vec) => add(p, dlt);
export { endpointPos };
