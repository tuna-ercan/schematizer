import { useCallback, useEffect, useState } from 'react';
import { Toolbar } from './Toolbar';
import { Canvas } from './Canvas';
import { Properties } from './Properties';
import { Library } from './Library';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { useStore } from './store';
import { addImageFile, align, copyToClip, lastClipText, deleteSelection, duplicate, group, pasteFromText, rotateOrFlip, selectAll, ungroup, zOrder, zoomBy, zoomToFit } from './actions';
import { saveProject } from './io';
import { loadUserSymbols, saveUserSymbols, type LibSymbol } from './symbols';
import { groupObjects, uid } from './model';
import { applyMove } from './edit';
import type { Doc, Obj, Tool } from './types';
import { produce } from 'immer';

const clip = { pasteHandled: false };

const toolKeys: Record<string, Tool> = { v: 'select', n: 'node', w: 'wire', b: 'box', l: 'line', t: 'text' };

const isInput = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

export function App() {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [help, setHelp] = useState(false);
  const [lib, setLib] = useState<LibSymbol[]>(loadUserSymbols);

  const updateLib = (list: LibSymbol[]) => {
    setLib(list);
    saveUserSymbols(list);
  };

  const addToLibrary = useCallback(
    (objId: string) => {
      const { doc, sel } = useStore.getState();
      const ids = sel.filter((id) => doc.objects[id]);
      const use = ids.includes(objId) ? ids : [objId];
      let obj: Obj;
      if (use.length > 1) {
        // several objects: store them as one grouped symbol
        let gid: string | null = null;
        const tmp: Doc = produce(doc, (d) => {
          gid = groupObjects(d, use);
        });
        obj = tmp.objects[gid!];
      } else obj = doc.objects[objId];
      if (!obj) return;
      const name = prompt('Name for this symbol', obj.label || 'Symbol');
      if (!name) return;
      const copy: Obj = JSON.parse(JSON.stringify({ ...obj, x: 0, y: 0 }));
      updateLib([...lib, { id: uid('sym'), name, obj: copy }]);
    },
    [lib],
  );

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isInput(e.target)) return;
      const s = useStore.getState();
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (ctrl) {
        if (k === 'z' && !e.shiftKey) s.undo();
        else if (k === 'y' || (k === 'z' && e.shiftKey)) s.redo();
        else if (k === 'a') selectAll();
        else if (k === 'd') duplicate();
        else if (k === 'g' && e.shiftKey) ungroup();
        else if (k === 'g') group();
        else if (k === 's') saveProject(s.doc, s.fileName);
        else if (k === '0') zoomBy(1 / s.zoom);
        else if (k === '=' || k === '+') zoomBy(1.2);
        else if (k === '-') zoomBy(1 / 1.2);
        else if (k === ']') zOrder('front');
        else if (k === '[') zOrder('back');
        else if (k === 'r') s.set({ showRulers: !s.showRulers });
        else if (k === ';') s.set({ showGuides: !s.showGuides });
        else if (k === 'c' || k === 'x') {
          // copy right away; the 'copy' event (if it fires) also puts it on the system clipboard
          if (window.getSelection()?.toString()) return;
          const text = copyToClip();
          if (text) navigator.clipboard?.writeText(text).catch(() => {});
          if (k === 'x' && text) deleteSelection();
          return;
        } else if (k === 'v') {
          // the 'paste' event handles system clipboard content; fall back to the internal clipboard
          clip.pasteHandled = false;
          setTimeout(() => {
            if (!clip.pasteHandled) pasteFromText(null);
          }, 80);
          return;
        } else return;
        e.preventDefault();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelection();
        e.preventDefault();
      } else if (e.key === 'Escape') {
        s.select([]);
        s.set({ tool: 'select', highlight: null });
      } else if (e.key === '?') setHelp((h) => !h);
      else if (e.key === '!' || (e.shiftKey && e.code === 'Digit1')) zoomToFit();
      else if (k === 'r' && !e.shiftKey) rotateOrFlip('rotate');
      else if (k === 'f') rotateOrFlip(e.shiftKey ? 'flipY' : 'flipX');
      else if (k === 'v' && e.shiftKey) align('vcenter');
      else if (k === 'h' && e.shiftKey) align('hcenter');
      else if (k === 'o') s.set({ ortho: !s.ortho });
      else if (k === 'g') s.set({ snap: !s.snap });
      else if (k === 'i') document.querySelector<HTMLInputElement>('input[type=file][accept="image/*"]')?.click();
      else if (k === '+' || k === '=') zoomBy(1.2);
      else if (k === '-') zoomBy(1 / 1.2);
      else if (toolKeys[k] && !e.shiftKey && !e.altKey) s.set({ tool: toolKeys[k] });
      else if (e.key.startsWith('Arrow')) {
        const step = e.shiftKey ? s.grid * 5 : s.grid;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        nudge(dx, dy);
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // clipboard (system clipboard so it works across tabs / files)
  useEffect(() => {
    const onCopy = (e: ClipboardEvent) => {
      if (isInput(e.target) || window.getSelection()?.toString()) return;
      const text = lastClipText();
      if (text) {
        e.clipboardData?.setData('text/plain', text);
        e.preventDefault();
      }
    };
    const onPaste = async (e: ClipboardEvent) => {
      if (isInput(e.target)) return;
      clip.pasteHandled = true;
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
      if (files.length) {
        e.preventDefault();
        for (const f of files) await addImageFile(f);
        return;
      }
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (pasteFromText(text)) e.preventDefault();
    };
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCopy);
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCopy);
      document.removeEventListener('paste', onPaste);
    };
  }, []);

  useEffect(() => {
    // center the origin on first load
    const s = useStore.getState();
    if (s.doc.order.length) setTimeout(zoomToFit);
    else {
      const el = document.getElementById('canvas-wrap');
      if (el) s.set({ pan: { x: Math.round(el.clientWidth / 2 / 10) * 10, y: Math.round(el.clientHeight / 2 / 10) * 10 } });
    }
  }, []);

  const openMenu = useCallback((x: number, y: number, items: MenuItem[]) => setMenu({ x, y, items }), []);
  const closeMenu = useCallback(() => setMenu(null), []);

  return (
    <div className="app">
      <Toolbar onHelp={() => setHelp(true)} />
      <div className="main">
        <Library user={lib} onChange={updateLib} />
        <Canvas openMenu={openMenu} onAddToLibrary={addToLibrary} />
        <Properties onAddToLibrary={addToLibrary} />
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}
      {help && <Help onClose={() => setHelp(false)} />}
    </div>
  );
}

function nudge(dx: number, dy: number) {
  const s = useStore.getState();
  const objs = new Set(s.sel.filter((id) => s.doc.objects[id]));
  const juncs = new Set(s.sel.filter((id) => s.doc.junctions[id]));
  const wires = new Set(s.sel.filter((id) => s.doc.wires[id]));
  if (!objs.size && !juncs.size && !wires.size) return;
  const before = s.doc;
  s.setLive(applyMove(before, objs, juncs, wires, { x: dx, y: dy }, s.grid));
  s.pushHistory(before);
}

const shortcuts: [string, string][] = [
  ['V / N / W / B / L / T', 'Select / Node / Wire / Box / Line / Text tool'],
  ['I', 'Upload image'],
  ['Click a node', 'Start a connection (then click target node, junction or wire)'],
  ['Click empty space while wiring', 'Add a corner'],
  ['Double-click while wiring', 'End the wire with a free end'],
  ['Double-click a wire', 'Add a corner'],
  ['Drag wire segment / corner', 'Move it'],
  ['Alt + click a wire', 'Highlight the whole net'],
  ['Double-click object / node', 'Edit text / name'],
  ['O', 'Toggle orthogonal lock'],
  ['G', 'Toggle snap to grid'],
  ['R / F / Shift+F', 'Rotate / flip horizontal / flip vertical'],
  ['Ctrl+C / Ctrl+V / Ctrl+X / Ctrl+D', 'Copy / paste / cut / duplicate'],
  ['Ctrl+G / Ctrl+Shift+G', 'Group / ungroup'],
  ['Shift+V / Shift+H', 'Align vertical centers (row) / horizontal centers (column)'],
  ['Ctrl+R / Ctrl+;', 'Show/hide rulers / guides'],
  ['Drag from a ruler', 'Create a guide (drag it back onto the ruler to delete)'],
  ['Ctrl+Z / Ctrl+Y', 'Undo / redo'],
  ['Ctrl+S', 'Save project file'],
  ['Arrows (Shift)', 'Nudge selection'],
  ['Wheel / Space+drag / middle drag', 'Zoom / pan'],
  ['Shift+1', 'Zoom to fit'],
  ['Delete', 'Delete selection'],
  ['Esc', 'Cancel / deselect'],
];

function Help({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <b>Keyboard shortcuts & tips</b>
          <button className="icon-btn" onClick={onClose}>
            ×
          </button>
        </div>
        <table className="shortcuts">
          <tbody>
            {shortcuts.map(([k, d]) => (
              <tr key={k}>
                <td>
                  <kbd>{k}</kbd>
                </td>
                <td>{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

