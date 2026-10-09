import type { Doc, Endpoint, Junction, Obj, Port, Rect, Shape, Vec, Wire, WireStyle } from './types';
import {
  composeOrient, dist, eq, localToWorld, objBBox, objCenter, portDir, portWorld, projectOnPolyline,
  pointsBBox, simplifyPolyline, snapN, sub, unionRect, worldToLocal,
} from './geometry';
import { COST_LABEL, COST_OBJECT, routeOrtho, type Obstacle, type RouteContext, type Seg } from './router';

let counter = 0;
export const uid = (p = '') => `${p}${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const defaultWireStyle: WireStyle = {
  color: '#1f2937',
  width: 2,
  dash: 'solid',
  radius: 8,
  arrowA: false,
  arrowB: false,
};

export function newShape(kind: Shape['kind'], p: Partial<Shape> = {}): Shape {
  return {
    id: uid('s'),
    kind,
    x: 0,
    y: 0,
    w: 100,
    h: 60,
    rot: 0,
    flipX: false,
    stroke: '#1f2937',
    fill: kind === 'rect' || kind === 'ellipse' ? '#ffffff' : 'none',
    strokeWidth: 2,
    dash: 'solid',
    radius: kind === 'rect' ? 4 : 0,
    text: '',
    fontSize: 14,
    textColor: '#1f2937',
    ...p,
  };
}

export function newObj(p: Partial<Obj> & { w: number; h: number }): Obj {
  return {
    id: uid('o'),
    x: 0,
    y: 0,
    rot: 0,
    flipX: false,
    label: '',
    showLabel: true,
    labelOffset: { x: 0, y: p.h / 2 + 16 },
    shapes: [],
    ports: [],
    ...p,
  };
}

/** Default label offset for a port: just outside, next to the port, away from the body. */
export function defaultPortLabelOffset(o: Obj, port: Port): Vec {
  const d = portDir(o, port);
  if (Math.abs(d.x) > 0.5) return { x: d.x * 8, y: -6 };
  return { x: 6, y: d.y > 0 ? 14 : -8 };
}

export function newPort(o: Obj, local: Vec, name: string): Port {
  const p: Port = { id: uid('p'), name, number: '', net: '', x: local.x, y: local.y, showLabel: true, labelOffset: { x: 0, y: 0 } };
  p.labelOffset = defaultPortLabelOffset(o, p);
  return p;
}

export function nextPortName(o: Obj): string {
  let i = o.ports.length + 1;
  const names = new Set(o.ports.map((p) => p.name));
  while (names.has(`N${i}`)) i++;
  return `N${i}`;
}

// ---------------------------------------------------------------- endpoints

export function findPort(doc: Doc, obj: string, port: string): { o: Obj; p: Port } | null {
  const o = doc.objects[obj];
  if (!o) return null;
  const p = o.ports.find((x) => x.id === port);
  return p ? { o, p } : null;
}

export function endpointPos(doc: Doc, ep: Endpoint): Vec {
  if (ep.kind === 'port') {
    const r = findPort(doc, ep.obj, ep.port);
    return r ? portWorld(r.o, r.p) : { x: 0, y: 0 };
  }
  const j = doc.junctions[ep.id];
  return j ? { x: j.x, y: j.y } : { x: 0, y: 0 };
}

export function endpointDir(doc: Doc, ep: Endpoint): Vec | null {
  if (ep.kind === 'port') {
    const r = findPort(doc, ep.obj, ep.port);
    return r ? portDir(r.o, r.p) : null;
  }
  return null;
}

export const sameEndpoint = (a: Endpoint, b: Endpoint) =>
  a.kind === 'port' && b.kind === 'port' ? a.obj === b.obj && a.port === b.port : a.kind === 'junction' && b.kind === 'junction' && a.id === b.id;

export const epKey = (ep: Endpoint) => (ep.kind === 'port' ? `p:${ep.obj}:${ep.port}` : `j:${ep.id}`);

export function wireFull(doc: Doc, w: Wire): Vec[] {
  return [endpointPos(doc, w.a), ...w.points, endpointPos(doc, w.b)];
}

// ---------------------------------------------------------------- orthogonal helpers

export type Orient = 'h' | 'v';

/** Orientation of each segment of an orthogonal polyline (degenerate ones inferred by alternation). */
export function segOrients(full: Vec[]): Orient[] {
  const n = full.length - 1;
  const o: (Orient | null)[] = [];
  for (let i = 0; i < n; i++) {
    const dx = Math.abs(full[i + 1].x - full[i].x), dy = Math.abs(full[i + 1].y - full[i].y);
    o.push(dx < 0.01 && dy < 0.01 ? null : dx >= dy ? 'h' : 'v');
  }
  const flip = (x: Orient): Orient => (x === 'h' ? 'v' : 'h');
  const known = o.findIndex((x) => x !== null);
  if (known < 0) return o.map((_, i) => (i % 2 ? 'v' : 'h'));
  const res: Orient[] = o.slice() as Orient[];
  for (let i = 0; i < n; i++) {
    if (o[i] !== null) continue;
    // nearest known on the left, else right
    let j = i - 1;
    while (j >= 0 && o[j] === null) j--;
    if (j >= 0) {
      res[i] = (i - j) % 2 ? flip(o[j]!) : o[j]!;
    } else {
      j = i + 1;
      while (j < n && o[j] === null) j++;
      res[i] = (j - i) % 2 ? flip(o[j]!) : o[j]!;
    }
  }
  return res;
}

const horiz = (d: Vec) => Math.abs(d.x) > Math.abs(d.y);

/** Corner points for an orthogonal connection between a and b with no existing corners. */
export function orthoElbow(a: Vec, b: Vec, aDir: Vec | null, bDir: Vec | null, grid: number): Vec[] {
  if (Math.abs(a.x - b.x) < 0.01 || Math.abs(a.y - b.y) < 0.01) return [];
  const aH = aDir ? horiz(aDir) : bDir ? !horiz(bDir) : Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
  const bH = bDir ? horiz(bDir) : !aH;
  if (aH && bH) {
    const mx = snapN((a.x + b.x) / 2, grid);
    return [{ x: mx, y: a.y }, { x: mx, y: b.y }];
  }
  if (!aH && !bH) {
    const my = snapN((a.y + b.y) / 2, grid);
    return [{ x: a.x, y: my }, { x: b.x, y: my }];
  }
  if (aH) return [{ x: b.x, y: a.y }];
  return [{ x: a.x, y: b.y }];
}

/**
 * Keep an orthogonal wire orthogonal after its endpoints moved, by sliding only
 * the first / last segments ("stretch the last segments").
 */
export function orthoStretch(origFull: Vec[], a: Vec, b: Vec, corners: Vec[], aDir: Vec | null, bDir: Vec | null, grid: number): Vec[] {
  const n = corners.length;
  if (n === 0) return orthoElbow(a, b, aDir, bDir, grid);
  const o = segOrients(origFull);
  if (n === 1 && o[0] === o[1]) return orthoElbow(a, b, aDir, bDir, grid);
  const c = corners.map((p) => ({ x: p.x, y: p.y }));
  if (o[0] === 'h') c[0].y = a.y;
  else c[0].x = a.x;
  if (o[n] === 'h') c[n - 1].y = b.y;
  else c[n - 1].x = b.x;
  return c;
}

/** Remove redundant corners of a wire. */
export function normalizeWire(doc: Doc, w: Wire) {
  const full = simplifyPolyline(wireFull(doc, w));
  if (full.length >= 2) w.points = full.slice(1, -1);
  else w.points = [];
}

/**
 * After objects / junctions moved from `orig` to `next`, update the corners of every
 * affected wire in `next`. Wires in `translateWires` (or with both ends moving by the
 * same delta) are shifted by `delta`; other affected wires stretch their end segments.
 */
export function reconcileWires(orig: Doc, next: Doc, grid: number, delta: Vec | null = null, translateWires: Set<string> = new Set()) {
  for (const id in next.wires) {
    const w = next.wires[id];
    const ow = orig.wires[id];
    if (!ow) continue;
    const oa = endpointPos(orig, ow.a), ob = endpointPos(orig, ow.b);
    const na = endpointPos(next, w.a), nb = endpointPos(next, w.b);
    const aMoved = !eq(oa, na), bMoved = !eq(ob, nb);
    const translate = !!delta && (translateWires.has(id) || (aMoved && bMoved && eq(sub(na, oa), delta) && eq(sub(nb, ob), delta)));
    if (!aMoved && !bMoved && !translate) continue;
    let corners = ow.points.map((p) => (translate ? { x: p.x + delta!.x, y: p.y + delta!.y } : { ...p }));
    if (w.ortho) {
      const origFull = [oa, ...ow.points, ob];
      corners = orthoStretch(origFull, na, nb, corners, endpointDir(next, w.a), endpointDir(next, w.b), grid);
    }
    w.points = corners;
  }
}

// ---------------------------------------------------------------- junctions

export function wiresAt(doc: Doc, ep: Endpoint): Wire[] {
  return Object.values(doc.wires).filter((w) => sameEndpoint(w.a, ep) || sameEndpoint(w.b, ep));
}

export function junctionDegree(doc: Doc, id: string): number {
  let n = 0;
  for (const w of Object.values(doc.wires)) {
    if (w.a.kind === 'junction' && w.a.id === id) n++;
    if (w.b.kind === 'junction' && w.b.id === id) n++;
  }
  return n;
}

/** Split a wire at a point on segment `seg` (index in the full polyline); returns the new junction id. */
export function splitWire(d: Doc, wireId: string, seg: number, point: Vec): string {
  const w = d.wires[wireId];
  const jid = uid('j');
  d.junctions[jid] = { id: jid, x: point.x, y: point.y };
  const w1: Wire = { ...w, id: uid('w'), b: { kind: 'junction', id: jid }, points: w.points.slice(0, seg), arrowB: false };
  const w2: Wire = { ...w, id: uid('w'), a: { kind: 'junction', id: jid }, points: w.points.slice(seg), arrowA: false };
  delete d.wires[wireId];
  d.wires[w1.id] = w1;
  d.wires[w2.id] = w2;
  return jid;
}

const reverseWire = (w: Wire): Wire => ({ ...w, a: w.b, b: w.a, points: w.points.slice().reverse(), arrowA: w.arrowB, arrowB: w.arrowA });

/** Remove orphan junctions and merge wires through junctions with exactly two wires. */
export function cleanupJunctions(d: Doc) {
  // wires pointing at missing endpoints are dropped
  for (const w of Object.values(d.wires)) {
    for (const ep of [w.a, w.b]) {
      if (ep.kind === 'port' ? !findPort(d, ep.obj, ep.port) : !d.junctions[ep.id]) {
        delete d.wires[w.id];
        break;
      }
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const j of Object.values(d.junctions)) {
      const ep: Endpoint = { kind: 'junction', id: j.id };
      const ws = wiresAt(d, ep);
      if (ws.length === 0) {
        delete d.junctions[j.id];
        changed = true;
      } else if (ws.length === 2 && ws[0].id !== ws[1].id) {
        let w1 = ws[0], w2 = ws[1];
        if (!sameEndpoint(w1.b, ep)) w1 = reverseWire(w1);
        if (!sameEndpoint(w2.a, ep)) w2 = reverseWire(w2);
        if (sameEndpoint(w1.a, w2.b)) continue; // would create a closed loop
        const merged: Wire = { ...w1, b: w2.b, points: [...w1.points, { x: j.x, y: j.y }, ...w2.points], arrowB: w2.arrowB };
        delete d.wires[ws[0].id];
        delete d.wires[ws[1].id];
        delete d.junctions[j.id];
        d.wires[merged.id] = merged;
        normalizeWire(d, merged);
        changed = true;
      }
      if (changed) break;
    }
  }
}

// ---------------------------------------------------------------- deletion

export function deleteItems(d: Doc, ids: Set<string>, port?: { obj: string; port: string } | null) {
  for (const id of ids) {
    if (d.objects[id]) {
      delete d.objects[id];
      d.order = d.order.filter((x) => x !== id);
    }
    if (d.wires[id]) delete d.wires[id];
    if (d.junctions[id]) {
      for (const w of wiresAt(d, { kind: 'junction', id })) delete d.wires[w.id];
      delete d.junctions[id];
    }
  }
  if (port && d.objects[port.obj]) {
    const o = d.objects[port.obj];
    o.ports = o.ports.filter((p) => p.id !== port.port);
  }
  cleanupJunctions(d);
}

// ---------------------------------------------------------------- routing

/** Approximate world-space boxes of all visible labels. */
export function labelBoxes(doc: Doc): Rect[] {
  const out: Rect[] = [];
  for (const o of Object.values(doc.objects)) {
    if (o.showLabel && o.label) {
      const c = objCenter(o);
      const lines = o.label.split('\n');
      const w = Math.max(...lines.map((l) => l.length)) * 13 * 0.6, h = lines.length * 16;
      out.push({ x: c.x + o.labelOffset.x - w / 2, y: c.y + o.labelOffset.y - h / 2, w, h });
    }
    for (const p of o.ports) {
      if (!p.showLabel) continue;
      const text = (p.number ? `${p.name} (${p.number})` : p.name) + (p.net ? ` [${p.net}]` : '');
      if (!text.trim()) continue;
      const w = text.length * 6, h = 10;
      const wp = portWorld(o, p);
      const x = wp.x + p.labelOffset.x, y = wp.y + p.labelOffset.y;
      const left = p.labelOffset.x < -2 ? x - w : p.labelOffset.x > 2 ? x : x - w / 2;
      out.push({ x: left, y: y - h / 2, w, h });
    }
  }
  return out;
}

export function routeContext(doc: Doc, excludeWires: Set<string>, grid: number): RouteContext {
  const obstacles: Obstacle[] = Object.values(doc.objects).map((o) => ({ ...objBBox(o), cost: COST_OBJECT }));
  for (const r of labelBoxes(doc)) obstacles.push({ ...r, cost: COST_LABEL, soft: true });
  const segments: Seg[] = [];
  for (const w of Object.values(doc.wires)) {
    if (excludeWires.has(w.id)) continue;
    const f = wireFull(doc, w);
    for (let i = 0; i < f.length - 1; i++) segments.push({ a: f[i], b: f[i + 1] });
  }
  return { obstacles, segments, grid };
}

/** Corner points of an automatic orthogonal route between two endpoints. */
export function autoRoute(doc: Doc, a: Endpoint, b: Endpoint, excludeWires: Set<string>, grid: number): Vec[] {
  const pa = endpointPos(doc, a), pb = endpointPos(doc, b);
  const da = endpointDir(doc, a), db = endpointDir(doc, b);
  const full = routeOrtho(pa, da, pb, db, routeContext(doc, excludeWires, grid));
  if (!full) return orthoElbow(pa, pb, da, db, grid);
  return full.slice(1, -1);
}

/** Re-route the given wires to reduce crossings and collisions; snap the rest to the grid. */
export function organizeWires(d: Doc, ids: string[], grid: number) {
  const ortho = ids.filter((id) => d.wires[id]?.ortho);
  for (const id of ids) {
    const w = d.wires[id];
    if (w && !w.ortho) w.points = w.points.map((p) => ({ x: snapN(p.x, grid), y: snapN(p.y, grid) }));
  }
  const len = (id: string) => {
    const w = d.wires[id];
    const a = endpointPos(d, w.a), b = endpointPos(d, w.b);
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  };
  ortho.sort((x, y) => len(x) - len(y));
  // pass 1: rip up everything, then add wires back one by one (shortest first)
  const pending = new Set(ortho);
  for (const id of ortho) {
    const w = d.wires[id];
    w.points = autoRoute(d, w.a, w.b, pending, grid);
    pending.delete(id);
  }
  // pass 2: improve each wire with all others in place
  for (const id of ortho) {
    const w = d.wires[id];
    w.points = autoRoute(d, w.a, w.b, new Set([id]), grid);
  }
}

// ---------------------------------------------------------------- group / ungroup

function bakeShape(o: Obj, s: Shape, origin: Vec): Shape {
  if (s.kind === 'poly') {
    return { ...s, points: (s.points ?? []).map((p) => sub(localToWorld(o, p), origin)) };
  }
  const c = sub(localToWorld(o, { x: s.x + s.w / 2, y: s.y + s.h / 2 }), origin);
  const or = composeOrient(o.rot, o.flipX, s.rot, s.flipX);
  return { ...s, x: c.x - s.w / 2, y: c.y - s.h / 2, rot: or.rot, flipX: or.flipX };
}

export function groupObjects(d: Doc, ids: string[]): string | null {
  const objs = d.order.filter((id) => ids.includes(id)).map((id) => d.objects[id]);
  if (objs.length < 2) return null;
  const bb = unionRect(objs.map(objBBox))!;
  const origin = { x: bb.x, y: bb.y };
  const g = newObj({ x: bb.x, y: bb.y, w: bb.w, h: bb.h, showLabel: true, label: '' });
  for (const o of objs) {
    for (const s of o.shapes) g.shapes.push(bakeShape(o, s, origin));
    if (o.label && o.showLabel) {
      const c = sub(objCenter(o), origin);
      const pos = { x: c.x + o.labelOffset.x, y: c.y + o.labelOffset.y };
      g.shapes.push(newShape('text', { x: pos.x - 60, y: pos.y - 10, w: 120, h: 20, text: o.label, fontSize: 13, stroke: 'none' }));
    }
    for (const p of o.ports) {
      const wp = sub(portWorld(o, p), origin);
      g.ports.push({ ...p, x: wp.x, y: wp.y });
    }
  }
  const idx = Math.max(...objs.map((o) => d.order.indexOf(o.id)));
  const objIds = new Set(objs.map((o) => o.id));
  for (const w of Object.values(d.wires)) {
    for (const ep of [w.a, w.b]) if (ep.kind === 'port' && objIds.has(ep.obj)) ep.obj = g.id;
  }
  d.order.splice(idx + 1, 0, g.id);
  d.order = d.order.filter((id) => !objIds.has(id));
  for (const id of objIds) delete d.objects[id];
  d.objects[g.id] = g;
  return g.id;
}

export function ungroupObject(d: Doc, id: string): string[] {
  const o = d.objects[id];
  if (!o || o.shapes.length < 2) return [id];
  const parts: Obj[] = [];
  for (const s of o.shapes) {
    if (s.kind === 'poly') {
      const pts = (s.points ?? []).map((p) => localToWorld(o, p));
      const bb = pointsBBox(pts);
      const w = Math.max(bb.w, 1), h = Math.max(bb.h, 1);
      parts.push(newObj({ x: bb.x, y: bb.y, w, h, label: '', shapes: [{ ...s, points: pts.map((p) => sub(p, bb)) }] }));
    } else {
      const c = localToWorld(o, { x: s.x + s.w / 2, y: s.y + s.h / 2 });
      const or = composeOrient(o.rot, o.flipX, s.rot, s.flipX);
      parts.push(newObj({ x: c.x - s.w / 2, y: c.y - s.h / 2, w: s.w, h: s.h, rot: or.rot, flipX: or.flipX, label: '', shapes: [{ ...s, x: 0, y: 0, rot: 0, flipX: false }] }));
    }
  }
  if (o.label) {
    parts[0].label = o.label;
    parts[0].showLabel = o.showLabel;
  }
  const portOwner = new Map<string, string>();
  for (const p of o.ports) {
    const wp = portWorld(o, p);
    let best = parts[0], bd = Infinity;
    for (const part of parts) {
      const b = objBBox(part);
      const dx = Math.max(b.x - wp.x, 0, wp.x - (b.x + b.w));
      const dy = Math.max(b.y - wp.y, 0, wp.y - (b.y + b.h));
      const dd = Math.hypot(dx, dy);
      if (dd < bd) {
        bd = dd;
        best = part;
      }
    }
    const lp = worldToLocal(best, wp);
    best.ports.push({ ...p, x: lp.x, y: lp.y });
    portOwner.set(p.id, best.id);
  }
  for (const w of Object.values(d.wires)) {
    for (const ep of [w.a, w.b]) if (ep.kind === 'port' && ep.obj === id) ep.obj = portOwner.get(ep.port) ?? ep.obj;
  }
  const idx = d.order.indexOf(id);
  d.order.splice(idx, 1, ...parts.map((p) => p.id));
  delete d.objects[id];
  for (const p of parts) d.objects[p.id] = p;
  return parts.map((p) => p.id);
}

// ---------------------------------------------------------------- copy / paste

export interface Clip {
  kind: 'schematizer-clip';
  objects: Obj[];
  wires: Wire[];
  junctions: Junction[];
}

/**
 * Copy the selection. A wire is included only when both of its ends are included
 * (a port of a selected object, or a junction that sits between included things).
 */
export function copySelection(doc: Doc, sel: Set<string>): Clip | null {
  const objIds = new Set([...sel].filter((id) => doc.objects[id]));
  const jIds = new Set([...sel].filter((id) => doc.junctions[id]));
  const inEp = (ep: Endpoint) => (ep.kind === 'port' ? objIds.has(ep.obj) : jIds.has(ep.id));
  // junctions reachable "between" selected items are included too
  let grew = true;
  while (grew) {
    grew = false;
    for (const j of Object.values(doc.junctions)) {
      if (jIds.has(j.id)) continue;
      const ep: Endpoint = { kind: 'junction', id: j.id };
      const others = wiresAt(doc, ep).map((w) => (sameEndpoint(w.a, ep) ? w.b : w.a));
      const inside = others.filter(inEp).length;
      const selectedWire = wiresAt(doc, ep).some((w) => sel.has(w.id));
      if (inside >= 2 || (inside >= 1 && selectedWire)) {
        jIds.add(j.id);
        grew = true;
      }
    }
  }
  const wires = Object.values(doc.wires).filter((w) => inEp(w.a) && inEp(w.b));
  if (!objIds.size && !wires.length) return null;
  const used = new Set<string>();
  for (const w of wires) for (const ep of [w.a, w.b]) if (ep.kind === 'junction') used.add(ep.id);
  return {
    kind: 'schematizer-clip',
    objects: doc.order.filter((id) => objIds.has(id)).map((id) => doc.objects[id]),
    wires,
    junctions: [...used].map((id) => doc.junctions[id]),
  };
}

/** Paste a clip into the doc (offset by `delta`), with fresh ids. Returns new selection ids. */
export function pasteClip(d: Doc, clip: Clip, delta: Vec): string[] {
  const objMap = new Map<string, string>();
  const portMap = new Map<string, string>();
  const jMap = new Map<string, string>();
  const out: string[] = [];
  for (const o of clip.objects) {
    const nid = uid('o');
    objMap.set(o.id, nid);
    const ports = o.ports.map((p) => {
      const pid = uid('p');
      portMap.set(`${o.id}:${p.id}`, pid);
      return { ...p, id: pid, labelOffset: { ...p.labelOffset } };
    });
    const shapes = o.shapes.map((s) => ({ ...s, id: uid('s'), points: s.points?.map((p) => ({ ...p })) }));
    d.objects[nid] = { ...o, id: nid, x: o.x + delta.x, y: o.y + delta.y, ports, shapes, labelOffset: { ...o.labelOffset } };
    d.order.push(nid);
    out.push(nid);
  }
  for (const j of clip.junctions) {
    const nid = uid('j');
    jMap.set(j.id, nid);
    d.junctions[nid] = { id: nid, x: j.x + delta.x, y: j.y + delta.y };
    out.push(nid);
  }
  const mapEp = (ep: Endpoint): Endpoint | null => {
    if (ep.kind === 'port') {
      const obj = objMap.get(ep.obj), port = portMap.get(`${ep.obj}:${ep.port}`);
      return obj && port ? { kind: 'port', obj, port } : null;
    }
    const id = jMap.get(ep.id);
    return id ? { kind: 'junction', id } : null;
  };
  for (const w of clip.wires) {
    const a = mapEp(w.a), b = mapEp(w.b);
    if (!a || !b) continue;
    const nid = uid('w');
    d.wires[nid] = { ...w, id: nid, a, b, points: w.points.map((p) => ({ x: p.x + delta.x, y: p.y + delta.y })) };
    out.push(nid);
  }
  return out;
}

// ---------------------------------------------------------------- nets

/** Map from endpoint key to net root. Ports with the same net label are joined. */
export function computeNets(doc: Doc): Map<string, string> {
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let r = k;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    parent.set(k, r);
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const o of Object.values(doc.objects)) {
    for (const p of o.ports) {
      const k = `p:${o.id}:${p.id}`;
      find(k);
      if (p.net.trim()) union(k, `net:${p.net.trim()}`);
    }
  }
  for (const j of Object.values(doc.junctions)) find(`j:${j.id}`);
  for (const w of Object.values(doc.wires)) union(epKey(w.a), epKey(w.b));
  const res = new Map<string, string>();
  for (const k of parent.keys()) res.set(k, find(k));
  return res;
}

export function netOfWire(doc: Doc, wireId: string): { wires: Set<string>; keys: Set<string> } {
  const nets = computeNets(doc);
  const w = doc.wires[wireId];
  const root = nets.get(epKey(w.a));
  const keys = new Set<string>();
  for (const [k, r] of nets) if (r === root) keys.add(k);
  const wires = new Set<string>();
  for (const x of Object.values(doc.wires)) if (keys.has(epKey(x.a))) wires.add(x.id);
  return { wires, keys };
}

// ---------------------------------------------------------------- misc

export function hitWire(doc: Doc, w: Wire, p: Vec) {
  return projectOnPolyline(p, wireFull(doc, w));
}

export function objectsBBox(doc: Doc, ids: Iterable<string>) {
  const rs = [];
  for (const id of ids) {
    if (doc.objects[id]) rs.push(objBBox(doc.objects[id]));
    else if (doc.junctions[id]) rs.push({ x: doc.junctions[id].x, y: doc.junctions[id].y, w: 0, h: 0 });
    else if (doc.wires[id]) rs.push(pointsBBox(wireFull(doc, doc.wires[id])));
  }
  return unionRect(rs);
}

export const distance = dist;
