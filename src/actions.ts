import type { Clip } from './model';
import { autoRoute, copySelection, deleteItems, groupObjects, newObj, newShape, normalizeWire, organizeWires, pasteClip, ungroupObject } from './model';
import { applyMove, transformObjects } from './edit';
import { useStore } from './store';
import type { Doc, Obj, Shape, ShapeStyle, StyleClip, Vec, WireStyle } from './types';
import { DEFAULT_NODE_STYLE } from './types';
import { docBounds, imageSize, readFileAsDataURL } from './io';
import { objBBox, snapN, unionRect } from './geometry';

const S = () => useStore.getState();

export function viewportCenter(): Vec {
  const el = document.getElementById('canvas-wrap');
  const { pan, zoom } = S();
  const w = el?.clientWidth ?? 800, h = el?.clientHeight ?? 600;
  return { x: (w / 2 - pan.x) / zoom, y: (h / 2 - pan.y) / zoom };
}

// ---------------------------------------------------------------- copy / paste style

const wireStyleOf = (w: WireStyle): WireStyle => ({ color: w.color, width: w.width, dash: w.dash, radius: w.radius, arrowA: w.arrowA, arrowB: w.arrowB });
const shapeStyleOf = (s: Shape): ShapeStyle => ({
  stroke: s.stroke, fill: s.fill, strokeWidth: s.strokeWidth, dash: s.dash, radius: s.radius, fontSize: s.fontSize, textColor: s.textColor,
});

/** The style "Copy style" would take from the current selection. */
export function styleOfSelection(): StyleClip | null {
  const { doc, sel, selPort } = S();
  if (selPort) {
    const p = doc.objects[selPort.obj]?.ports.find((x) => x.id === selPort.port);
    return p ? { kind: 'node', style: { ...(p.style ?? DEFAULT_NODE_STYLE) } } : null;
  }
  const w = sel.map((id) => doc.wires[id]).find(Boolean);
  if (w) return { kind: 'wire', style: wireStyleOf(w) };
  for (const id of sel) {
    const sh = doc.objects[id]?.shapes.find((x) => x.kind !== 'image');
    if (sh) return { kind: 'shape', style: shapeStyleOf(sh) };
  }
  return null;
}

export function copyStyle(): boolean {
  const clip = styleOfSelection();
  if (clip) S().set({ styleClip: clip });
  return !!clip;
}

/** Whether the copied style has something in the selection to apply to. */
export function canPasteStyle(): boolean {
  const { styleClip: c, doc, sel, selPort } = S();
  if (!c) return false;
  if (c.kind === 'wire') return sel.some((id) => doc.wires[id]);
  if (c.kind === 'node') return !!selPort || sel.some((id) => doc.objects[id]?.ports.length);
  return sel.some((id) => doc.objects[id]?.shapes.some((x) => x.kind !== 'image'));
}

export function pasteStyle(): boolean {
  const { styleClip: c, sel, selPort } = S();
  if (!c || !canPasteStyle()) return false;
  S().commit((d) => {
    if (c.kind === 'wire') {
      for (const id of sel) if (d.wires[id]) Object.assign(d.wires[id], c.style);
    } else if (c.kind === 'node') {
      if (selPort) {
        const p = d.objects[selPort.obj]?.ports.find((x) => x.id === selPort.port);
        if (p) p.style = { ...c.style };
      } else for (const id of sel) for (const p of d.objects[id]?.ports ?? []) p.style = { ...c.style };
    } else {
      for (const id of sel)
        for (const sh of d.objects[id]?.shapes ?? []) {
          if (sh.kind === 'image') continue;
          sh.fontSize = c.style.fontSize;
          sh.textColor = c.style.textColor;
          if (sh.kind === 'text') continue;
          Object.assign(sh, { stroke: c.style.stroke, strokeWidth: c.style.strokeWidth, dash: c.style.dash, radius: c.style.radius });
          if (!(sh.kind === 'poly' && !sh.closed)) sh.fill = c.style.fill;
        }
    }
  });
  return true;
}

export function deleteSelection() {
  const { sel, selPort, commit } = S();
  if (!sel.length && !selPort) return;
  commit((d) => deleteItems(d, new Set(sel), selPort));
  S().select([]);
}

let lastClip: Clip | null = null;
let lastClipTextValue = '';
let pasteCount = 0;

export const lastClipText = () => (lastClip ? lastClipTextValue : '');

export function copyToClip(): string | null {
  const { doc, sel } = S();
  const clip = copySelection(doc, new Set(sel));
  if (!clip) return null;
  lastClip = clip;
  lastClipTextValue = JSON.stringify(clip);
  pasteCount = 0;
  pasteBase = { x: 0, y: 0 };
  return lastClipTextValue;
}

export function pasteFromText(text: string | null): boolean {
  let clip: Clip | null = null;
  if (text && text === lastClipTextValue) clip = lastClip;
  else if (text) {
    try {
      const j = JSON.parse(text);
      if (j?.kind === 'schematizer-clip') {
        clip = j;
        lastClip = j;
        lastClipTextValue = text;
        pasteCount = 0;
      }
    } catch {
      /* not ours */
    }
  }
  if (!text && lastClip) clip = lastClip;
  if (!clip) return false;
  const { grid } = S();
  let delta: Vec;
  const m = pointer.pos;
  const bb = clipBBox(clip);
  if (m && pointer.moved && bb) {
    // paste at the mouse position
    delta = { x: snapN(m.x - bb.x, grid), y: snapN(m.y - bb.y, grid) };
    pointer.moved = false;
    pasteBase = delta;
    pasteCount = 0;
  } else {
    pasteCount++;
    const g = grid * 2 * pasteCount;
    delta = { x: pasteBase.x + g, y: pasteBase.y + g };
  }
  let ids: string[] = [];
  const c = clip;
  S().commit((d) => {
    ids = pasteClip(d, c, delta);
    for (const id of ids) if (d.objects[id]) d.objects[id].label = nextLabel(d, d.objects[id].label, id);
  });
  S().select(ids);
  return true;
}

/** Mouse position on the canvas, kept up to date by the canvas. */
export const pointer: { pos: Vec | null; moved: boolean } = { pos: null, moved: false };
let pasteBase: Vec = { x: 0, y: 0 };

function clipBBox(clip: Clip) {
  const rs = clip.objects.map(objBBox);
  for (const j of clip.junctions) rs.push({ x: j.x, y: j.y, w: 0, h: 0 });
  return unionRect(rs);
}

/** "R1" -> next free "R<n>" if the label is already used by another object. */
export function nextLabel(d: Doc, label: string, selfId: string): string {
  const m = /^(.*?)(\d+)$/.exec(label);
  if (!m) return label;
  const used = new Set(Object.values(d.objects).filter((o) => o.id !== selfId).map((o) => o.label));
  if (!used.has(label)) return label;
  let n = 1;
  while (used.has(`${m[1]}${n}`)) n++;
  return `${m[1]}${n}`;
}

export function duplicate() {
  if (!copyToClip()) return;
  pointer.moved = false;
  pasteBase = { x: 0, y: 0 };
  pasteFromText(lastClipTextValue);
}

export function selectAll() {
  const { doc } = S();
  S().select([...doc.order, ...Object.keys(doc.wires), ...Object.keys(doc.junctions)]);
}

export function rotateOrFlip(op: 'rotate' | 'flipX' | 'flipY') {
  const { doc, sel, grid, setLive, pushHistory } = S();
  const ids = sel.filter((id) => doc.objects[id]);
  if (!ids.length) return;
  const next = transformObjects(doc, ids, op, grid);
  setLive(next);
  pushHistory(doc);
}

export function group() {
  const { sel, doc } = S();
  const ids = sel.filter((id) => doc.objects[id]);
  if (ids.length < 2) return;
  let gid: string | null = null;
  S().commit((d) => {
    gid = groupObjects(d, ids);
  });
  if (gid) S().select([gid]);
}

export function ungroup() {
  const { sel, doc } = S();
  const ids = sel.filter((id) => doc.objects[id] && doc.objects[id].shapes.length > 1);
  if (!ids.length) return;
  const out: string[] = [];
  S().commit((d) => {
    for (const id of ids) out.push(...ungroupObject(d, id));
  });
  S().select(out);
}

function organizeIds(ids: string[]) {
  if (ids.length) S().commit((d) => organizeWires(d, ids, S().grid));
}

/** Organize only the selected connections. */
export function organize() {
  const { sel, doc } = S();
  organizeIds(sel.filter((id) => doc.wires[id]));
}

export const hasSelectedWires = () => S().sel.some((id) => S().doc.wires[id]);

/** Organize every connection attached to the selected objects. */
export function organizeAttached() {
  const { sel, doc } = S();
  const objs = new Set(sel.filter((id) => doc.objects[id]));
  organizeIds(
    Object.values(doc.wires)
      .filter((w) => (w.a.kind === 'port' && objs.has(w.a.obj)) || (w.b.kind === 'port' && objs.has(w.b.obj)))
      .map((w) => w.id),
  );
}

/** Organize every connection in the drawing. */
export function organizeAll() {
  organizeIds(Object.keys(S().doc.wires));
}

export function rerouteWire(id: string) {
  const { grid } = S();
  S().commit((d) => {
    const w = d.wires[id];
    if (!w) return;
    w.ortho = true;
    w.points = autoRoute(d, w.a, w.b, new Set([id]), grid);
    normalizeWire(d, w);
  });
}

export function zOrder(where: 'front' | 'back') {
  const { sel, doc } = S();
  const ids = new Set(sel.filter((id) => doc.objects[id]));
  if (!ids.size) return;
  S().commit((d) => {
    const rest = d.order.filter((id) => !ids.has(id));
    const moved = d.order.filter((id) => ids.has(id));
    d.order = where === 'front' ? [...rest, ...moved] : [...moved, ...rest];
  });
}

export function zoomToFit() {
  const { doc } = S();
  const el = document.getElementById('canvas-wrap');
  if (!el) return;
  if (!doc.order.length && !Object.keys(doc.wires).length) {
    S().set({ zoom: 1, pan: { x: el.clientWidth / 2, y: el.clientHeight / 2 } });
    return;
  }
  const b = docBounds(doc);
  const pad = 60;
  const zoom = Math.min(2, Math.max(0.1, Math.min((el.clientWidth - pad * 2) / Math.max(b.w, 1), (el.clientHeight - pad * 2) / Math.max(b.h, 1))));
  S().set({ zoom, pan: { x: el.clientWidth / 2 - (b.x + b.w / 2) * zoom, y: el.clientHeight / 2 - (b.y + b.h / 2) * zoom } });
}

export function zoomBy(f: number) {
  const el = document.getElementById('canvas-wrap');
  const { zoom, pan } = S();
  const nz = Math.min(5, Math.max(0.1, zoom * f));
  const cx = (el?.clientWidth ?? 800) / 2, cy = (el?.clientHeight ?? 600) / 2;
  S().set({ zoom: nz, pan: { x: cx - ((cx - pan.x) * nz) / zoom, y: cy - ((cy - pan.y) * nz) / zoom } });
}

/** Add an object to the doc and select it. */
export function addObject(o: Obj) {
  S().commit((d) => {
    o.label = nextLabel(d, o.label, o.id);
    for (const p of o.ports) p.style ??= { ...S().nodeStyle };
    d.objects[o.id] = o;
    d.order.push(o.id);
  });
  S().select([o.id]);
}

export async function addImageFile(file: File, at?: Vec) {
  const src = await readFileAsDataURL(file);
  const { w: nw, h: nh } = await imageSize(src);
  const { grid } = S();
  const max = 200;
  const k = Math.min(1, max / Math.max(nw, nh));
  const w = Math.max(grid * 2, snapN(nw * k, grid)), h = Math.max(grid * 2, snapN(nh * k, grid));
  const c = at ?? viewportCenter();
  const o = newObj({ x: snapN(c.x - w / 2, grid), y: snapN(c.y - h / 2, grid), w, h, label: file.name.replace(/\.[^.]+$/, '') });
  o.shapes.push(newShape('image', { x: 0, y: 0, w, h, src, stroke: 'none', fill: 'none' }));
  addObject(o);
}

export function selectionBBox() {
  const { doc, sel } = S();
  return unionRect(sel.filter((id) => doc.objects[id]).map((id) => objBBox(doc.objects[id])));
}

/** Align selected objects. */
export function align(mode: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom') {
  const { doc, sel, grid, setLive, pushHistory } = S();
  const ids = sel.filter((id) => doc.objects[id]);
  if (ids.length < 2) return;
  const bb = unionRect(ids.map((id) => objBBox(doc.objects[id])))!;
  {
    let next = doc;
    for (const id of ids) {
      const b = objBBox(next.objects[id]);
      const dx =
        mode === 'left' ? bb.x - b.x : mode === 'right' ? bb.x + bb.w - (b.x + b.w) : mode === 'hcenter' ? bb.x + bb.w / 2 - (b.x + b.w / 2) : 0;
      const dy =
        mode === 'top' ? bb.y - b.y : mode === 'bottom' ? bb.y + bb.h - (b.y + b.h) : mode === 'vcenter' ? bb.y + bb.h / 2 - (b.y + b.h / 2) : 0;
      if (dx || dy) next = applyMove(next, new Set([id]), new Set(), new Set(), { x: dx, y: dy }, grid);
    }
    setLive(next);
    pushHistory(doc);
  }
}
