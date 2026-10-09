import type { Obj, Port, Rect, Rot, Vec } from './types';

export const v = (x: number, y: number): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Vec, s: number): Vec => ({ x: a.x * s, y: a.y * s });
export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
export const eq = (a: Vec, b: Vec, eps = 0.01) => Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;
export const norm = (a: Vec): Vec => {
  const l = Math.hypot(a.x, a.y);
  return l < 1e-9 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
};
export const snapN = (n: number, g: number) => Math.round(n / g) * g;
export const snapV = (p: Vec, g: number): Vec => ({ x: snapN(p.x, g), y: snapN(p.y, g) });

/** Rotate a vector clockwise (screen coords, y down) by a multiple of 90 degrees. */
export function rotVec(p: Vec, rot: number): Vec {
  switch (((rot % 360) + 360) % 360) {
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

export const objCenter = (o: Obj): Vec => ({ x: o.x + o.w / 2, y: o.y + o.h / 2 });

export function localToWorld(o: Obj, p: Vec): Vec {
  let x = p.x - o.w / 2;
  const y = p.y - o.h / 2;
  if (o.flipX) x = -x;
  const r = rotVec({ x, y }, o.rot);
  const c = objCenter(o);
  return { x: r.x + c.x, y: r.y + c.y };
}

export function worldToLocal(o: Obj, p: Vec): Vec {
  const c = objCenter(o);
  const r = rotVec(sub(p, c), 360 - o.rot);
  if (o.flipX) r.x = -r.x;
  return { x: r.x + o.w / 2, y: r.y + o.h / 2 };
}

export function dirLocalToWorld(o: Obj, d: Vec): Vec {
  const x = o.flipX ? -d.x : d.x;
  return rotVec({ x, y: d.y }, o.rot);
}

export function objBBox(o: Obj): Rect {
  const c = objCenter(o);
  const swap = o.rot === 90 || o.rot === 270;
  const w = swap ? o.h : o.w;
  const h = swap ? o.w : o.h;
  return { x: c.x - w / 2, y: c.y - h / 2, w, h };
}

export const portWorld = (o: Obj, p: Port): Vec => localToWorld(o, p);

/** Outward direction of a port: toward the nearest edge of its object. */
export function portLocalDir(o: Obj, p: Port): Vec {
  const dl = p.x, dr = o.w - p.x, dt = p.y, db = o.h - p.y;
  const m = Math.min(dl, dr, dt, db);
  if (m === dl) return { x: -1, y: 0 };
  if (m === dr) return { x: 1, y: 0 };
  if (m === dt) return { x: 0, y: -1 };
  return { x: 0, y: 1 };
}

export const portDir = (o: Obj, p: Port): Vec => dirLocalToWorld(o, portLocalDir(o, p));

export function rectContains(r: Rect, p: Vec, pad = 0) {
  return p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;
}

export function rectInside(inner: Rect, outer: Rect) {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

export function rectFromPoints(a: Vec, b: Vec): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

export function unionRect(rs: Rect[]): Rect | null {
  if (!rs.length) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const r of rs) {
    x1 = Math.min(x1, r.x);
    y1 = Math.min(y1, r.y);
    x2 = Math.max(x2, r.x + r.w);
    y2 = Math.max(y2, r.y + r.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export function pointsBBox(pts: Vec[]): Rect {
  return unionRect(pts.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })))!;
}

/** Closest point on segment ab to p, with parameter t in [0,1]. */
export function projectOnSegment(p: Vec, a: Vec, b: Vec): { point: Vec; t: number; d: number } {
  const ab = sub(b, a);
  const l2 = ab.x * ab.x + ab.y * ab.y;
  let t = l2 < 1e-9 ? 0 : ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / l2;
  t = Math.max(0, Math.min(1, t));
  const point = add(a, mul(ab, t));
  return { point, t, d: dist(p, point) };
}

/** Closest point on a polyline. */
export function projectOnPolyline(p: Vec, pts: Vec[]) {
  let best = { seg: 0, point: pts[0], d: Infinity };
  for (let i = 0; i < pts.length - 1; i++) {
    const r = projectOnSegment(p, pts[i], pts[i + 1]);
    if (r.d < best.d) best = { seg: i, point: r.point, d: r.d };
  }
  return best;
}

/** SVG path for a polyline with rounded corners. */
export function roundedPath(pts: Vec[], radius: number): string {
  if (pts.length < 2) return '';
  const f = (n: number) => Math.round(n * 100) / 100;
  let d = `M${f(pts[0].x)},${f(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1], c = pts[i], next = pts[i + 1];
    const lin = dist(prev, c), lout = dist(c, next);
    const din = norm(sub(c, prev)), dout = norm(sub(next, c));
    const cross = din.x * dout.y - din.y * dout.x;
    const r = Math.min(radius, lin / 2, lout / 2);
    if (r < 0.5 || Math.abs(cross) < 1e-3) {
      d += ` L${f(c.x)},${f(c.y)}`;
      continue;
    }
    const p1 = sub(c, mul(din, r));
    const p2 = add(c, mul(dout, r));
    d += ` L${f(p1.x)},${f(p1.y)} Q${f(c.x)},${f(c.y)} ${f(p2.x)},${f(p2.y)}`;
  }
  const l = pts[pts.length - 1];
  d += ` L${f(l.x)},${f(l.y)}`;
  return d;
}

/** Remove duplicate and collinear points (keeps first and last). */
export function simplifyPolyline(pts: Vec[]): Vec[] {
  const out: Vec[] = [];
  for (const p of pts) {
    if (out.length && eq(out[out.length - 1], p)) continue;
    out.push({ x: p.x, y: p.y });
  }
  let changed = true;
  while (changed && out.length > 2) {
    changed = false;
    for (let i = 1; i < out.length - 1; i++) {
      const a = out[i - 1], b = out[i], c = out[i + 1];
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      const dot = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
      if (Math.abs(cross) < 0.01 && dot >= 0) {
        out.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return out;
}

export const isHoriz = (a: Vec, b: Vec) => Math.abs(a.y - b.y) <= Math.abs(a.x - b.x);

export function composeOrient(outerRot: Rot, outerFlip: boolean, innerRot: Rot, innerFlip: boolean): { rot: Rot; flipX: boolean } {
  const r = outerFlip ? outerRot - innerRot : outerRot + innerRot;
  return { rot: ((((r % 360) + 360) % 360) as Rot), flipX: outerFlip !== innerFlip };
}
