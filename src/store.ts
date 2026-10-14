import { create } from 'zustand';
import { produce, setAutoFreeze } from 'immer';
import type { Doc, NodeStyle, StyleClip, Tool, Vec, WireStyle } from './types';
import { DEFAULT_NODE_STYLE, emptyDoc } from './types';
import { idbGet, idbSet } from './idb';
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
  showRulers: boolean;
  showGuides: boolean;
  pan: Vec;
  zoom: number;
  wireStyle: WireStyle;
  /** style for newly created nodes */
  nodeStyle: NodeStyle;
  /** draw nodes in SVG / PNG exports */
  exportNodes: boolean;
  /** new connections avoid only parts (not other wires / labels) */
  simpleRoute: boolean;
  highlight: { wires: Set<string>; keys: Set<string> } | null;
  /** style captured by "Copy style" */
  styleClip: StyleClip | null;
  fileName: string;
  /** unsaved changes since the last save / open */
  dirty: boolean;
  /** name of the file on disk that Save overwrites */
  linkedFile: string | null;
  /** set when the browser autosave could not be written */
  autosaveError: string | null;

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
    const s = localStorage.getItem(LS_SETTINGS);
    if (s) {
      const j = JSON.parse(s);
      for (const k of ['snap', 'ortho', 'grid', 'showGrid', 'showRulers', 'showGuides', 'wireStyle', 'nodeStyle', 'exportNodes', 'simpleRoute', 'fileName', 'dirty'] as const) if (j[k] !== undefined) (out as any)[k] = j[k];
      // the default node color changed from blue to green; keep custom defaults
      const ns = out.nodeStyle;
      if (ns && ns.outerColor === '#2563eb' && ns.innerColor === '#ffffff' && ns.outerRadius === 4 && ns.innerRadius === 2.5) out.nodeStyle = { ...DEFAULT_NODE_STYLE };
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
  showRulers: true,
  showGuides: true,
  pan: { x: 0, y: 0 },
  zoom: 1,
  wireStyle: { ...defaultWireStyle },
  nodeStyle: { ...DEFAULT_NODE_STYLE },
  exportNodes: true,
  simpleRoute: true,
  highlight: null,
  styleClip: null,
  fileName: 'untitled',
  dirty: false,
  linkedFile: null,
  autosaveError: null,
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

// ---------------------------------------------------------------- autosave (IndexedDB)
// The drawing used to be autosaved in localStorage, which only holds ~5 MB: larger drawings
// (embedded images) silently stopped saving, and a reload brought back an old version.

let restored = false; // no autosave until the saved drawing has been loaded back
let saveTimer: number | undefined;

let writing = 0; // autosave writes in progress

async function writeAutosave() {
  const doc = useStore.getState().doc;
  writing++;
  try {
    await idbSet('doc', doc);
    if (useStore.getState().autosaveError) useStore.setState({ autosaveError: null });
  } catch (e: any) {
    useStore.setState({ autosaveError: e?.message || 'browser storage is full' });
  } finally {
    writing--;
  }
}

let restoring: Promise<void> | null = null;

/** Load the autosaved drawing (once, at startup). */
export function restoreAutosave(): Promise<void> {
  restoring ??= doRestore();
  return restoring;
}

async function doRestore(): Promise<void> {
  const dirty = useStore.getState().dirty;
  try {
    let doc = await idbGet<Doc>('doc');
    if (!doc) {
      // move an old localStorage autosave over
      const legacy = localStorage.getItem(LS_DOC);
      if (legacy) doc = JSON.parse(legacy);
    }
    if (doc && typeof doc.objects === 'object' && Array.isArray(doc.order)) {
      doc.wires ??= {};
      doc.junctions ??= {};
      useStore.getState().loadDoc(doc);
      useStore.setState({ dirty });
    }
  } catch {
    /* start with an empty drawing */
  }
  restored = true;
  await writeAutosave();
  try {
    localStorage.removeItem(LS_DOC);
  } catch {
    /* ignore */
  }
}

// Reloading while a backup is still being written: start it now and ask the browser to wait
// ("Leave site?"), so a large drawing has time to finish saving.
window.addEventListener('beforeunload', (e) => {
  if (!restored) return;
  if (saveTimer !== undefined) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    writeAutosave();
  }
  if (writing > 0) {
    e.preventDefault();
    e.returnValue = '';
  }
});

useStore.subscribe((s, prev) => {
  if (s.doc !== prev.doc && restored) {
    if (!s.dirty) useStore.setState({ dirty: true });
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveTimer = undefined;
      writeAutosave();
    }, 120);
  }
  const keys = ['snap', 'ortho', 'grid', 'showGrid', 'showRulers', 'showGuides', 'wireStyle', 'nodeStyle', 'exportNodes', 'simpleRoute', 'fileName', 'dirty'] as const;
  if (keys.some((k) => s[k] !== prev[k])) {
    try {
      const out: Record<string, unknown> = {};
      for (const k of keys) out[k] = s[k];
      localStorage.setItem(LS_SETTINGS, JSON.stringify(out));
    } catch {
      /* ignore */
    }
  }
});
