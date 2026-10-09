import { useMemo, useState } from 'react';
import type { Doc } from './types';
import { Scene } from './Scene';
import { builtinSymbols, instantiate, type LibSymbol } from './symbols';
import { addObject, viewportCenter } from './actions';
import { useStore } from './store';
import { snapV } from './geometry';
import { docBounds } from './io';

function Thumb({ s }: { s: LibSymbol }) {
  const doc: Doc = useMemo(() => ({ objects: { [s.obj.id]: s.obj }, order: [s.obj.id], wires: {}, junctions: {} }), [s]);
  const b = docBounds(doc);
  const pad = 6;
  return (
    <svg viewBox={`${b.x - pad} ${b.y - pad} ${b.w + pad * 2} ${b.h + pad * 2}`} width="100%" height="56" preserveAspectRatio="xMidYMid meet">
      <Scene doc={doc} />
    </svg>
  );
}

export function Library({ user, onChange }: { user: LibSymbol[]; onChange: (list: LibSymbol[]) => void }) {
  const builtins = useMemo(builtinSymbols, []);
  const [open, setOpen] = useState(true);
  const place = (s: LibSymbol) => {
    const c = viewportCenter();
    const g = useStore.getState().grid;
    addObject(instantiate(s, snapV({ x: c.x - s.obj.w / 2, y: c.y - s.obj.h / 2 }, g)));
  };
  const item = (s: LibSymbol) => (
    <div
      key={s.id}
      className="lib-item"
      title={`${s.name} — click to add, or drag onto the canvas`}
      draggable
      onDragStart={(e) => e.dataTransfer.setData('application/x-schematizer-symbol', JSON.stringify(s))}
      onClick={() => place(s)}
    >
      <Thumb s={s} />
      <span className="lib-name">{s.name}</span>
      {!s.builtin && (
        <span className="lib-actions">
          <button
            title="Rename"
            onClick={(e) => {
              e.stopPropagation();
              const n = prompt('Symbol name', s.name);
              if (n) onChange(user.map((x) => (x.id === s.id ? { ...x, name: n } : x)));
            }}
          >
            ✎
          </button>
          <button
            title="Remove from library"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`Remove “${s.name}” from the library?`)) onChange(user.filter((x) => x.id !== s.id));
            }}
          >
            ×
          </button>
        </span>
      )}
    </div>
  );
  return (
    <aside className={`library${open ? '' : ' collapsed'}`}>
      <button className="lib-toggle" onClick={() => setOpen(!open)} title={open ? 'Hide library' : 'Show library'}>
        {open ? '‹' : '›'}
      </button>
      {open && (
        <div className="lib-scroll">
          <div className="lib-title">My symbols</div>
          {user.length === 0 && <p className="muted small">Right-click an object → “Add to library” to reuse it here.</p>}
          <div className="lib-grid">{user.map(item)}</div>
          <div className="lib-title">Basic</div>
          <div className="lib-grid">{builtins.map(item)}</div>
        </div>
      )}
    </aside>
  );
}
