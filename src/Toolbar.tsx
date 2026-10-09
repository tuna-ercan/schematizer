import React, { useRef } from 'react';
import { useStore } from './store';
import type { Tool } from './types';
import { Icons } from './icons';
import { addImageFile, deleteSelection, group, organize, rotateOrFlip, ungroup, zoomBy, zoomToFit } from './actions';
import { exportPng, exportSvg, parseProject, saveProject } from './io';
import { emptyDoc } from './types';

const tools: { id: Tool; label: string; key: string }[] = [
  { id: 'select', label: 'Select', key: 'V' },
  { id: 'node', label: 'Node tool – add connection points', key: 'N' },
  { id: 'wire', label: 'Wire tool', key: 'W' },
  { id: 'box', label: 'Box tool', key: 'B' },
  { id: 'line', label: 'Line tool', key: 'L' },
  { id: 'text', label: 'Text tool', key: 'T' },
];

function Btn({ title, onClick, active, disabled, children }: { title: string; onClick: () => void; active?: boolean; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button className={`tb-btn${active ? ' active' : ''}`} title={title} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function Toolbar({ onHelp }: { onHelp: () => void }) {
  const s = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const openRef = useRef<HTMLInputElement>(null);
  const hasObjSel = s.sel.some((id) => s.doc.objects[id]);
  const multiObj = s.sel.filter((id) => s.doc.objects[id]).length > 1;
  const canUngroup = s.sel.some((id) => (s.doc.objects[id]?.shapes.length ?? 0) > 1);

  return (
    <div className="toolbar">
      <div className="brand">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="5" width="7" height="7" rx="1.5" />
          <rect x="15" y="12" width="7" height="7" rx="1.5" />
          <path d="M9 8.5h3a2 2 0 012 2v3a2 2 0 002 2" />
        </svg>
        <span>Schematizer</span>
      </div>
      <input
        className="file-name"
        value={s.fileName}
        onChange={(e) => s.set({ fileName: e.target.value })}
        title="File name"
        spellCheck={false}
      />
      <div className="tb-group">
        <button
          className="tb-text"
          onClick={() => {
            if (confirm('Start a new drawing? Unsaved changes will be lost.')) s.loadDoc(emptyDoc(), 'untitled');
          }}
        >
          New
        </button>
        <button className="tb-text" onClick={() => openRef.current?.click()}>
          Open
        </button>
        <button className="tb-text" onClick={() => saveProject(s.doc, s.fileName)} title="Save (Ctrl+S)">
          Save
        </button>
        <button className="tb-text" onClick={() => exportSvg(s.doc, s.fileName)}>
          SVG
        </button>
        <button className="tb-text" onClick={() => exportPng(s.doc, s.fileName).catch((e) => alert(e.message))}>
          PNG
        </button>
      </div>
      <div className="tb-group">
        <Btn title="Undo (Ctrl+Z)" onClick={s.undo} disabled={!s.past.length}>
          {Icons.undo}
        </Btn>
        <Btn title="Redo (Ctrl+Y)" onClick={s.redo} disabled={!s.future.length}>
          {Icons.redo}
        </Btn>
      </div>
      <div className="tb-group">
        {tools.map((t) => (
          <Btn key={t.id} title={`${t.label} (${t.key})`} active={s.tool === t.id} onClick={() => s.set({ tool: t.id })}>
            {Icons[t.id]}
          </Btn>
        ))}
        <Btn title="Upload image (I)" onClick={() => fileRef.current?.click()}>
          {Icons.image}
        </Btn>
      </div>
      <div className="tb-group">
        <Btn title={`Orthogonal lock: ${s.ortho ? 'ON' : 'OFF'} (O)`} active={s.ortho} onClick={() => s.set({ ortho: !s.ortho })}>
          {Icons.ortho}
        </Btn>
        <Btn title={`Snap to grid: ${s.snap ? 'ON' : 'OFF'} (G)`} active={s.snap} onClick={() => s.set({ snap: !s.snap })}>
          {Icons.snap}
        </Btn>
        <Btn title="Show grid" active={s.showGrid} onClick={() => s.set({ showGrid: !s.showGrid })}>
          {Icons.grid}
        </Btn>
        <button className="tb-text accent" title="Organize selected connections (or all, if nothing is selected)" onClick={organize}>
          {Icons.organize}
          <span>Organize</span>
        </button>
      </div>
      <div className="tb-group">
        <Btn title="Rotate 90° (R)" onClick={() => rotateOrFlip('rotate')} disabled={!hasObjSel}>
          {Icons.rotate}
        </Btn>
        <Btn title="Flip horizontal (F)" onClick={() => rotateOrFlip('flipX')} disabled={!hasObjSel}>
          {Icons.flip}
        </Btn>
        <Btn title="Group (Ctrl+G)" onClick={group} disabled={!multiObj}>
          {Icons.group}
        </Btn>
        <Btn title="Ungroup (Ctrl+Shift+G)" onClick={ungroup} disabled={!canUngroup}>
          {Icons.ungroup}
        </Btn>
        <Btn title="Delete (Del)" onClick={deleteSelection} disabled={!s.sel.length && !s.selPort}>
          {Icons.trash}
        </Btn>
      </div>
      <div className="tb-spacer" />
      <div className="tb-group">
        <Btn title="Zoom out (-)" onClick={() => zoomBy(1 / 1.2)}>
          {Icons.zoomOut}
        </Btn>
        <button className="tb-text zoom" title="Reset zoom (Ctrl+0)" onClick={() => zoomBy(1 / s.zoom)}>
          {Math.round(s.zoom * 100)}%
        </button>
        <Btn title="Zoom in (+)" onClick={() => zoomBy(1.2)}>
          {Icons.zoomIn}
        </Btn>
        <Btn title="Zoom to fit (Shift+1)" onClick={zoomToFit}>
          {Icons.fit}
        </Btn>
        <Btn title="Keyboard shortcuts (?)" onClick={onHelp}>
          {Icons.help}
        </Btn>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={async (e) => {
          for (const f of Array.from(e.target.files ?? [])) await addImageFile(f);
          e.target.value = '';
        }}
      />
      <input
        ref={openRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            const doc = parseProject(await f.text());
            s.loadDoc(doc, f.name.replace(/\.schematizer\.json$|\.json$/i, ''));
            setTimeout(zoomToFit);
          } catch (err: any) {
            alert(`Could not open file: ${err.message}`);
          }
        }}
      />
    </div>
  );
}
