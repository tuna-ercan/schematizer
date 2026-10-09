import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Doc } from './types';
import { Scene } from './Scene';
import { objBBox, pointsBBox, portWorld, unionRect } from './geometry';
import { wireFull } from './model';

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function parseProject(text: string): Doc {
  const j = JSON.parse(text);
  const doc = j.doc ?? j;
  if (!doc || typeof doc.objects !== 'object' || !Array.isArray(doc.order)) throw new Error('Not a Schematizer file');
  doc.wires ??= {};
  doc.junctions ??= {};
  return doc as Doc;
}

export function docBounds(doc: Doc) {
  const rs = [];
  for (const o of Object.values(doc.objects)) {
    rs.push(objBBox(o));
    // include labels roughly
    if (o.label && o.showLabel) {
      const b = objBBox(o);
      const cx = b.x + b.w / 2 + o.labelOffset.x, cy = b.y + b.h / 2 + o.labelOffset.y;
      const tw = o.label.length * 7.5;
      rs.push({ x: cx - tw / 2, y: cy - 10, w: tw, h: 20 });
    }
    for (const p of o.ports) {
      if (!p.showLabel) continue;
      const wp = portWorld(o, p);
      const tw = (p.name.length + p.net.length + 4) * 6;
      rs.push({ x: wp.x + p.labelOffset.x - tw, y: wp.y + p.labelOffset.y - 8, w: tw * 2, h: 16 });
    }
  }
  for (const w of Object.values(doc.wires)) rs.push(pointsBBox(wireFull(doc, w)));
  return unionRect(rs) ?? { x: 0, y: 0, w: 100, h: 100 };
}

export function exportSvgString(doc: Doc, nodes = true, background: string | null = '#ffffff', pad = 20): { svg: string; w: number; h: number } {
  const b = docBounds(doc);
  const x = Math.floor(b.x - pad), y = Math.floor(b.y - pad);
  const w = Math.ceil(b.w + pad * 2), h = Math.ceil(b.h + pad * 2);
  const inner = renderToStaticMarkup(React.createElement(Scene, { doc, interactive: false, nodes }));
  const bg = background ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${background}"/>` : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}">${bg}${inner}</svg>`;
  return { svg, w, h };
}

export function exportSvg(doc: Doc, name: string, nodes = true) {
  const { svg } = exportSvgString(doc, nodes);
  downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${name || 'untitled'}.svg`);
}

export async function exportPng(doc: Doc, name: string, nodes = true, scale = 2) {
  const { svg, w, h } = exportSvgString(doc, nodes);
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error('Could not render the drawing'));
    img.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0);
  URL.revokeObjectURL(url);
  canvas.toBlob((blob) => blob && downloadBlob(blob, `${name || 'untitled'}.png`), 'image/png');
}

export function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
}

export function imageSize(src: string): Promise<{ w: number; h: number }> {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res({ w: img.naturalWidth || 100, h: img.naturalHeight || 100 });
    img.onerror = () => res({ w: 100, h: 100 });
    img.src = src;
  });
}
