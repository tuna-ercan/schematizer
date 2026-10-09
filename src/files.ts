import { useStore } from './store';
import { downloadBlob, parseProject } from './io';
import { emptyDoc, type Doc } from './types';
import { zoomToFit } from './actions';

/**
 * Project files. Where the browser supports the File System Access API (Chrome, Edge),
 * Save overwrites the file that was opened or saved before, like a desktop app.
 * Elsewhere it falls back to downloading a copy.
 */

const w = window as any;
export const fileApiSupported = typeof w.showSaveFilePicker === 'function' && typeof w.showOpenFilePicker === 'function';

const pickerTypes = [{ description: 'Schematizer drawing', accept: { 'application/json': ['.json'] } }];

let handle: any = null;

const baseName = (n: string) => n.replace(/\.schematizer\.json$|\.json$/i, '');

export function serialize(doc: Doc) {
  return JSON.stringify({ app: 'schematizer', version: 1, doc }, null, 1);
}

// ---------------------------------------------------------------- remember the file across reloads
function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open('schematizer', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function storeHandle(h: any) {
  try {
    const d = await db();
    const tx = d.transaction('kv', 'readwrite');
    if (h) tx.objectStore('kv').put(h, 'fileHandle');
    else tx.objectStore('kv').delete('fileHandle');
  } catch {
    /* not essential */
  }
}

export async function restoreFileHandle() {
  if (!fileApiSupported) return;
  try {
    const d = await db();
    const h = await new Promise<any>((res) => {
      const r = d.transaction('kv').objectStore('kv').get('fileHandle');
      r.onsuccess = () => res(r.result ?? null);
      r.onerror = () => res(null);
    });
    if (h) {
      handle = h;
      useStore.getState().set({ linkedFile: h.name });
    }
  } catch {
    /* ignore */
  }
}

async function writable(h: any): Promise<boolean> {
  const opts = { mode: 'readwrite' };
  if ((await h.queryPermission?.(opts)) === 'granted') return true;
  return (await h.requestPermission?.(opts)) === 'granted';
}

// ---------------------------------------------------------------- commands
export async function saveFile(saveAs = false) {
  const s = useStore.getState();
  const doc = s.doc;
  const data = serialize(doc);
  const markSaved = (name?: string) => {
    const st = useStore.getState();
    st.set({ ...(st.doc === doc ? { dirty: false } : {}), ...(name ? { fileName: baseName(name), linkedFile: name } : {}) });
  };
  if (!fileApiSupported) {
    downloadBlob(new Blob([data], { type: 'application/json' }), `${s.fileName || 'untitled'}.schematizer.json`);
    markSaved();
    return;
  }
  try {
    if (!handle || saveAs) {
      handle = await w.showSaveFilePicker({ suggestedName: `${s.fileName || 'untitled'}.schematizer.json`, types: pickerTypes });
      await storeHandle(handle);
    }
    if (!(await writable(handle))) return;
    const out = await handle.createWritable();
    await out.write(data);
    await out.close();
    markSaved(handle.name);
  } catch (e: any) {
    if (e?.name === 'AbortError') return;
    alert(`Could not save: ${e?.message ?? e}`);
  }
}

function loadText(text: string, name: string, h: any) {
  const doc = parseProject(text);
  const s = useStore.getState();
  s.loadDoc(doc, baseName(name));
  s.set({ dirty: false, linkedFile: h ? name : null });
  setTimeout(zoomToFit);
}

/** Open a project. Returns false if the caller should fall back to a plain file input. */
export async function openFile(): Promise<boolean> {
  if (!fileApiSupported) return false;
  if (useStore.getState().dirty && !confirm('Open another drawing? Unsaved changes will be lost.')) return true;
  try {
    const [h] = await w.showOpenFilePicker({ types: pickerTypes, multiple: false });
    const file = await h.getFile();
    loadText(await file.text(), file.name, h);
    handle = h;
    await storeHandle(h);
  } catch (e: any) {
    if (e?.name !== 'AbortError') alert(`Could not open file: ${e?.message ?? e}`);
  }
  return true;
}

/** Fallback for browsers without the File System Access API. */
export async function openFromInput(file: File) {
  try {
    loadText(await file.text(), file.name, null);
    handle = null;
    await storeHandle(null);
  } catch (e: any) {
    alert(`Could not open file: ${e?.message ?? e}`);
  }
}

export function newFile() {
  if (useStore.getState().dirty && !confirm('Start a new drawing? Unsaved changes will be lost.')) return;
  const s = useStore.getState();
  s.loadDoc(emptyDoc(), 'untitled');
  s.set({ dirty: false, linkedFile: null });
  handle = null;
  storeHandle(null);
}
