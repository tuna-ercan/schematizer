import { create } from 'zustand';
import { produce, setAutoFreeze } from 'immer';
import type { Doc, Tool, Vec, WireStyle } from './types';
import { emptyDoc } from './types';
import { defaultWireStyle } from './model';

setAutoFreeze(false);

export interface PortRef {
  obj: string;
  port: string;
}

export interface State {
  doc: Doc;
  past: Doc[];
  future: Doc[];
  sel: string[];
  selPort: PortRef | null;
  tool: Tool;
  snap: boolean;
  ortho: boolean;
  grid: number;
  showGrid: boolean;
  pan: Vec;
  zoom: number;
  wireStyle: WireStyle;
  highlight: { wires: Set<string>; keys: Set<string> } | null;
  fileName: string;

  /** apply a change with undo history */
  commit: (fn: (d: Doc) => void) => void;
  /** replace the doc without history (live dragging) */
  setLive: (doc: Doc) => void;
  /** push a snapshot taken before a live edit */
  pushHistory: (before: Doc) => void;
  undo: () => void;
  redo: () => void;
  set: (p: Partial<State>) => void;
  select: (ids: string[], port?: PortRef | null) => void;
  loadDoc: (doc: Doc, name?: string) => void;
}

const LS_DOC = 'schematizer.doc';
const LS_SETTINGS = 'schematizer.settings';

function loadInitial(): Partial<State> {
  const out: Partial<State> = {};
  try {
    const d = localStorage.getItem(LS_DOC);
    if (d) out.doc = JSON.parse(d);
  } catch {
    /* ignore */
  }
  try {
    const s = localStorage.getItem(LS_SETTINGS);
    if (s) {
      const j = JSON.parse(s);
      for (const k of ['snap', 'ortho', 'grid', 'showGrid', 'wireStyle', 'fileName'] as const) if (j[k] !== undefined) (out as any)[k] = j[k];
    }
  } catch {
    /* ignore */
  }
  return out;
}

const MAX_HISTORY = 200;

export const useStore = create<State>((set, get) => ({
  doc: emptyDoc(),
  past: [],
  future: [],
  sel: [],
  selPort: null,
  tool: 'select',
  snap: true,
  ortho: true,
  grid: 10,
  showGrid: true,
  pan: { x: 0, y: 0 },
  zoom: 1,
  wireStyle: { ...defaultWireStyle },
  highlight: null,
  fileName: 'untitled',
  ...loadInitial(),

  commit: (fn) => {
    const before = get().doc;
    const after = produce(before, fn);
    if (after === before) return;
    set({ doc: after, past: [...get().past.slice(-MAX_HISTORY), before], future: [] });
  },
  setLive: (doc) => set({ doc }),
  pushHistory: (before) => {
    if (before === get().doc) return;
    set({ past: [...get().past.slice(-MAX_HISTORY), before], future: [] });
  },
  undo: () => {
    const { past, doc, future } = get();
    if (!past.length) return;
    set({ doc: past[past.length - 1], past: past.slice(0, -1), future: [doc, ...future], sel: [], selPort: null, highlight: null });
  },
  redo: () => {
    const { past, doc, future } = get();
    if (!future.length) return;
    set({ doc: future[0], future: future.slice(1), past: [...past, doc], sel: [], selPort: null, highlight: null });
  },
  set: (p) => set(p),
  select: (ids, port = null) => set({ sel: ids, selPort: port, highlight: null }),
  loadDoc: (doc, name) => set({ doc, past: [], future: [], sel: [], selPort: null, highlight: null, ...(name ? { fileName: name } : {}) }),
}));

// autosave
let saveTimer: number | undefined;
let warned = false;
useStore.subscribe((s, prev) => {
  if (s.doc !== prev.doc) {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(LS_DOC, JSON.stringify(useStore.getState().doc));
      } catch {
        if (!warned) {
          warned = true;
          console.warn('Autosave failed (browser storage full). Use Save to keep your work.');
        }
      }
    }, 400);
  }
  if (s.snap !== prev.snap || s.ortho !== prev.ortho || s.grid !== prev.grid || s.showGrid !== prev.showGrid || s.wireStyle !== prev.wireStyle || s.fileName !== prev.fileName) {
    try {
      const { snap, ortho, grid, showGrid, wireStyle, fileName } = s;
      localStorage.setItem(LS_SETTINGS, JSON.stringify({ snap, ortho, grid, showGrid, wireStyle, fileName }));
    } catch {
      /* ignore */
    }
  }
});
