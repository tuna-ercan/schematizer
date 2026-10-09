import React, { useEffect, useRef, useState } from 'react';
import { produce } from 'immer';
import type { Doc, Endpoint, Rect, Vec, Wire } from './types';
import { useStore } from './store';
import { Scene } from './Scene';
import {
  add, eq, objBBox, objCenter, pointsBBox, portWorld, projectOnPolyline, rectFromPoints, rectInside, roundedPath, snapN, snapV, sub, unionRect,
} from './geometry';
import {
  autoRoute, endpointDir, endpointPos, findPort, netOfWire, newObj, newPort, newShape, nextPortName, normalizeWire, orthoElbow,
  routeContext, splitWire, uid, wireFull,
} from './model';
import { routeOrtho } from './router';
import { applyMove, dragCorner, dragSegment, insertCorner, movePort, portLocalAt, resizeObject } from './edit';
import { pointer, addImageFile, addObject, copyToClip, deleteSelection, duplicate, group, organize, pasteFromText, rerouteWire, rotateOrFlip, selectAll, ungroup, zOrder, zoomToFit } from './actions';
import type { MenuItem } from './ContextMenu';
import { instantiate, type LibSymbol } from './symbols';
import { RULER, Rulers } from './Rulers';

type DrawEnd = Endpoint | { kind: 'wirept'; wire: string; seg: number; point: Vec };

type Interaction =
  | { kind: 'idle' }
  | { kind: 'pan'; start: Vec; pan0: Vec }
  | { kind: 'marquee'; start: Vec; cur: Vec; base: string[] }
  | { kind: 'move'; start: Vec; screen: Vec; orig: Doc; objs: Set<string>; juncs: Set<string>; wires: Set<string>; anchor: Vec; bb: Rect | null; moved: boolean; clicked: string; shift: boolean }
  | { kind: 'guide'; axis: 'v' | 'h'; idx: number; orig: Doc }
  | { kind: 'pendingPort'; obj: string; port: string; screen: Vec; orig: Doc; canDrag: boolean }
  | { kind: 'pendingJunction'; id: string; screen: Vec; start: Vec; orig: Doc }
  | { kind: 'movePort'; obj: string; port: string; orig: Doc }
  | { kind: 'label'; obj: string; port: string | null; start: Vec; off0: Vec; orig: Doc }
  | { kind: 'resize'; obj: string; fixed: Vec; bb0: Rect; orig: Doc }
  | { kind: 'corner'; wire: string; idx: number; orig: Doc; base: Doc }
  | { kind: 'segment'; wire: string; seg: number; orig: Doc; start: Vec; screen: Vec; moved: boolean }
  | { kind: 'wire'; from: DrawEnd; points: Vec[] }
  | { kind: 'box'; start: Vec; cur: Vec }
  | { kind: 'line'; points: Vec[]; cur: Vec };

interface Target {
  kind: string | null;
  id?: string;
  obj?: string;
  port?: string;
  seg?: number;
  idx?: number;
  handle?: string;
}

interface Editor {
  x: number;
  y: number;
  value: string;
  multiline: boolean;
  apply: (v: string) => void;
}

/** Lets the global keyboard handler know about in-progress canvas interactions. */
export const canvasApi = {
  busy: () => false,
};

const DRAG_THRESHOLD = 4;

export function Canvas({ openMenu, onAddToLibrary }: { openMenu: (x: number, y: number, items: MenuItem[]) => void; onAddToLibrary: (objId: string) => void }) {
  const st = useStore();
  const { doc, sel, selPort, tool, pan, zoom, grid, snap, ortho, showGrid, highlight } = st;
  const svgRef = useRef<SVGSVGElement>(null);
  const ia = useRef<Interaction>({ kind: 'idle' });
  const [, force] = useState(0);
  const rerender = () => force((x) => x + 1);
  const [preview, setPreview] = useState<Vec[] | null>(null);
  const [hoverPort, setHoverPort] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const spaceDown = useRef(false);
  const routeCache = useRef<{ key: string; pts: Vec[] } | null>(null);
  const S = useStore.getState;

  canvasApi.busy = () => ia.current.kind !== 'idle' || !!editor;

  // ------------------------------------------------------------ coordinates
  const toWorld = (cx: number, cy: number): Vec => {
    const r = svgRef.current!.getBoundingClientRect();
    const { pan, zoom } = S();
    return { x: (cx - r.left - pan.x) / zoom, y: (cy - r.top - pan.y) / zoom };
  };
  const toScreen = (p: Vec): Vec => {
    const { pan, zoom } = S();
    return { x: p.x * zoom + pan.x, y: p.y * zoom + pan.y };
  };
  const snapPt = (p: Vec): Vec => (S().snap ? snapV(p, S().grid) : p);

  const getTarget = (el: EventTarget | null): Target => {
    const e = el as Element | null;
    if (!e || !e.closest) return { kind: null };
    const k = e.closest('[data-kind]');
    if (!k) return { kind: null };
    const segAttr = e.getAttribute('data-seg');
    return {
      kind: k.getAttribute('data-kind'),
      id: k.getAttribute('data-id') ?? undefined,
      obj: k.getAttribute('data-obj') ?? undefined,
      port: k.getAttribute('data-port') ?? undefined,
      seg: segAttr != null ? Number(segAttr) : undefined,
      idx: k.getAttribute('data-idx') != null ? Number(k.getAttribute('data-idx')) : undefined,
      handle: k.getAttribute('data-handle') ?? undefined,
    };
  };

  // ------------------------------------------------------------ wire drawing helpers
  const drawEndPos = (d: Doc, e: DrawEnd): Vec => (e.kind === 'wirept' ? e.point : endpointPos(d, e));
  const drawEndDir = (d: Doc, e: DrawEnd): Vec | null => {
    if (e.kind !== 'wirept') return endpointDir(d, e);
    const w = d.wires[e.wire];
    if (!w) return null;
    const f = wireFull(d, w);
    const a = f[e.seg], b = f[e.seg + 1];
    return Math.abs(a.y - b.y) < Math.abs(a.x - b.x) ? { x: 0, y: 1 } : { x: 1, y: 0 };
  };

  /** What a click while drawing a wire would connect to. */
  const resolveTarget = (t: Target, m: Vec, from: DrawEnd | null): DrawEnd | null => {
    const d = S().doc;
    if (t.kind === 'port' && t.obj && t.port) {
      if (from?.kind === 'port' && from.obj === t.obj && from.port === t.port) return null;
      return { kind: 'port', obj: t.obj, port: t.port };
    }
    if (t.kind === 'junction' && t.id) {
      if (from?.kind === 'junction' && from.id === t.id) return null;
      return { kind: 'junction', id: t.id };
    }
    if (t.kind === 'wire' && t.id && d.wires[t.id]) {
      const full = wireFull(d, d.wires[t.id]);
      const pr = projectOnPolyline(m, full);
      let pt = pr.point;
      const a = full[pr.seg], b = full[pr.seg + 1];
      if (S().snap) {
        if (Math.abs(a.y - b.y) < 0.01) pt = { x: Math.min(Math.max(snapN(pt.x, S().grid), Math.min(a.x, b.x)), Math.max(a.x, b.x)), y: a.y };
        else if (Math.abs(a.x - b.x) < 0.01) pt = { x: a.x, y: Math.min(Math.max(snapN(pt.y, S().grid), Math.min(a.y, b.y)), Math.max(a.y, b.y)) };
      }
      // landing exactly on the wire's end is the same as connecting to that end
      if (eq(pt, full[0])) return d.wires[t.id].a;
      if (eq(pt, full[full.length - 1])) return d.wires[t.id].b;
      return { kind: 'wirept', wire: t.id, seg: pr.seg, point: pt };
    }
    return null;
  };

  const constrained = (m: Vec, last: Vec): Vec => {
    const p = snapPt(m);
    if (!S().ortho) return p;
    return Math.abs(p.x - last.x) >= Math.abs(p.y - last.y) ? { x: p.x, y: last.y } : { x: last.x, y: p.y };
  };

  const materialize = (d: Doc, e: DrawEnd): Endpoint => {
    if (e.kind !== 'wirept') return e;
    let wid = e.wire, seg = e.seg;
    if (!d.wires[wid]) {
      // the wire was split already (both ends on the same wire): find the half that holds the point
      let best: { id: string; seg: number; d: number } | null = null;
      for (const w of Object.values(d.wires)) {
        const pr = projectOnPolyline(e.point, wireFull(d, w));
        if (!best || pr.d < best.d) best = { id: w.id, seg: pr.seg, d: pr.d };
      }
      if (!best || best.d > 1) return { kind: 'junction', id: (() => { const j = uid('j'); d.junctions[j] = { id: j, ...e.point }; return j; })() };
      wid = best.id;
      seg = best.seg;
    }
    return { kind: 'junction', id: splitWire(d, wid, seg, e.point) };
  };

  const finishWire = (from: DrawEnd, to: DrawEnd | Vec, corners: Vec[]) => {
    const { grid, ortho, wireStyle } = S();
    S().commit((d) => {
      const bDir = 'kind' in to ? drawEndDir(d, to) : null;
      const aDir = drawEndDir(d, from);
      const fromEp = materialize(d, from);
      let toEp: Endpoint;
      if ('kind' in to) toEp = materialize(d, to);
      else {
        const j = uid('j');
        d.junctions[j] = { id: j, x: to.x, y: to.y };
        toEp = { kind: 'junction', id: j };
      }
      const b = endpointPos(d, toEp);
      let pts = corners.map((p) => ({ ...p }));
      if (ortho) {
        if (!pts.length) {
          if ('kind' in to && to.kind === 'wirept') {
            const a = endpointPos(d, fromEp);
            const full = routeOrtho(a, aDir, b, bDir, routeContext(d, new Set(), grid));
            pts = full ? full.slice(1, -1) : orthoElbow(a, b, aDir, bDir, grid);
          } else pts = autoRoute(d, fromEp, toEp, new Set(), grid);
        } else {
          pts = [...pts, ...orthoElbow(pts[pts.length - 1], b, null, bDir, grid)];
        }
      }
      const w: Wire = { id: uid('w'), a: fromEp, b: toEp, points: pts, ortho, ...wireStyle };
      d.wires[w.id] = w;
      normalizeWire(d, w);
    });
    ia.current = { kind: 'idle' };
    setPreview(null);
    routeCache.current = null;
  };

  const updateWirePreview = (m: Vec, t: Target) => {
    const cur = ia.current;
    if (cur.kind !== 'wire') return;
    const d = S().doc;
    const start = drawEndPos(d, cur.from);
    const last = cur.points.length ? cur.points[cur.points.length - 1] : start;
    const tgt = resolveTarget(t, m, cur.from);
    if (tgt) {
      const end = drawEndPos(d, tgt);
      if (S().ortho) {
        if (!cur.points.length) {
          const key = JSON.stringify(tgt) + JSON.stringify(cur.from);
          if (routeCache.current?.key !== key) {
            const full = routeOrtho(start, drawEndDir(d, cur.from), end, drawEndDir(d, tgt), routeContext(d, new Set(), S().grid));
            routeCache.current = { key, pts: full ?? [start, ...orthoElbow(start, end, drawEndDir(d, cur.from), drawEndDir(d, tgt), S().grid), end] };
          }
          setPreview(routeCache.current.pts);
          return;
        }
        setPreview([start, ...cur.points, ...orthoElbow(last, end, null, drawEndDir(d, tgt), S().grid), end]);
        return;
      }
      setPreview([start, ...cur.points, end]);
      return;
    }
    setPreview([start, ...cur.points, constrained(m, last)]);
  };

  const startWire = (from: DrawEnd, m: Vec) => {
    ia.current = { kind: 'wire', from, points: [] };
    routeCache.current = null;
    const p = drawEndPos(S().doc, from);
    setPreview([p, snapPt(m)]);
  };

  // ------------------------------------------------------------ inline editor
  const openEditor = (worldPos: Vec, value: string, multiline: boolean, apply: (v: string) => void) => {
    const sp = toScreen(worldPos);
    setEditor({ x: sp.x, y: sp.y, value, multiline, apply });
  };

  const editObjectText = (objId: string) => {
    const o = S().doc.objects[objId];
    if (!o) return;
    const textShape = o.shapes.length === 1 && ['rect', 'ellipse', 'text'].includes(o.shapes[0].kind) ? o.shapes[0] : null;
    if (textShape) {
      openEditor(objCenter(o), textShape.text, true, (v) =>
        S().commit((d) => {
          const s = d.objects[objId]?.shapes.find((x) => x.id === textShape.id);
          if (s) s.text = v;
        }),
      );
    } else {
      const c = objCenter(o);
      openEditor(add(c, o.labelOffset), o.label, false, (v) =>
        S().commit((d) => {
          if (d.objects[objId]) {
            d.objects[objId].label = v;
            d.objects[objId].showLabel = true;
          }
        }),
      );
    }
  };

  const editLabel = (objId: string) => {
    const o = S().doc.objects[objId];
    if (!o) return;
    openEditor(add(objCenter(o), o.labelOffset), o.label, false, (v) => S().commit((d) => void (d.objects[objId] && (d.objects[objId].label = v))));
  };

  const editPort = (objId: string, portId: string) => {
    const r = findPort(S().doc, objId, portId);
    if (!r) return;
    openEditor(add(portWorld(r.o, r.p), r.p.labelOffset), r.p.name, false, (v) =>
      S().commit((d) => {
        const p = d.objects[objId]?.ports.find((x) => x.id === portId);
        if (p) {
          p.name = v;
          p.showLabel = true;
        }
      }),
    );
  };

  // ------------------------------------------------------------ pointer handlers
  const onPointerDown = (e: React.PointerEvent) => {
    if (editor) return;
    const s = S();
    const m = toWorld(e.clientX, e.clientY);
    const t = getTarget(e.target);
    const screen = { x: e.clientX, y: e.clientY };
    const capture = () => svgRef.current?.setPointerCapture(e.pointerId);

    if (e.button === 1 || (e.button === 0 && spaceDown.current)) {
      e.preventDefault();
      ia.current = { kind: 'pan', start: screen, pan0: s.pan };
      capture();
      rerender();
      return;
    }
    if (e.button !== 0) return;
    const cur = ia.current;

    // --- wire drawing in progress: clicks connect or add corners
    if (cur.kind === 'wire') {
      if (t.kind === 'port' && cur.from.kind === 'port' && t.obj === cur.from.obj && t.port === cur.from.port && !cur.points.length) {
        ia.current = { kind: 'idle' };
        setPreview(null);
        return;
      }
      const tgt = resolveTarget(t, m, cur.from);
      if (tgt) {
        finishWire(cur.from, tgt, cur.points);
        return;
      }
      const last = cur.points.length ? cur.points[cur.points.length - 1] : drawEndPos(s.doc, cur.from);
      const p = constrained(m, last);
      if (!eq(p, last)) cur.points.push(p);
      updateWirePreview(m, t);
      return;
    }
    if (cur.kind === 'line') {
      const last = cur.points[cur.points.length - 1];
      let p = snapPt(m);
      if (e.shiftKey) p = Math.abs(p.x - last.x) >= Math.abs(p.y - last.y) ? { x: p.x, y: last.y } : { x: last.x, y: p.y };
      if (!eq(p, last)) cur.points.push(p);
      cur.cur = p;
      rerender();
      return;
    }

    // --- creation tools
    if (s.tool === 'box') {
      const p = snapPt(m);
      ia.current = { kind: 'box', start: p, cur: p };
      capture();
      rerender();
      return;
    }
    if (s.tool === 'line') {
      const p = snapPt(m);
      ia.current = { kind: 'line', points: [p], cur: p };
      rerender();
      return;
    }
    if (s.tool === 'text') {
      const p = snapPt(m);
      const o = newObj({ x: p.x, y: p.y - 15, w: 120, h: 30, label: '', showLabel: false });
      o.shapes.push(newShape('text', { w: 120, h: 30, text: 'Text', stroke: 'none', fill: 'none' }));
      addObject(o);
      s.set({ tool: 'select' });
      setTimeout(() => editObjectText(o.id));
      return;
    }
    if (s.tool === 'wire') {
      const from = resolveTarget(t, m, null);
      if (from) startWire(from, m);
      return;
    }
    if (s.tool === 'node') {
      if (t.kind === 'port' && t.obj && t.port) {
        s.select([], { obj: t.obj, port: t.port });
        ia.current = { kind: 'pendingPort', obj: t.obj, port: t.port, screen, orig: s.doc, canDrag: true };
        capture();
        return;
      }
      const objId = t.kind === 'object' ? t.id : t.kind === 'olabel' ? t.id : undefined;
      if (objId && s.doc.objects[objId]) {
        const o = s.doc.objects[objId];
        const lp = portLocalAt(o, m, s.grid, s.snap);
        const p = newPort(o, lp, nextPortName(o));
        s.commit((d) => void d.objects[objId].ports.push(p));
        s.select([], { obj: objId, port: p.id });
        return;
      }
      s.select([]);
      return;
    }

    // --- select tool
    if (t.kind === 'guide' && t.handle && t.idx != null) {
      ia.current = { kind: 'guide', axis: t.handle as 'v' | 'h', idx: t.idx, orig: s.doc };
      capture();
      return;
    }
    if (t.kind === 'handle' && t.handle && s.sel.length === 1 && s.doc.objects[s.sel[0]]) {
      const o = s.doc.objects[s.sel[0]];
      const bb = objBBox(o);
      const fx = t.handle.includes('w') ? bb.x + bb.w : bb.x;
      const fy = t.handle.includes('n') ? bb.y + bb.h : bb.y;
      ia.current = { kind: 'resize', obj: o.id, fixed: { x: fx, y: fy }, bb0: bb, orig: s.doc };
      capture();
      return;
    }
    if (t.kind === 'corner' && t.id != null && t.idx != null) {
      ia.current = { kind: 'corner', wire: t.id, idx: t.idx, orig: s.doc, base: s.doc };
      capture();
      return;
    }
    if (t.kind === 'port' && t.obj && t.port) {
      if (e.altKey) {
        s.select([], { obj: t.obj, port: t.port });
        return;
      }
      ia.current = { kind: 'pendingPort', obj: t.obj, port: t.port, screen, orig: s.doc, canDrag: true };
      capture();
      return;
    }
    if (t.kind === 'junction' && t.id) {
      if (e.shiftKey) {
        s.select(s.sel.includes(t.id) ? s.sel.filter((x) => x !== t.id) : [...s.sel, t.id]);
        return;
      }
      ia.current = { kind: 'pendingJunction', id: t.id, screen, start: m, orig: s.doc };
      capture();
      return;
    }
    if ((t.kind === 'olabel' && t.id) || (t.kind === 'plabel' && t.obj && t.port)) {
      const objId = (t.kind === 'olabel' ? t.id : t.obj)!;
      const o = s.doc.objects[objId];
      if (!o) return;
      const port = t.kind === 'plabel' ? t.port! : null;
      const off0 = port ? o.ports.find((p) => p.id === port)!.labelOffset : o.labelOffset;
      ia.current = { kind: 'label', obj: objId, port, start: m, off0, orig: s.doc };
      if (!port && !s.sel.includes(objId)) s.select([objId]);
      capture();
      return;
    }
    if (t.kind === 'wire' && t.id) {
      if (e.altKey) {
        s.set({ highlight: netOfWire(s.doc, t.id) });
        return;
      }
      if (e.shiftKey) {
        s.select(s.sel.includes(t.id) ? s.sel.filter((x) => x !== t.id) : [...s.sel, t.id]);
        return;
      }
      const multi = s.sel.includes(t.id) && s.sel.some((id) => s.doc.objects[id]);
      if (multi) {
        beginMove(m, screen, t.id, false);
      } else {
        s.select([t.id]);
        ia.current = { kind: 'segment', wire: t.id, seg: t.seg ?? 0, orig: s.doc, start: m, screen, moved: false };
      }
      capture();
      return;
    }
    if (t.kind === 'object' && t.id) {
      if (e.shiftKey) {
        s.select(s.sel.includes(t.id) ? s.sel.filter((x) => x !== t.id) : [...s.sel, t.id]);
        if (!S().sel.includes(t.id)) return;
      } else if (!s.sel.includes(t.id)) s.select([t.id]);
      beginMove(m, screen, t.id, e.shiftKey);
      capture();
      return;
    }
    // empty space: rubber-band selection
    ia.current = { kind: 'marquee', start: m, cur: m, base: e.shiftKey ? s.sel : [] };
    if (!e.shiftKey) s.select([]);
    capture();
    rerender();
  };

  /** Nudge a move so the moving box's edge or center lands on a nearby guide. */
  const snapToGuides = (bb: Rect, delta: Vec): Vec => {
    const s = S();
    const g = s.doc.guides;
    if (!s.showGuides || !g) return delta;
    const tol = 8 / s.zoom;
    const best = (vals: number[], guides: number[]) => {
      let out = 0, bd = tol;
      for (const v of vals) for (const gv of guides) if (Math.abs(gv - v) < bd) {
        bd = Math.abs(gv - v);
        out = gv - v;
      }
      return out;
    };
    const x = bb.x + delta.x, y = bb.y + delta.y;
    return {
      x: delta.x + best([x, x + bb.w / 2, x + bb.w], g.v),
      y: delta.y + best([y, y + bb.h / 2, y + bb.h], g.h),
    };
  };

  const beginMove = (m: Vec, screen: Vec, clicked: string, shift: boolean) => {
    const s = S();
    const objs = new Set(s.sel.filter((id) => s.doc.objects[id]));
    const juncs = new Set(s.sel.filter((id) => s.doc.junctions[id]));
    const wires = new Set(s.sel.filter((id) => s.doc.wires[id]));
    const bb = unionRect([...objs].map((id) => objBBox(s.doc.objects[id])));
    const anchor = bb ? { x: bb.x, y: bb.y } : juncs.size ? { ...s.doc.junctions[[...juncs][0]] } : m;
    ia.current = { kind: 'move', start: m, screen, orig: s.doc, objs, juncs, wires, anchor, bb, moved: false, clicked, shift };
  };

  const moved = (screen: Vec, e: React.PointerEvent) => Math.hypot(e.clientX - screen.x, e.clientY - screen.y) > DRAG_THRESHOLD;

  const onPointerMove = (e: React.PointerEvent) => {
    const s = S();
    const m = toWorld(e.clientX, e.clientY);
    const cur = ia.current;
    const t = getTarget(e.target);
    pointer.pos = m;
    pointer.moved = true;
    const hp = t.kind === 'port' ? `${t.obj}:${t.port}` : null;
    if (hp !== hoverPort) setHoverPort(hp);

    switch (cur.kind) {
      case 'pan':
        s.set({ pan: { x: cur.pan0.x + e.clientX - cur.start.x, y: cur.pan0.y + e.clientY - cur.start.y } });
        return;
      case 'marquee':
        cur.cur = m;
        rerender();
        return;
      case 'move': {
        if (!cur.moved && !moved(cur.screen, e)) return;
        cur.moved = true;
        let delta = sub(m, cur.start);
        if (s.snap) delta = sub(snapV(add(cur.anchor, delta), s.grid), cur.anchor);
        if (cur.bb) delta = snapToGuides(cur.bb, delta);
        s.setLive(applyMove(cur.orig, cur.objs, cur.juncs, cur.wires, delta, s.grid));
        return;
      }
      case 'pendingPort':
        if (moved(cur.screen, e)) {
          ia.current = { kind: 'movePort', obj: cur.obj, port: cur.port, orig: cur.orig };
          s.select([], { obj: cur.obj, port: cur.port });
        }
        return;
      case 'pendingJunction':
        if (moved(cur.screen, e)) {
          s.select([cur.id]);
          beginMove(cur.start, cur.screen, cur.id, false);
          (ia.current as any).orig = cur.orig;
          onPointerMove(e);
        }
        return;
      case 'guide': {
        const pos = cur.axis === 'v' ? m.x : m.y;
        const v = s.snap ? snapN(pos, s.grid) : pos;
        s.setLive(produce(cur.orig, (d) => void (d.guides![cur.axis][cur.idx] = v)));
        return;
      }
      case 'movePort':
        s.setLive(movePort(cur.orig, cur.obj, cur.port, m, s.grid, s.snap));
        return;
      case 'label': {
        const off = add(cur.off0, sub(m, cur.start));
        s.setLive(
          produce(cur.orig, (d) => {
            const o = d.objects[cur.obj];
            if (cur.port) {
              const p = o.ports.find((x) => x.id === cur.port);
              if (p) p.labelOffset = off;
            } else o.labelOffset = off;
          }),
        );
        return;
      }
      case 'resize': {
        let p = snapPt(m);
        if (e.shiftKey) {
          const ratio = cur.bb0.w / Math.max(cur.bb0.h, 1);
          const w = Math.abs(p.x - cur.fixed.x), h = Math.abs(p.y - cur.fixed.y);
          const nw = Math.max(w, h * ratio);
          p = { x: cur.fixed.x + Math.sign(p.x - cur.fixed.x || 1) * nw, y: cur.fixed.y + Math.sign(p.y - cur.fixed.y || 1) * (nw / ratio) };
        }
        const r = rectFromPoints(cur.fixed, p);
        r.w = Math.max(r.w, s.grid);
        r.h = Math.max(r.h, s.grid);
        s.setLive(resizeObject(cur.orig, cur.obj, r, s.grid));
        return;
      }
      case 'corner':
        s.setLive(dragCorner(cur.orig, cur.wire, cur.idx, snapPt(m), s.grid));
        return;
      case 'segment': {
        if (!cur.moved && !moved(cur.screen, e)) return;
        const w = cur.orig.wires[cur.wire];
        if (!w) return;
        if (w.ortho) {
          cur.moved = true;
          s.setLive(dragSegment(cur.orig, cur.wire, cur.seg, snapPt(m)));
        } else {
          // free-angle wire: grabbing a segment bends it at that point
          const orig2 = produce(cur.orig, (d) => void d.wires[cur.wire].points.splice(cur.seg, 0, snapPt(cur.start)));
          ia.current = { kind: 'corner', wire: cur.wire, idx: cur.seg, orig: orig2, base: cur.orig };
          s.setLive(dragCorner(orig2, cur.wire, cur.seg, snapPt(m), s.grid));
        }
        return;
      }
      case 'wire':
        updateWirePreview(m, t);
        return;
      case 'box':
        cur.cur = snapPt(m);
        rerender();
        return;
      case 'line': {
        const last = cur.points[cur.points.length - 1];
        let p = snapPt(m);
        if (e.shiftKey) p = Math.abs(p.x - last.x) >= Math.abs(p.y - last.y) ? { x: p.x, y: last.y } : { x: last.x, y: p.y };
        cur.cur = p;
        rerender();
        return;
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const s = S();
    const cur = ia.current;
    try {
      svgRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    switch (cur.kind) {
      case 'pan':
        break;
      case 'marquee': {
        const r = rectFromPoints(cur.start, cur.cur);
        if (r.w > 2 || r.h > 2) {
          const ids = new Set(cur.base);
          for (const o of Object.values(s.doc.objects)) if (rectInside(objBBox(o), r)) ids.add(o.id);
          for (const w of Object.values(s.doc.wires)) if (rectInside(pointsBBox(wireFull(s.doc, w)), r)) ids.add(w.id);
          for (const j of Object.values(s.doc.junctions)) if (rectInside({ x: j.x, y: j.y, w: 0, h: 0 }, r)) ids.add(j.id);
          s.select([...ids]);
        }
        break;
      }
      case 'move':
        if (cur.moved) s.pushHistory(cur.orig);
        else if (!cur.shift && s.sel.length > 1 && s.doc.objects[cur.clicked]) s.select([cur.clicked]);
        break;
      case 'pendingPort':
        if (s.tool === 'select') startWire({ kind: 'port', obj: cur.obj, port: cur.port }, toWorld(e.clientX, e.clientY));
        ia.current.kind === 'wire' || (ia.current = { kind: 'idle' });
        rerender();
        return;
      case 'pendingJunction':
        startWire({ kind: 'junction', id: cur.id }, toWorld(e.clientX, e.clientY));
        rerender();
        return;
      case 'guide': {
        // dropping a guide back onto its ruler deletes it
        const r = svgRef.current!.getBoundingClientRect();
        const local = cur.axis === 'v' ? e.clientX - r.left : e.clientY - r.top;
        if (s.showRulers && local <= RULER) s.setLive(produce(cur.orig, (d) => void d.guides![cur.axis].splice(cur.idx, 1)));
        s.pushHistory(cur.orig);
        break;
      }
      case 'movePort':
      case 'label':
      case 'resize':
        s.pushHistory(cur.orig);
        break;
      case 'corner':
      case 'segment': {
        if (cur.kind === 'segment' && !cur.moved) break;
        const base = cur.kind === 'corner' ? cur.base : cur.orig;
        s.setLive(produce(s.doc, (d) => void (d.wires[cur.wire] && normalizeWire(d, d.wires[cur.wire]))));
        s.pushHistory(base);
        break;
      }
      case 'box': {
        let r = rectFromPoints(cur.start, cur.cur);
        if (r.w < 5 || r.h < 5) r = { x: cur.start.x, y: cur.start.y, w: 120, h: 60 };
        const o = newObj({ x: r.x, y: r.y, w: r.w, h: r.h, label: '', showLabel: false });
        o.shapes.push(newShape('rect', { w: r.w, h: r.h }));
        addObject(o);
        s.set({ tool: 'select' });
        break;
      }
      case 'wire':
      case 'line':
        return; // multi-click interactions continue
    }
    ia.current = { kind: 'idle' };
    rerender();
  };

  const finishLine = () => {
    const cur = ia.current;
    if (cur.kind !== 'line') return;
    const pts = cur.points.filter((p, i) => i === 0 || !eq(p, cur.points[i - 1]));
    ia.current = { kind: 'idle' };
    rerender();
    if (pts.length < 2) return;
    const bb = pointsBBox(pts);
    const w = Math.max(bb.w, 1), h = Math.max(bb.h, 1);
    const o = newObj({ x: bb.x, y: bb.y, w, h, label: '', showLabel: false });
    o.shapes.push(newShape('poly', { points: pts.map((p) => sub(p, bb)), fill: 'none' }));
    addObject(o);
    S().set({ tool: 'select' });
  };

  const cancel = () => {
    const cur = ia.current;
    if (cur.kind === 'line') {
      finishLine();
      return;
    }
    if (cur.kind === 'move' || cur.kind === 'movePort' || cur.kind === 'label' || cur.kind === 'resize' || cur.kind === 'segment') S().setLive(cur.orig);
    if (cur.kind === 'corner') S().setLive(cur.base);
    ia.current = { kind: 'idle' };
    setPreview(null);
    rerender();
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const s = S();
    const m = toWorld(e.clientX, e.clientY);
    const cur = ia.current;
    const t = getTarget(e.target);
    if (cur.kind === 'wire') {
      // finish on empty canvas: the wire gets a free end
      const pts = cur.points.slice();
      const end = pts.pop();
      if (!end) {
        ia.current = { kind: 'idle' };
        setPreview(null);
        return;
      }
      finishWire(cur.from, end, pts);
      return;
    }
    if (cur.kind === 'line') {
      finishLine();
      return;
    }
    if (s.tool !== 'select') return;
    if (t.kind === 'wire' && t.id && t.seg != null) {
      const id = t.id, seg = t.seg;
      s.commit((d) => insertCorner(d, id, seg, m, s.grid));
      s.select([id]);
      return;
    }
    if ((t.kind === 'port' || t.kind === 'plabel') && t.obj && t.port) {
      editPort(t.obj, t.port);
      return;
    }
    if (t.kind === 'olabel' && t.id) {
      editLabel(t.id);
      return;
    }
    if (t.kind === 'object' && t.id) editObjectText(t.id);
  };

  // ------------------------------------------------------------ context menu
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const cur = ia.current;
    if (cur.kind === 'wire' || cur.kind === 'line') {
      cancel();
      return;
    }
    const s = S();
    const t = getTarget(e.target);
    const items: MenuItem[] = [];
    if (t.kind === 'corner' && t.id != null && t.idx != null) {
      const id = t.id, idx = t.idx;
      const w = s.doc.wires[id];
      if (w && !w.ortho) items.push({ label: 'Remove corner', action: () => s.commit((d) => void d.wires[id].points.splice(idx, 1)) });
      items.push({ label: 'Re-route wire', action: () => rerouteWire(id) });
    } else if (t.kind === 'wire' && t.id) {
      const id = t.id;
      if (!s.sel.includes(id)) s.select([id]);
      items.push(
        { label: 'Re-route wire', action: () => rerouteWire(id) },
        { label: 'Organize selected wires', action: organize },
        { label: 'Highlight net', shortcut: 'Alt+Click', action: () => s.set({ highlight: netOfWire(S().doc, id) }) },
        { sep: true },
        { label: 'Delete', shortcut: 'Del', action: deleteSelection },
      );
    } else if ((t.kind === 'port' || t.kind === 'plabel') && t.obj && t.port) {
      const obj = t.obj, port = t.port;
      s.select([], { obj, port });
      items.push({ label: 'Rename node', action: () => editPort(obj, port) }, { label: 'Delete node', shortcut: 'Del', action: deleteSelection });
    } else if ((t.kind === 'object' || t.kind === 'olabel') && t.id) {
      const id = t.id;
      if (!s.sel.includes(id)) s.select([id]);
      const objCount = S().sel.filter((x) => s.doc.objects[x]).length;
      items.push(
        { label: 'Edit label / text', action: () => editObjectText(id) },
        { sep: true },
        { label: 'Copy', shortcut: 'Ctrl+C', action: () => copyToClip() },
        { label: 'Duplicate', shortcut: 'Ctrl+D', action: duplicate },
        { label: 'Rotate 90°', shortcut: 'R', action: () => rotateOrFlip('rotate') },
        { label: 'Flip horizontal', shortcut: 'F', action: () => rotateOrFlip('flipX') },
        { label: 'Flip vertical', shortcut: 'Shift+F', action: () => rotateOrFlip('flipY') },
        { sep: true },
        { label: 'Bring to front', shortcut: 'Ctrl+]', action: () => zOrder('front') },
        { label: 'Send to back', shortcut: 'Ctrl+[', action: () => zOrder('back') },
        ...(objCount > 1 ? [{ label: 'Group', shortcut: 'Ctrl+G', action: group }] : []),
        ...(s.doc.objects[id].shapes.length > 1 ? [{ label: 'Ungroup', shortcut: 'Ctrl+Shift+G', action: ungroup }] : []),
        { label: 'Organize its wires', action: organize },
        { label: 'Add to library', action: () => onAddToLibrary(id) },
        { sep: true },
        { label: 'Delete', shortcut: 'Del', action: deleteSelection },
      );
    } else if (t.kind === 'junction' && t.id) {
      const id = t.id;
      s.select([id]);
      items.push({ label: 'Delete junction and its wires', action: deleteSelection });
    } else {
      items.push(
        { label: 'Paste', shortcut: 'Ctrl+V', action: () => pasteFromText(null) },
        { label: 'Select all', shortcut: 'Ctrl+A', action: selectAll },
        { label: 'Zoom to fit', shortcut: 'Shift+1', action: zoomToFit },
        { label: 'Organize all wires', action: () => { s.select([]); organize(); } },
        { sep: true },
        { label: s.showRulers ? 'Hide rulers' : 'Show rulers', shortcut: 'Ctrl+R', action: () => s.set({ showRulers: !s.showRulers }) },
        { label: s.showGuides ? 'Hide guides' : 'Show guides', shortcut: 'Ctrl+;', action: () => s.set({ showGuides: !s.showGuides }) },
        ...(s.doc.guides && (s.doc.guides.v.length || s.doc.guides.h.length)
          ? [{ label: 'Clear guides', action: () => s.commit((d) => void (d.guides = { v: [], h: [] })) }]
          : []),
      );
    }
    openMenu(e.clientX, e.clientY, items);
  };

  // ------------------------------------------------------------ wheel, keys, drop
  useEffect(() => {
    const el = svgRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { zoom, pan } = S();
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      if (e.ctrlKey || !e.shiftKey) {
        const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
        const nz = Math.min(5, Math.max(0.1, zoom * f));
        S().set({ zoom: nz, pan: { x: mx - ((mx - pan.x) * nz) / zoom, y: my - ((my - pan.y) * nz) / zoom } });
      } else {
        S().set({ pan: { x: pan.x - e.deltaY, y: pan.y - e.deltaX } });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const isInput = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    const down = (e: KeyboardEvent) => {
      if (isInput(e.target)) return;
      if (e.code === 'Space') {
        spaceDown.current = true;
        e.preventDefault();
        return;
      }
      const cur = ia.current;
      if (cur.kind === 'wire') {
        if (e.key === 'Escape') {
          cancel();
          e.stopImmediatePropagation();
        } else if (e.key === 'Backspace' || e.key === 'Delete') {
          cur.points.pop();
          setPreview((p) => (p ? [...p] : p));
          routeCache.current = null;
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      } else if (cur.kind === 'line') {
        if (e.key === 'Escape' || e.key === 'Enter') {
          finishLine();
          e.stopImmediatePropagation();
        } else if (e.key === 'Backspace') {
          if (cur.points.length > 1) cur.points.pop();
          rerender();
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      } else if (cur.kind !== 'idle' && e.key === 'Escape') {
        cancel();
        e.stopImmediatePropagation();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDown.current = false;
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
    };
  }, []);

  // switching tools cancels in-progress drawing
  useEffect(() => {
    if (ia.current.kind === 'wire') cancel();
    if (ia.current.kind === 'line') finishLine();
  }, [tool]);

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const m = toWorld(e.clientX, e.clientY);
    const symJson = e.dataTransfer.getData('application/x-schematizer-symbol');
    if (symJson) {
      const sym: LibSymbol = JSON.parse(symJson);
      const at = snapPt({ x: m.x - sym.obj.w / 2, y: m.y - sym.obj.h / 2 });
      addObject(instantiate(sym, at));
      return;
    }
    for (const f of Array.from(e.dataTransfer.files)) {
      if (f.type.startsWith('image/')) await addImageFile(f, m);
    }
  };

  // ------------------------------------------------------------ render
  const selSet = new Set(sel);
  const cur = ia.current;
  const hz = 1 / zoom;
  const overlays: React.ReactNode[] = [];

  // ruler guides
  if (st.showGuides && doc.guides) {
    const big = 1e6;
    (['v', 'h'] as const).forEach((axis) =>
      doc.guides![axis].forEach((v, i) => {
        const line = axis === 'v' ? { x1: v, x2: v, y1: -big, y2: big } : { x1: -big, x2: big, y1: v, y2: v };
        overlays.unshift(
          <g key={`g-${axis}-${i}`} data-kind="guide" data-handle={axis} data-idx={i} style={{ cursor: axis === 'v' ? 'ew-resize' : 'ns-resize' }}>
            <line {...line} stroke="transparent" strokeWidth={7 * hz} />
            <line {...line} stroke="#06b6d4" strokeWidth={hz} pointerEvents="none" />
          </g>,
        );
      }),
    );
  }

  // selection boxes + resize handles
  for (const id of sel) {
    const o = doc.objects[id];
    if (!o) continue;
    const b = objBBox(o);
    overlays.push(<rect key={`sb-${id}`} x={b.x - 3 * hz} y={b.y - 3 * hz} width={b.w + 6 * hz} height={b.h + 6 * hz} fill="none" stroke="#3b82f6" strokeWidth={hz} strokeDasharray={`${4 * hz} ${3 * hz}`} pointerEvents="none" />);
  }
  if (sel.length === 1 && doc.objects[sel[0]] && tool === 'select') {
    const b = objBBox(doc.objects[sel[0]]);
    const hs = 8 * hz;
    const hpos: [string, number, number][] = [['nw', b.x, b.y], ['ne', b.x + b.w, b.y], ['sw', b.x, b.y + b.h], ['se', b.x + b.w, b.y + b.h]];
    for (const [h, x, y] of hpos) {
      overlays.push(
        <rect key={`h-${h}`} data-kind="handle" data-handle={h} x={x - hs / 2} y={y - hs / 2} width={hs} height={hs} fill="#fff" stroke="#3b82f6" strokeWidth={1.5 * hz} style={{ cursor: h === 'nw' || h === 'se' ? 'nwse-resize' : 'nesw-resize' }} />,
      );
    }
  }
  // corner handles of selected wires
  for (const id of sel) {
    const w = doc.wires[id];
    if (!w) continue;
    w.points.forEach((p, i) => {
      const hs = 7 * hz;
      overlays.push(<rect key={`c-${id}-${i}`} data-kind="corner" data-id={id} data-idx={i} x={p.x - hs / 2} y={p.y - hs / 2} width={hs} height={hs} fill="#fff" stroke="#3b82f6" strokeWidth={1.5 * hz} style={{ cursor: 'move' }} />);
    });
  }
  // selected node
  if (selPort) {
    const r = findPort(doc, selPort.obj, selPort.port);
    if (r) {
      const p = portWorld(r.o, r.p);
      overlays.push(<circle key="selport" cx={p.x} cy={p.y} r={7 * hz} fill="none" stroke="#f97316" strokeWidth={2 * hz} pointerEvents="none" />);
    }
  }
  if (cur.kind === 'marquee') {
    const r = rectFromPoints(cur.start, cur.cur);
    overlays.push(<rect key="mq" x={r.x} y={r.y} width={r.w} height={r.h} fill="rgba(59,130,246,0.08)" stroke="#3b82f6" strokeWidth={hz} strokeDasharray={`${4 * hz} ${3 * hz}`} pointerEvents="none" />);
  }
  if (cur.kind === 'box') {
    const r = rectFromPoints(cur.start, cur.cur);
    overlays.push(<rect key="bx" x={r.x} y={r.y} width={r.w} height={r.h} rx={4} fill="rgba(255,255,255,0.6)" stroke="#1f2937" strokeWidth={2} strokeDasharray="6 4" pointerEvents="none" />);
  }
  if (cur.kind === 'line') {
    const pts = [...cur.points, cur.cur];
    overlays.push(<polyline key="ln" points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#1f2937" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />);
  }
  if (cur.kind === 'wire' && preview) {
    const ws = st.wireStyle;
    overlays.push(
      <path key="wp" d={roundedPath(preview, ws.radius)} fill="none" stroke={ws.color} strokeOpacity={0.75} strokeWidth={ws.width} strokeDasharray={`${6} ${4}`} strokeLinecap="round" pointerEvents="none" />,
    );
    for (const p of cur.points) overlays.push(<circle key={`wpc-${p.x}-${p.y}`} cx={p.x} cy={p.y} r={3 * hz} fill="#3b82f6" pointerEvents="none" />);
  }

  const gs = grid * zoom;
  const cursor =
    cur.kind === 'pan' || spaceDown.current ? 'grabbing' : tool === 'box' || tool === 'line' || tool === 'wire' ? 'crosshair' : tool === 'text' ? 'text' : tool === 'node' ? 'copy' : 'default';

  return (
    <div id="canvas-wrap" className={`canvas-wrap${st.showRulers ? ' with-rulers' : ''}`} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <svg
        ref={svgRef}
        className={`canvas tool-${tool}`}
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
      >
        <defs>
          <pattern id="grid-minor" width={gs} height={gs} patternUnits="userSpaceOnUse" patternTransform={`translate(${pan.x} ${pan.y})`}>
            <path d={`M ${gs} 0 L 0 0 0 ${gs}`} fill="none" stroke="var(--grid-minor)" strokeWidth={1} />
          </pattern>
          <pattern id="grid-major" width={gs * 5} height={gs * 5} patternUnits="userSpaceOnUse" patternTransform={`translate(${pan.x} ${pan.y})`}>
            <path d={`M ${gs * 5} 0 L 0 0 0 ${gs * 5}`} fill="none" stroke="var(--grid-major)" strokeWidth={1} />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="var(--canvas-bg)" />
        {showGrid && gs >= 5 && <rect width="100%" height="100%" fill="url(#grid-minor)" pointerEvents="none" />}
        {showGrid && <rect width="100%" height="100%" fill="url(#grid-major)" pointerEvents="none" />}
        <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
          <Scene doc={doc} interactive sel={selSet} highlight={highlight} hoverPort={hoverPort} />
          {overlays}
        </g>
      </svg>
      {editor && (
        <InlineEditor
          editor={editor}
          onDone={(v) => {
            if (v !== null) editor.apply(v);
            setEditor(null);
          }}
        />
      )}
      <Rulers />
      <div className="hint">{hintFor(tool, cur.kind, ortho, snap)}</div>
    </div>
  );
}

function hintFor(tool: string, ia: string, ortho: boolean, snap: boolean) {
  if (ia === 'wire') return 'Click a node, junction or wire to connect · click empty space to add a corner · double-click to end freely · Backspace removes last corner · Esc cancels';
  if (ia === 'line') return 'Click to add points · Shift = horizontal/vertical · double-click or Enter to finish';
  switch (tool) {
    case 'node':
      return 'Click on an object to add a node (snaps to edges) · drag nodes to move them';
    case 'wire':
      return 'Click a node, junction or wire to start a connection';
    case 'box':
      return 'Drag to draw a box (or click for a default size)';
    case 'line':
      return 'Click to start a line shape';
    case 'text':
      return 'Click to place text';
    default:
      return `Click a node to start a wire · drag wires to move segments · double-click a wire to add a corner · Alt+click a wire to highlight its net · ${ortho ? 'Orthogonal' : 'Free-angle'} wires · Snap ${snap ? 'on' : 'off'}`;
  }
}

function InlineEditor({ editor, onDone }: { editor: Editor; onDone: (v: string | null) => void }) {
  const [val, setVal] = useState(editor.value);
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(v);
  };
  const lines = Math.max(1, val.split('\n').length);
  return (
    <textarea
      ref={ref}
      className="inline-editor"
      style={{ left: editor.x, top: editor.y, height: lines * 20 + 10 }}
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => finish(val)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') finish(null);
        else if (e.key === 'Enter' && (!editor.multiline || !e.shiftKey)) {
          e.preventDefault();
          finish(val);
        }
      }}
    />
  );
}

