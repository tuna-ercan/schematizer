import React from 'react';
import { produce } from 'immer';
import { useStore } from './store';
import type { Dash, Doc, Shape, WireStyle } from './types';
import { autoRoute, defaultPortLabelOffset, findPort, normalizeWire } from './model';
import { objBBox } from './geometry';
import { align, deleteSelection, group, organize, rotateOrFlip, ungroup, zOrder } from './actions';
import { resizeObject, applyMove } from './edit';

// ---------------------------------------------------------------- live edit with grouped undo
let editBase: Doc | null = null;
let editTimer: number | undefined;
function editDoc(fn: (d: Doc) => void) {
  const s = useStore.getState();
  if (!editBase) editBase = s.doc;
  s.setLive(produce(s.doc, fn));
  clearTimeout(editTimer);
  editTimer = window.setTimeout(() => {
    if (editBase) useStore.getState().pushHistory(editBase);
    editBase = null;
  }, 600);
}

// ---------------------------------------------------------------- fields
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="prop-row">
      <span className="prop-label">{label}</span>
      <span className="prop-value">{children}</span>
    </label>
  );
}

function Text({ value, onChange, multiline, placeholder }: { value: string; onChange: (v: string) => void; multiline?: boolean; placeholder?: string }) {
  return multiline ? (
    <textarea className="prop-input" rows={2} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
  ) : (
    <input className="prop-input" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
  );
}

function Num({ value, onChange, min, max, step = 1 }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <input
      className="prop-input num"
      type="number"
      value={Math.round(value * 100) / 100}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const v = parseFloat(e.target.value);
        if (!isNaN(v)) onChange(v);
      }}
    />
  );
}

function Color({ value, onChange, allowNone }: { value: string; onChange: (v: string) => void; allowNone?: boolean }) {
  const none = value === 'none' || value === 'transparent';
  return (
    <span className="color-field">
      <input type="color" value={none ? '#ffffff' : value} onChange={(e) => onChange(e.target.value)} disabled={none} />
      {allowNone && (
        <label className="none-toggle">
          <input type="checkbox" checked={none} onChange={(e) => onChange(e.target.checked ? 'none' : '#ffffff')} /> none
        </label>
      )}
    </span>
  );
}

function DashSelect({ value, onChange }: { value: Dash; onChange: (v: Dash) => void }) {
  return (
    <select className="prop-input" value={value} onChange={(e) => onChange(e.target.value as Dash)}>
      <option value="solid">Solid</option>
      <option value="dashed">Dashed</option>
      <option value="dotted">Dotted</option>
      <option value="dashdot">Dash-dot</option>
    </select>
  );
}

function Check({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="check">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="prop-section">
    <div className="prop-title">{title}</div>
    {children}
  </div>
);

// ---------------------------------------------------------------- wire style editor
function WireStyleEditor({ style, onChange }: { style: WireStyle; onChange: (p: Partial<WireStyle>) => void }) {
  return (
    <>
      <Row label="Color">
        <Color value={style.color} onChange={(v) => onChange({ color: v })} />
      </Row>
      <Row label="Thickness">
        <Num value={style.width} min={0.5} max={20} step={0.5} onChange={(v) => onChange({ width: v })} />
      </Row>
      <Row label="Style">
        <DashSelect value={style.dash} onChange={(v) => onChange({ dash: v })} />
      </Row>
      <Row label="Corner radius">
        <Num value={style.radius} min={0} max={50} onChange={(v) => onChange({ radius: v })} />
      </Row>
      <Row label="Arrows">
        <span className="inline">
          <Check label="start" value={style.arrowA} onChange={(v) => onChange({ arrowA: v })} />
          <Check label="end" value={style.arrowB} onChange={(v) => onChange({ arrowB: v })} />
        </span>
      </Row>
      <div className="swatches">
        {['#1f2937', '#dc2626', '#2563eb', '#16a34a', '#ea580c', '#7c3aed', '#0891b2', '#9ca3af'].map((c) => (
          <button key={c} className="swatch" style={{ background: c }} title={c} onClick={() => onChange({ color: c })} />
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- shape editor
function ShapeEditor({ objId, shape }: { objId: string; shape: Shape }) {
  const upd = (p: Partial<Shape>) =>
    editDoc((d) => {
      const s = d.objects[objId]?.shapes.find((x) => x.id === shape.id);
      if (s) Object.assign(s, p);
    });
  if (shape.kind === 'image') {
    return (
      <Row label="Image">
        <button
          className="small-btn"
          onClick={() => {
            const inp = document.createElement('input');
            inp.type = 'file';
            inp.accept = 'image/*';
            inp.onchange = () => {
              const f = inp.files?.[0];
              if (!f) return;
              const r = new FileReader();
              r.onload = () => useStore.getState().commit((d) => {
                const s = d.objects[objId]?.shapes.find((x) => x.id === shape.id);
                if (s) s.src = r.result as string;
              });
              r.readAsDataURL(f);
            };
            inp.click();
          }}
        >
          Replace image…
        </button>
      </Row>
    );
  }
  const hasText = shape.kind !== 'poly';
  return (
    <>
      {shape.kind !== 'text' && (
        <>
          <Row label="Stroke">
            <Color value={shape.stroke} allowNone onChange={(v) => upd({ stroke: v })} />
          </Row>
          <Row label="Fill">
            <Color value={shape.fill} allowNone onChange={(v) => upd({ fill: v })} />
          </Row>
          <Row label="Line width">
            <Num value={shape.strokeWidth} min={0} max={20} step={0.5} onChange={(v) => upd({ strokeWidth: v })} />
          </Row>
          <Row label="Line style">
            <DashSelect value={shape.dash} onChange={(v) => upd({ dash: v })} />
          </Row>
        </>
      )}
      {shape.kind === 'rect' && (
        <Row label="Corner radius">
          <Num value={shape.radius} min={0} max={100} onChange={(v) => upd({ radius: v })} />
        </Row>
      )}
      {shape.kind === 'poly' && (
        <Row label="Closed">
          <Check label="closed shape" value={!!shape.closed} onChange={(v) => upd({ closed: v })} />
        </Row>
      )}
      {hasText && (
        <>
          <Row label="Text">
            <Text multiline value={shape.text} onChange={(v) => upd({ text: v })} />
          </Row>
          <Row label="Font size">
            <Num value={shape.fontSize} min={6} max={96} onChange={(v) => upd({ fontSize: v })} />
          </Row>
          <Row label="Text color">
            <Color value={shape.textColor} onChange={(v) => upd({ textColor: v })} />
          </Row>
        </>
      )}
    </>
  );
}

const shapeName: Record<Shape['kind'], string> = { rect: 'Box', ellipse: 'Ellipse', image: 'Image', text: 'Text', poly: 'Line' };

// ---------------------------------------------------------------- panel
export function Properties({ onAddToLibrary }: { onAddToLibrary: (id: string) => void }) {
  const s = useStore();
  const { doc, sel, selPort } = s;

  if (selPort) {
    const r = findPort(doc, selPort.obj, selPort.port);
    if (r) {
      const upd = (p: Partial<typeof r.p>) =>
        editDoc((d) => {
          const port = d.objects[selPort.obj]?.ports.find((x) => x.id === selPort.port);
          if (port) Object.assign(port, p);
        });
      const wires = Object.values(doc.wires).filter(
        (w) => (w.a.kind === 'port' && w.a.obj === r.o.id && w.a.port === r.p.id) || (w.b.kind === 'port' && w.b.obj === r.o.id && w.b.port === r.p.id),
      ).length;
      return (
        <aside className="props">
          <Section title="Node">
            <Row label="Name">
              <Text value={r.p.name} onChange={(v) => upd({ name: v })} />
            </Row>
            <Row label="Pin number">
              <Text value={r.p.number} placeholder="optional" onChange={(v) => upd({ number: v })} />
            </Row>
            <Row label="Net label">
              <Text value={r.p.net} placeholder="e.g. GND" onChange={(v) => upd({ net: v })} />
            </Row>
            <Row label="Label">
              <Check label="show" value={r.p.showLabel} onChange={(v) => upd({ showLabel: v })} />
            </Row>
            <div className="prop-actions">
              <button className="small-btn" onClick={() => upd({ labelOffset: defaultPortLabelOffset(r.o, r.p) })}>
                Reset label position
              </button>
              <button className="small-btn danger" onClick={deleteSelection}>
                Delete node
              </button>
            </div>
            <p className="muted">
              Of object “{r.o.label || 'unnamed'}” · {wires} connection{wires === 1 ? '' : 's'}. Nodes with the same net label are connected without a wire.
            </p>
          </Section>
        </aside>
      );
    }
  }

  const objs = sel.map((id) => doc.objects[id]).filter(Boolean);
  const wires = sel.map((id) => doc.wires[id]).filter(Boolean);

  if (objs.length === 1 && wires.length === 0) {
    const o = objs[0];
    const bb = objBBox(o);
    const upd = (fn: (oo: typeof o) => void) => editDoc((d) => d.objects[o.id] && fn(d.objects[o.id]));
    const setBox = (p: Partial<{ x: number; y: number; w: number; h: number }>) => {
      const st = useStore.getState();
      const base = editBase ?? st.doc;
      if (p.x !== undefined || p.y !== undefined) {
        const next = applyMove(st.doc, new Set([o.id]), new Set(), new Set(), { x: (p.x ?? bb.x) - bb.x, y: (p.y ?? bb.y) - bb.y }, st.grid);
        editBase = base;
        st.setLive(next);
      } else {
        const next = resizeObject(st.doc, o.id, { x: bb.x, y: bb.y, w: Math.max(p.w ?? bb.w, 1), h: Math.max(p.h ?? bb.h, 1) }, st.grid);
        editBase = base;
        st.setLive(next);
      }
      clearTimeout(editTimer);
      editTimer = window.setTimeout(() => {
        if (editBase) useStore.getState().pushHistory(editBase);
        editBase = null;
      }, 600);
    };
    return (
      <aside className="props">
        <Section title="Object">
          <Row label="Label">
            <Text value={o.label} onChange={(v) => upd((x) => (x.label = v))} placeholder="name" />
          </Row>
          <Row label="Show label">
            <Check label="" value={o.showLabel} onChange={(v) => upd((x) => (x.showLabel = v))} />
          </Row>
          <div className="grid2">
            <Row label="X">
              <Num value={bb.x} onChange={(v) => setBox({ x: v })} />
            </Row>
            <Row label="Y">
              <Num value={bb.y} onChange={(v) => setBox({ y: v })} />
            </Row>
            <Row label="W">
              <Num value={bb.w} min={1} onChange={(v) => setBox({ w: v })} />
            </Row>
            <Row label="H">
              <Num value={bb.h} min={1} onChange={(v) => setBox({ h: v })} />
            </Row>
          </div>
          <div className="prop-actions">
            <button className="small-btn" onClick={() => rotateOrFlip('rotate')}>
              Rotate 90°
            </button>
            <button className="small-btn" onClick={() => rotateOrFlip('flipX')}>
              Flip H
            </button>
            <button className="small-btn" onClick={() => rotateOrFlip('flipY')}>
              Flip V
            </button>
            <button className="small-btn" onClick={() => zOrder('front')}>
              To front
            </button>
            <button className="small-btn" onClick={() => zOrder('back')}>
              To back
            </button>
            {o.shapes.length > 1 && (
              <button className="small-btn" onClick={ungroup}>
                Ungroup
              </button>
            )}
            <button className="small-btn" onClick={() => onAddToLibrary(o.id)}>
              Add to library
            </button>
            <button className="small-btn" onClick={organize}>
              Organize wires
            </button>
          </div>
        </Section>
        <Section title={`Nodes (${o.ports.length})`}>
          {o.ports.length === 0 && <p className="muted">Use the Node tool (N) and click on the object to add connection points.</p>}
          {o.ports.map((p) => (
            <div key={p.id} className="port-row">
              <input
                className="prop-input"
                value={p.name}
                onChange={(e) =>
                  editDoc((d) => {
                    const port = d.objects[o.id]?.ports.find((x) => x.id === p.id);
                    if (port) port.name = e.target.value;
                  })
                }
              />
              <button className="icon-btn" title="Select node" onClick={() => s.select([], { obj: o.id, port: p.id })}>
                ⋯
              </button>
            </div>
          ))}
        </Section>
        {o.shapes.map((sh, i) => (
          <Section key={sh.id} title={o.shapes.length > 1 ? `${shapeName[sh.kind]} ${i + 1}` : shapeName[sh.kind]}>
            <ShapeEditor objId={o.id} shape={sh} />
          </Section>
        ))}
      </aside>
    );
  }

  if (wires.length > 0) {
    const w0 = wires[0];
    const upd = (p: Partial<WireStyle>) =>
      editDoc((d) => {
        for (const w of wires) if (d.wires[w.id]) Object.assign(d.wires[w.id], p);
      });
    const allOrtho = wires.every((w) => w.ortho);
    return (
      <aside className="props">
        <Section title={wires.length > 1 ? `${wires.length} connections` : 'Connection'}>
          <WireStyleEditor style={w0} onChange={upd} />
          <Row label="Routing">
            <Check
              label="orthogonal"
              value={allOrtho}
              onChange={(v) =>
                s.commit((d) => {
                  for (const w of wires) {
                    const dw = d.wires[w.id];
                    if (!dw) continue;
                    dw.ortho = v;
                    if (v) {
                      dw.points = autoRoute(d, dw.a, dw.b, new Set([dw.id]), s.grid);
                      normalizeWire(d, dw);
                    }
                  }
                })
              }
            />
          </Row>
          <div className="prop-actions">
            <button className="small-btn" onClick={() => s.set({ wireStyle: { color: w0.color, width: w0.width, dash: w0.dash, radius: w0.radius, arrowA: w0.arrowA, arrowB: w0.arrowB } })}>
              Use as default
            </button>
            <button className="small-btn" onClick={organize}>
              Organize
            </button>
            <button className="small-btn danger" onClick={deleteSelection}>
              Delete
            </button>
          </div>
        </Section>
        {objs.length > 1 && <MultiObject count={objs.length} />}
      </aside>
    );
  }

  if (objs.length > 1) {
    return (
      <aside className="props">
        <MultiObject count={objs.length} />
      </aside>
    );
  }

  return (
    <aside className="props">
      <Section title="New connections">
        <WireStyleEditor style={s.wireStyle} onChange={(p) => s.set({ wireStyle: { ...s.wireStyle, ...p } })} />
      </Section>
      <Section title="Canvas">
        <Row label="Grid size">
          <Num value={s.grid} min={2} max={100} onChange={(v) => s.set({ grid: Math.max(2, v) })} />
        </Row>
        <Row label="Orthogonal lock">
          <Check label="" value={s.ortho} onChange={(v) => s.set({ ortho: v })} />
        </Row>
        <Row label="Snap to grid">
          <Check label="" value={s.snap} onChange={(v) => s.set({ snap: v })} />
        </Row>
        <p className="muted">
          {doc.order.length} objects · {Object.keys(doc.wires).length} connections
        </p>
      </Section>
    </aside>
  );
}

function MultiObject({ count }: { count: number }) {
  return (
    <Section title={`${count} objects`}>
      <div className="prop-actions">
        <button className="small-btn" onClick={group}>
          Group
        </button>
        <button className="small-btn" onClick={organize}>
          Organize wires
        </button>
        <button className="small-btn" onClick={() => rotateOrFlip('rotate')}>
          Rotate
        </button>
        <button className="small-btn danger" onClick={deleteSelection}>
          Delete
        </button>
      </div>
      <div className="prop-title sub">Align</div>
      <div className="prop-actions">
        <button className="small-btn" onClick={() => align('left')}>Left</button>
        <button className="small-btn" onClick={() => align('hcenter')}>Center</button>
        <button className="small-btn" onClick={() => align('right')}>Right</button>
        <button className="small-btn" onClick={() => align('top')}>Top</button>
        <button className="small-btn" onClick={() => align('vcenter')}>Middle</button>
        <button className="small-btn" onClick={() => align('bottom')}>Bottom</button>
      </div>
    </Section>
  );
}
