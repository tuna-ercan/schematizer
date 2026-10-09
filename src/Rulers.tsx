import React, { useEffect, useRef, useState } from 'react';
import { useStore } from './store';
import { objBBox, snapN, unionRect } from './geometry';

export const RULER = 20;

/** Tick spacing in world units: a 1/2/5 step that is at least ~60px apart on screen. */
function tickStep(zoom: number) {
  const target = 60 / zoom;
  const p = 10 ** Math.floor(Math.log10(target));
  for (const b of [1, 2, 5, 10]) if (b * p >= target) return b * p;
  return 10 * p;
}

function fmt(n: number) {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
}

interface TickProps {
  axis: 'x' | 'y';
  length: number;
  pan: number;
  zoom: number;
  cursor: number | null;
  selRange: [number, number] | null;
}

function Ticks({ axis, length, pan, zoom, cursor, selRange }: TickProps) {
  const major = tickStep(zoom);
  const minorDiv = major * zoom >= 100 ? 10 : 5;
  const minor = major / minorDiv;
  const w0 = -pan / zoom, w1 = (length - pan) / zoom;
  const ticks: React.ReactNode[] = [];
  const i0 = Math.floor(w0 / minor), i1 = Math.ceil(w1 / minor);
  for (let i = i0; i <= i1; i++) {
    const v = i * minor;
    const s = Math.round(v * zoom + pan) + 0.5;
    const isMajor = i % minorDiv === 0;
    const isHalf = !isMajor && minorDiv === 10 && i % 5 === 0;
    const len = isMajor ? RULER : isHalf ? RULER * 0.45 : RULER * 0.25;
    if (axis === 'x') {
      ticks.push(<line key={i} x1={s} x2={s} y1={RULER - len} y2={RULER} />);
      if (isMajor) ticks.push(<text key={`t${i}`} x={s + 3} y={9}>{fmt(v)}</text>);
    } else {
      ticks.push(<line key={i} y1={s} y2={s} x1={RULER - len} x2={RULER} />);
      if (isMajor)
        ticks.push(
          <text key={`t${i}`} x={9} y={s - 3} transform={`rotate(-90 9 ${s - 3})`}>
            {fmt(v)}
          </text>,
        );
    }
  }
  const sel = selRange && selRange.map((v) => v * zoom + pan);
  const cur = cursor != null ? Math.round(cursor) + 0.5 : null;
  return (
    <>
      {sel &&
        (axis === 'x' ? (
          <rect className="ruler-sel" x={sel[0]} y={0} width={Math.max(1, sel[1] - sel[0])} height={RULER} />
        ) : (
          <rect className="ruler-sel" y={sel[0]} x={0} height={Math.max(1, sel[1] - sel[0])} width={RULER} />
        ))}
      <g className="ruler-ticks">{ticks}</g>
      {cur != null &&
        (axis === 'x' ? <line className="ruler-cursor" x1={cur} x2={cur} y1={0} y2={RULER} /> : <line className="ruler-cursor" y1={cur} y2={cur} x1={0} x2={RULER} />)}
    </>
  );
}

/** Photoshop-style rulers along the top and left edge of the canvas; drag from them to create guides. */
export function Rulers() {
  const { pan, zoom, showRulers, doc, sel, snap, grid } = useStore();
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<{ axis: 'v' | 'h'; pos: number } | null>(null);

  useEffect(() => {
    const wrap = ref.current?.parentElement;
    if (!wrap) return;
    const ro = new ResizeObserver(() => setSize({ w: wrap.clientWidth, h: wrap.clientHeight }));
    ro.observe(wrap);
    const move = (e: PointerEvent) => {
      const r = wrap.getBoundingClientRect();
      setCursor({ x: e.clientX - r.left, y: e.clientY - r.top });
    };
    const leave = () => setCursor(null);
    wrap.addEventListener('pointermove', move);
    wrap.addEventListener('pointerleave', leave);
    return () => {
      ro.disconnect();
      wrap.removeEventListener('pointermove', move);
      wrap.removeEventListener('pointerleave', leave);
    };
  }, [showRulers]);

  if (!showRulers) return <div ref={ref} style={{ display: 'none' }} />;

  const bb = unionRect(sel.filter((id) => doc.objects[id]).map((id) => objBBox(doc.objects[id])));

  // dragging a new guide out of a ruler
  const startGuide = (axis: 'v' | 'h') => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    const r = ref.current!.parentElement!.getBoundingClientRect();
    const pos = axis === 'v' ? e.clientX - r.left : e.clientY - r.top;
    setDrag({ axis, pos });
  };
  const moveGuide = (e: React.PointerEvent) => {
    if (!drag) return;
    const r = ref.current!.parentElement!.getBoundingClientRect();
    setDrag({ ...drag, pos: drag.axis === 'v' ? e.clientX - r.left : e.clientY - r.top });
  };
  const endGuide = () => {
    if (!drag) return;
    const d = drag;
    setDrag(null);
    if (d.pos <= RULER) return; // released over the ruler: cancelled
    const panA = d.axis === 'v' ? pan.x : pan.y;
    let v = (d.pos - panA) / zoom;
    if (snap) v = snapN(v, grid);
    const s = useStore.getState();
    s.commit((dd) => {
      dd.guides ??= { v: [], h: [] };
      dd.guides[d.axis].push(v);
    });
    if (!s.showGuides) s.set({ showGuides: true });
  };

  const dragScreen = drag && (() => {
    if (drag.pos <= RULER) return drag.pos;
    const panA = drag.axis === 'v' ? pan.x : pan.y;
    let v = (drag.pos - panA) / zoom;
    if (snap) v = snapN(v, grid);
    return v * zoom + panA;
  })();

  return (
    <div ref={ref} className="rulers">
      <svg className="ruler ruler-top" width={size.w} height={RULER} onPointerDown={startGuide('h')} onPointerMove={moveGuide} onPointerUp={endGuide}>
        <title>Drag down to create a horizontal guide</title>
        <rect className="ruler-bg" width="100%" height="100%" />
        <Ticks axis="x" length={size.w} pan={pan.x} zoom={zoom} cursor={cursor?.x ?? null} selRange={bb ? [bb.x, bb.x + bb.w] : null} />
        <line className="ruler-edge" x1={0} x2={size.w} y1={RULER - 0.5} y2={RULER - 0.5} />
      </svg>
      <svg className="ruler ruler-left" width={RULER} height={size.h} onPointerDown={startGuide('v')} onPointerMove={moveGuide} onPointerUp={endGuide}>
        <title>Drag right to create a vertical guide</title>
        <rect className="ruler-bg" width="100%" height="100%" />
        <Ticks axis="y" length={size.h} pan={pan.y} zoom={zoom} cursor={cursor?.y ?? null} selRange={bb ? [bb.y, bb.y + bb.h] : null} />
        <line className="ruler-edge" y1={0} y2={size.h} x1={RULER - 0.5} x2={RULER - 0.5} />
      </svg>
      <div className="ruler-corner" title="Rulers (Ctrl+R) · drag from a ruler to add a guide" />
      {drag && dragScreen != null && (
        <div className={`guide-preview ${drag.axis}`} style={drag.axis === 'v' ? { left: dragScreen } : { top: dragScreen }} />
      )}
    </div>
  );
}
