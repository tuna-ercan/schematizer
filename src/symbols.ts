import type { Obj, Shape, Vec } from './types';
import { defaultPortLabelOffset, newObj, newShape, uid } from './model';

export interface LibSymbol {
  id: string;
  name: string;
  builtin?: boolean;
  obj: Obj;
}

const line = (pts: [number, number][], p: Partial<Shape> = {}) =>
  newShape('poly', { points: pts.map(([x, y]) => ({ x, y })), fill: 'none', ...p });
const poly = (pts: [number, number][], p: Partial<Shape> = {}) =>
  newShape('poly', { points: pts.map(([x, y]) => ({ x, y })), closed: true, fill: '#1f2937', ...p });

function sym(
  name: string,
  w: number,
  h: number,
  shapes: Shape[],
  ports: { name: string; x: number; y: number; net?: string }[],
  opts: Partial<Obj> = {},
  showPortLabels = false,
): LibSymbol {
  const o = newObj({ w, h, label: opts.label ?? '', ...opts });
  o.shapes = shapes;
  o.ports = ports.map((p) => {
    const port = { id: uid('p'), name: p.name, number: '', net: p.net ?? '', x: p.x, y: p.y, showLabel: showPortLabels, labelOffset: { x: 0, y: 0 } };
    port.labelOffset = defaultPortLabelOffset(o, port);
    return port;
  });
  return { id: `builtin-${name}`, name, builtin: true, obj: o };
}

function arcPts(cx: number, cy: number, r: number, from: number, to: number, n = 10): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = from + ((to - from) * i) / n;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

export function builtinSymbols(): LibSymbol[] {
  const inductor: [number, number][] = [[0, 15], [15, 15]];
  for (let i = 0; i < 4; i++) inductor.push(...arcPts(21.25 + i * 12.5, 15, 6.25, Math.PI, 2 * Math.PI).slice(1));
  inductor.push([80, 15]);

  return [
    sym('Block', 120, 60, [newShape('rect', { w: 120, h: 60, radius: 6, text: 'Block' })], [], { label: '' }),
    sym(
      'Resistor',
      80,
      20,
      [line([[0, 10], [20, 10], [23.3, 3], [30, 17], [36.7, 3], [43.3, 17], [50, 3], [56.7, 17], [60, 10], [80, 10]])],
      [{ name: '1', x: 0, y: 10 }, { name: '2', x: 80, y: 10 }],
      { label: 'R1', labelOffset: { x: 0, y: -18 } },
    ),
    sym(
      'Capacitor',
      60,
      40,
      [line([[0, 20], [26, 20]]), line([[26, 6], [26, 34]], { strokeWidth: 3 }), line([[34, 6], [34, 34]], { strokeWidth: 3 }), line([[34, 20], [60, 20]])],
      [{ name: '1', x: 0, y: 20 }, { name: '2', x: 60, y: 20 }],
      { label: 'C1', labelOffset: { x: 0, y: -30 } },
    ),
    sym('Inductor', 80, 20, [line(inductor)], [{ name: '1', x: 0, y: 15 }, { name: '2', x: 80, y: 15 }], { label: 'L1', labelOffset: { x: 0, y: -18 } }),
    sym(
      'Diode',
      60,
      30,
      [line([[0, 15], [20, 15]]), poly([[20, 4], [20, 26], [38, 15]]), line([[38, 4], [38, 26]]), line([[38, 15], [60, 15]])],
      [{ name: 'A', x: 0, y: 15 }, { name: 'K', x: 60, y: 15 }],
      { label: 'D1', labelOffset: { x: 0, y: -24 } },
    ),
    sym(
      'LED',
      60,
      40,
      [
        line([[0, 25], [20, 25]]),
        poly([[20, 14], [20, 36], [38, 25]]),
        line([[38, 14], [38, 36]]),
        line([[38, 25], [60, 25]]),
        line([[28, 10], [36, 2]], { strokeWidth: 1.5 }),
        poly([[36, 2], [31, 3], [35, 7]], { strokeWidth: 1 }),
        line([[36, 12], [44, 4]], { strokeWidth: 1.5 }),
        poly([[44, 4], [39, 5], [43, 9]], { strokeWidth: 1 }),
      ],
      [{ name: 'A', x: 0, y: 25 }, { name: 'K', x: 60, y: 25 }],
      { label: 'LED1', labelOffset: { x: 0, y: 32 } },
    ),
    sym(
      'Battery',
      60,
      40,
      [line([[0, 20], [24, 20]]), line([[24, 4], [24, 36]]), line([[34, 12], [34, 28]], { strokeWidth: 4 }), line([[34, 20], [60, 20]])],
      [{ name: '+', x: 0, y: 20 }, { name: '-', x: 60, y: 20 }],
      { label: 'BAT1', labelOffset: { x: 0, y: -30 } },
      true,
    ),
    sym(
      'Switch',
      80,
      30,
      [
        line([[0, 20], [24, 20]]),
        newShape('ellipse', { x: 23, y: 17, w: 6, h: 6, fill: '#fff', strokeWidth: 1.5 }),
        line([[28, 18], [54, 6]]),
        newShape('ellipse', { x: 51, y: 17, w: 6, h: 6, fill: '#fff', strokeWidth: 1.5 }),
        line([[56, 20], [80, 20]]),
      ],
      [{ name: '1', x: 0, y: 20 }, { name: '2', x: 80, y: 20 }],
      { label: 'SW1', labelOffset: { x: 0, y: 26 } },
    ),
    sym(
      'Ground',
      30,
      30,
      [line([[15, 0], [15, 14]]), line([[3, 14], [27, 14]]), line([[8, 20], [22, 20]]), line([[12, 26], [18, 26]])],
      [{ name: '', x: 15, y: 0, net: 'GND' }],
      { label: '' },
    ),
    sym('VCC', 30, 30, [line([[15, 30], [15, 12]]), line([[5, 12], [25, 12]])], [{ name: '', x: 15, y: 30, net: 'VCC' }], { label: 'VCC', labelOffset: { x: 0, y: -12 } }),
    sym(
      'NPN',
      60,
      60,
      [
        newShape('ellipse', { x: 10, y: 5, w: 50, h: 50, fill: 'none', strokeWidth: 1.5 }),
        line([[0, 30], [25, 30]]),
        line([[25, 16], [25, 44]], { strokeWidth: 3 }),
        line([[25, 24], [45, 10], [45, 0]]),
        line([[25, 36], [45, 50], [45, 60]]),
        poly([[45, 50], [36, 49], [40, 43]]),
      ],
      [{ name: 'B', x: 0, y: 30 }, { name: 'C', x: 45, y: 0 }, { name: 'E', x: 45, y: 60 }],
      { label: 'Q1', labelOffset: { x: 40, y: 0 } },
    ),
    sym(
      'Op-Amp',
      80,
      80,
      [
        poly([[10, 0], [10, 80], [70, 40]], { fill: '#ffffff' }),
        line([[0, 20], [10, 20]]),
        line([[0, 60], [10, 60]]),
        line([[70, 40], [80, 40]]),
        newShape('text', { x: 12, y: 12, w: 14, h: 16, text: '−', fontSize: 16, stroke: 'none' }),
        newShape('text', { x: 12, y: 52, w: 14, h: 16, text: '+', fontSize: 16, stroke: 'none' }),
      ],
      [{ name: '-', x: 0, y: 20 }, { name: '+', x: 0, y: 60 }, { name: 'OUT', x: 80, y: 40 }],
      { label: 'U1', labelOffset: { x: 0, y: 52 } },
    ),
    sym(
      'IC (8 pin)',
      80,
      100,
      [newShape('rect', { w: 80, h: 100, radius: 2 })],
      [
        ...[0, 1, 2, 3].map((i) => ({ name: `P${i + 1}`, x: 0, y: 20 + i * 20 })),
        ...[0, 1, 2, 3].map((i) => ({ name: `P${8 - i}`, x: 80, y: 20 + i * 20 })),
      ],
      { label: 'U1', labelOffset: { x: 0, y: 66 } },
      true,
    ),
  ];
}

const LS_LIB = 'schematizer.library';

export function loadUserSymbols(): LibSymbol[] {
  try {
    return JSON.parse(localStorage.getItem(LS_LIB) || '[]');
  } catch {
    return [];
  }
}

export function saveUserSymbols(list: LibSymbol[]) {
  try {
    localStorage.setItem(LS_LIB, JSON.stringify(list));
  } catch {
    alert('Could not save the library (browser storage is full).');
  }
}

/** Fresh copy of a symbol's object, positioned with its top-left at `at`. */
export function instantiate(s: LibSymbol, at: Vec): Obj {
  const o: Obj = JSON.parse(JSON.stringify(s.obj));
  o.id = uid('o');
  o.x = at.x;
  o.y = at.y;
  o.shapes.forEach((sh) => (sh.id = uid('s')));
  o.ports.forEach((p) => (p.id = uid('p')));
  return o;
}
