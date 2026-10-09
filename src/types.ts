export type Vec = { x: number; y: number };
export type Rot = 0 | 90 | 180 | 270;
export type Dash = 'solid' | 'dashed' | 'dotted' | 'dashdot';
export type ShapeKind = 'rect' | 'ellipse' | 'image' | 'text' | 'poly';

/** A drawable piece of an object, in the object's local (unrotated) frame. */
export interface Shape {
  id: string;
  kind: ShapeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  rot: Rot;
  flipX: boolean;
  /** poly only: points in object-local coordinates */
  points?: Vec[];
  closed?: boolean;
  /** image only */
  src?: string;
  stroke: string;
  fill: string;
  strokeWidth: number;
  dash: Dash;
  radius: number;
  text: string;
  fontSize: number;
  textColor: string;
}

/** A named connection point ("node") of an object. */
export interface Port {
  id: string;
  name: string;
  number: string;
  /** net label: ports sharing the same net are connected without a wire */
  net: string;
  x: number;
  y: number;
  showLabel: boolean;
  /** label position relative to the port's world position */
  labelOffset: Vec;
}

export interface Obj {
  id: string;
  /** top-left of the unrotated local frame, in world coordinates */
  x: number;
  y: number;
  w: number;
  h: number;
  rot: Rot;
  flipX: boolean;
  label: string;
  showLabel: boolean;
  /** label position relative to the object's world center */
  labelOffset: Vec;
  shapes: Shape[];
  ports: Port[];
}

export type Endpoint =
  | { kind: 'port'; obj: string; port: string }
  | { kind: 'junction'; id: string };

export interface WireStyle {
  color: string;
  width: number;
  dash: Dash;
  radius: number;
  arrowA: boolean;
  arrowB: boolean;
}

export interface Wire extends WireStyle {
  id: string;
  a: Endpoint;
  b: Endpoint;
  /** corner points between the two endpoints, world coordinates */
  points: Vec[];
  ortho: boolean;
}

export interface Junction {
  id: string;
  x: number;
  y: number;
}

export interface Doc {
  objects: Record<string, Obj>;
  /** z-order of objects, bottom first */
  order: string[];
  wires: Record<string, Wire>;
  junctions: Record<string, Junction>;
  /** ruler guides: v = vertical guide x positions, h = horizontal guide y positions */
  guides?: { v: number[]; h: number[] };
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Tool = 'select' | 'node' | 'wire' | 'box' | 'line' | 'text';

export const emptyDoc = (): Doc => ({ objects: {}, order: [], wires: {}, junctions: {} });
