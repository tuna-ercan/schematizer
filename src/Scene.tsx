import React from 'react';
import type { Dash, Doc, Endpoint, NodeStyle, Obj, Port, Shape, Vec, Wire } from './types';
import { DEFAULT_NODE_STYLE } from './types';
import { add, dist, mul, norm, objCenter, portWorld, roundedPath, sub } from './geometry';
import { findPort, junctionDegree, wireFull } from './model';

/**
 * A node: the outer color is a ring around the inner disc (a full disc when the inner
 * radius is 0), so a see-through inner color shows what is behind the node.
 */
export function NodeDot({ x, y, s, k = 1 }: { x: number; y: number; s: NodeStyle; k?: number }) {
  const R = s.outerRadius * k;
  const r = Math.min(s.innerRadius, s.outerRadius || s.innerRadius) * k;
  const alpha = s.innerAlpha ?? 1;
  return (
    <>
      {R > 0 && r <= 0 && <circle cx={x} cy={y} r={R} fill={s.outerColor} />}
      {R > 0 && r > 0 && r < R && <circle cx={x} cy={y} r={(R + r) / 2} fill="none" stroke={s.outerColor} strokeWidth={R - r} />}
      {r > 0 && alpha > 0 && <circle cx={x} cy={y} r={r} fill={s.innerColor} fillOpacity={alpha} />}
    </>
  );
}

export function dashArray(dash: Dash, width: number): string | undefined {
  const w = Math.max(width, 1);
  switch (dash) {
    case 'dashed':
      return `${w * 4} ${w * 3}`;
    case 'dotted':
      return `0.01 ${w * 2.5}`;
    case 'dashdot':
      return `${w * 5} ${w * 2.5} 0.01 ${w * 2.5}`;
    default:
      return undefined;
  }
}

function TextLines({ text, x, y, fontSize, color, anchor = 'middle' }: { text: string; x: number; y: number; fontSize: number; color: string; anchor?: string }) {
  const lines = text.split('\n');
  const lh = fontSize * 1.2;
  const y0 = y - ((lines.length - 1) * lh) / 2;
  return (
    <text x={x} y={y0} fontSize={fontSize} fill={color} textAnchor={anchor} dominantBaseline="central" fontFamily="Inter, system-ui, sans-serif" style={{ userSelect: 'none' }}>
      {lines.map((l, i) => (
        <tspan key={i} x={x} dy={i === 0 ? 0 : lh}>
          {l || ' '}
        </tspan>
      ))}
    </text>
  );
}

/** A node position (object-local) and the radius that lines ending there should stop at. */
type Stop = { x: number; y: number; r: number };

/** Shorten an open polyline whose end sits on a node, so it stops at the node's outer ring. */
function trimToStops(pts: Vec[], stops: Stop[]): Vec[] {
  if (pts.length < 2 || !stops.length) return pts;
  const at = (p: Vec) => stops.find((q) => Math.abs(q.x - p.x) < 0.5 && Math.abs(q.y - p.y) < 0.5)?.r ?? 0;
  return cutEnds(pts, at(pts[0]), at(pts[pts.length - 1]));
}

/**
 * Start a polyline where it leaves a circle of radius r around its first point
 * (skipping any tiny pieces inside the circle).
 */
function cutStart(pts: Vec[], r: number): Vec[] {
  if (r <= 0 || pts.length < 2) return pts;
  const c = pts[0];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (dist(b, c) <= r) continue;
    // a is inside the circle, b outside: solve |a + t(b - a) - c| = r for t in [0, 1]
    const d = sub(b, a), f = sub(a, c);
    const A = d.x * d.x + d.y * d.y, B = 2 * (f.x * d.x + f.y * d.y), C = f.x * f.x + f.y * f.y - r * r;
    const t = (-B + Math.sqrt(Math.max(0, B * B - 4 * A * C))) / (2 * A);
    return [add(a, mul(d, t)), ...pts.slice(i + 1)];
  }
  return pts; // the whole line is inside the ring
}

/** Stop a polyline at node rings of radius ra (start) and rb (end). */
function cutEnds(pts: Vec[], ra: number, rb: number): Vec[] {
  const out = cutStart(pts, ra);
  return cutStart(out.slice().reverse(), rb).reverse();
}

export function ShapeView({ s, stops = [] }: { s: Shape; stops?: Stop[] }) {
  const common = {
    stroke: s.stroke,
    strokeWidth: s.strokeWidth,
    strokeDasharray: dashArray(s.dash, s.strokeWidth),
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  if (s.kind === 'poly') {
    const raw = s.points ?? [];
    const pts = (s.closed ? raw : trimToStops(raw, stops)).map((p) => `${p.x},${p.y}`).join(' ');
    return s.closed ? <polygon points={pts} fill={s.fill} {...common} /> : <polyline points={pts} fill={s.fill === 'none' ? 'none' : s.fill} {...common} />;
  }
  const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
  const tf = s.rot || s.flipX ? `translate(${cx} ${cy}) rotate(${s.rot}) scale(${s.flipX ? -1 : 1} 1) translate(${-cx} ${-cy})` : undefined;
  let body: React.ReactNode = null;
  if (s.kind === 'rect') body = <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={s.radius} fill={s.fill} {...common} />;
  else if (s.kind === 'ellipse') body = <ellipse cx={cx} cy={cy} rx={s.w / 2} ry={s.h / 2} fill={s.fill} {...common} />;
  else if (s.kind === 'image') body = <image href={s.src} x={s.x} y={s.y} width={s.w} height={s.h} preserveAspectRatio="xMidYMid meet" />;
  return (
    <g transform={tf}>
      {body}
      {s.text && <TextLines text={s.text} x={cx} y={cy} fontSize={s.fontSize} color={s.textColor} />}
    </g>
  );
}

export function objTransform(o: Obj) {
  const c = objCenter(o);
  return `translate(${c.x} ${c.y}) rotate(${o.rot}) scale(${o.flipX ? -1 : 1} 1) translate(${-o.w / 2} ${-o.h / 2})`;
}

export function ObjectBody({ o, interactive }: { o: Obj; interactive: boolean }) {
  // lines of the drawing that end on a visible node stop at its outer ring
  const stops: Stop[] = o.ports.flatMap((p) => {
    const ns = p.style ?? DEFAULT_NODE_STYLE;
    return interactive || ns.exportVisible ? [{ x: p.x, y: p.y, r: ns.outerRadius }] : [];
  });
  return (
    <g transform={objTransform(o)} data-kind={interactive ? 'object' : undefined} data-id={o.id}>
      {interactive && <rect x={-3} y={-3} width={o.w + 6} height={o.h + 6} fill="transparent" />}
      {o.shapes.map((s) => (
        <ShapeView key={s.id} s={s} stops={stops} />
      ))}
    </g>
  );
}

function arrowHead(tip: Vec, from: Vec, size: number, color: string, key: string) {
  const d = norm(sub(tip, from));
  const base = sub(tip, mul(d, size));
  const n = { x: -d.y, y: d.x };
  const p1 = add(base, mul(n, size * 0.45));
  const p2 = sub(base, mul(n, size * 0.45));
  return <polygon key={key} points={`${tip.x},${tip.y} ${p1.x},${p1.y} ${p2.x},${p2.y}`} fill={color} />;
}

export function WireView({ doc, w, interactive, selected, highlighted }: { doc: Doc; w: Wire; interactive: boolean; selected?: boolean; highlighted?: boolean }) {
  const full = wireFull(doc, w);
  const size = 6 + w.width * 2;
  // the drawn line stops at the outer ring of a node (where that node is drawn)
  const ends = full.filter((p, i) => i === 0 || dist(p, full[i - 1]) > 0.01).map((p) => ({ ...p }));
  const trim = (ep: Endpoint) => {
    if (ep.kind !== 'port') return 0;
    const r = findPort(doc, ep.obj, ep.port);
    const ns = r?.p.style ?? DEFAULT_NODE_STYLE;
    return r && (interactive || ns.exportVisible) ? ns.outerRadius : 0;
  };
  const cut = cutEnds(ends, trim(w.a), trim(w.b));
  ends.splice(0, ends.length, ...cut);
  const pts = ends.map((p) => ({ ...p }));
  // shorten the line under arrowheads so the stroke does not poke through the tip
  if (w.arrowB && pts.length >= 2) {
    const n = pts.length;
    const l = dist(pts[n - 2], pts[n - 1]);
    if (l > size) pts[n - 1] = add(pts[n - 1], mul(norm(sub(pts[n - 2], pts[n - 1])), size * 0.7));
  }
  if (w.arrowA && pts.length >= 2) {
    const l = dist(pts[0], pts[1]);
    if (l > size) pts[0] = add(pts[0], mul(norm(sub(pts[1], pts[0])), size * 0.7));
  }
  const d = roundedPath(pts, w.radius);
  return (
    <g data-kind={interactive ? 'wire' : undefined} data-id={w.id}>
      {(selected || highlighted) && (
        <path d={roundedPath(full, w.radius)} fill="none" stroke={highlighted ? '#f59e0b' : '#3aa76d'} strokeOpacity={0.35} strokeWidth={w.width + 8} strokeLinecap="round" strokeLinejoin="round" />
      )}
      <path d={d} fill="none" stroke={w.color} strokeWidth={w.width} strokeDasharray={dashArray(w.dash, w.width)} strokeLinecap="round" strokeLinejoin="round" />
      {w.arrowB && ends.length >= 2 && arrowHead(ends[ends.length - 1], ends[ends.length - 2], size, w.color, 'ab')}
      {w.arrowA && ends.length >= 2 && arrowHead(ends[0], ends[1], size, w.color, 'aa')}
      {interactive &&
        full.slice(0, -1).map((p, i) => (
          <line key={i} data-seg={i} x1={p.x} y1={p.y} x2={full[i + 1].x} y2={full[i + 1].y} stroke="transparent" strokeWidth={Math.max(10, w.width + 8)} strokeLinecap="round" />
        ))}
    </g>
  );
}

function portLabelText(p: Port) {
  return p.number ? `${p.name} (${p.number})` : p.name;
}

export function PortLabel({ o, p, interactive }: { o: Obj; p: Port; interactive: boolean }) {
  const wp = portWorld(o, p);
  const x = wp.x + p.labelOffset.x, y = wp.y + p.labelOffset.y;
  const anchor = p.labelOffset.x < -2 ? 'end' : p.labelOffset.x > 2 ? 'start' : 'middle';
  const text = portLabelText(p);
  if (!text && !p.net) return null;
  return (
    <text
      x={x}
      y={y}
      fontSize={10}
      fill="#475569"
      textAnchor={anchor}
      dominantBaseline="central"
      fontFamily="Inter, system-ui, sans-serif"
      data-kind={interactive ? 'plabel' : undefined}
      data-obj={o.id}
      data-port={p.id}
      style={{ userSelect: 'none', cursor: interactive ? 'move' : undefined }}
    >
      {text}
      {p.net && (
        <tspan fill="#7c3aed" fontWeight={600}>
          {text ? ' ' : ''}[{p.net}]
        </tspan>
      )}
    </text>
  );
}

export function ObjectLabel({ o, interactive }: { o: Obj; interactive: boolean }) {
  if (!o.showLabel || !o.label) return null;
  const c = objCenter(o);
  return (
    <g data-kind={interactive ? 'olabel' : undefined} data-id={o.id} style={{ cursor: interactive ? 'move' : undefined }}>
      <TextLines text={o.label} x={c.x + o.labelOffset.x} y={c.y + o.labelOffset.y} fontSize={13} color="#0f172a" />
    </g>
  );
}

export interface SceneProps {
  doc: Doc;
  interactive?: boolean;
  sel?: Set<string>;
  highlight?: { wires: Set<string>; keys: Set<string> } | null;
  hoverPort?: string | null;
  connected?: Set<string>;
}

/** Everything that is part of the drawing (no editor UI). */
export function Scene({ doc, interactive = false, sel, highlight, hoverPort }: SceneProps) {
  const objs = doc.order.map((id) => doc.objects[id]).filter(Boolean);
  const wires = Object.values(doc.wires);
  const junctions = Object.values(doc.junctions);
  return (
    <>
      <g className="layer-objects">
        {objs.map((o) => (
          <ObjectBody key={o.id} o={o} interactive={interactive} />
        ))}
      </g>
      <g className="layer-wires">
        {wires.map((w) => (
          <WireView key={w.id} doc={doc} w={w} interactive={interactive} selected={sel?.has(w.id)} highlighted={highlight?.wires.has(w.id)} />
        ))}
      </g>
      <g className="layer-junctions">
        {junctions.map((j) => {
          const deg = junctionDegree(doc, j.id);
          const w = wires.find((x) => (x.a.kind === 'junction' && x.a.id === j.id) || (x.b.kind === 'junction' && x.b.id === j.id));
          const color = w?.color ?? '#1f2937';
          const r = Math.max(3, (w?.width ?? 2) * 1.6);
          return (
            <g key={j.id} data-kind={interactive ? 'junction' : undefined} data-id={j.id}>
              {deg >= 3 && <circle cx={j.x} cy={j.y} r={r} fill={color} />}
              {interactive && deg < 3 && <circle cx={j.x} cy={j.y} r={3} fill="#fff" stroke={color} strokeWidth={1.5} />}
              {interactive && <circle cx={j.x} cy={j.y} r={7} fill="transparent" />}
              {interactive && sel?.has(j.id) && <circle cx={j.x} cy={j.y} r={6} fill="none" stroke="#3aa76d" strokeWidth={1.5} />}
            </g>
          );
        })}
      </g>
      <g className="layer-ports">
        {objs.map((o) =>
          o.ports.map((p) => {
            const ns = p.style ?? DEFAULT_NODE_STYLE;
            if (!interactive && !ns.exportVisible) return null;
            const wp = portWorld(o, p);
            const key = `${o.id}:${p.id}`;
            const hot = hoverPort === key;
            const hl = highlight?.keys.has(`p:${o.id}:${p.id}`);
            const ring = ns.outerRadius + 2.5;
            return (
              <g key={key} data-kind={interactive ? 'port' : undefined} data-obj={o.id} data-port={p.id} className="port">
                {interactive && <circle cx={wp.x} cy={wp.y} r={Math.max(8, ns.outerRadius + 3)} fill="transparent" />}
                {interactive && (hot || hl) && <circle cx={wp.x} cy={wp.y} r={ring} fill="none" stroke={hl ? '#f59e0b' : '#3aa76d'} strokeWidth={2} strokeOpacity={0.6} />}
                {interactive && !hot && !hl && <circle cx={wp.x} cy={wp.y} r={ring} fill="none" stroke="#3aa76d" strokeWidth={2} strokeOpacity={0.6} className="port-hover" />}
                <NodeDot x={wp.x} y={wp.y} s={ns} />
              </g>
            );
          }),
        )}
      </g>
      <g className="layer-labels">
        {objs.map((o) => (
          <React.Fragment key={o.id}>
            <ObjectLabel o={o} interactive={interactive} />
            {o.ports.filter((p) => p.showLabel).map((p) => (
              <PortLabel key={p.id} o={o} p={p} interactive={interactive} />
            ))}
          </React.Fragment>
        ))}
      </g>
    </>
  );
}
