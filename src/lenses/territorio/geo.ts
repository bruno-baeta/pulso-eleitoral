/** Território · IBGE municipal mesh (quantized, delta-encoded) projected as X = lon·cos15°, Y = −lat. */
export interface Mesh { q: number; f: { c: string; r: number[][] }[] }
export interface Mun { cdi: string; path: Path2D; X: number; Y: number; bb: [number, number, number, number] }
export type BBox = [number, number, number, number];

const COS = Math.cos(15 * Math.PI / 180);
const box = (): BBox => [Infinity, Infinity, -Infinity, -Infinity];
export const grow = (b: number[], o: number[]) => { b[0] = Math.min(b[0], o[0]); b[1] = Math.min(b[1], o[1]); b[2] = Math.max(b[2], o[2]); b[3] = Math.max(b[3], o[3]); };

/**
 * Each point comes back projected and with the key of the quantized pair it came from. Deriving
 * outlines means matching a few hundred thousand shared vertices, and comparing them as formatted
 * floats cost more than everything else in this file put together; the mesh is quantized integers
 * well inside +-131072, so a pair packs into one exact number and matching becomes integer work.
 */
const OFF = 131072, SPAN = 262144;
type Pt = [number, number, number];   // x, y, vertex key
function decode(mesh: Mesh, fn: (code: string, rings: Pt[][]) => void) {
  for (const f of mesh.f) {
    fn(f.c, f.r.map(enc => {
      const pts: Pt[] = []; let x = 0, y = 0;
      for (let i = 0; i < enc.length; i += 2) {
        x += enc[i]; y += enc[i + 1];
        pts.push([(x / mesh.q) * COS, -(y / mesh.q), (x + OFF) * SPAN + (y + OFF)]);
      }
      return pts;
    }));
  }
}

export interface Geography {
  muns: Map<string, Mun>; list: Mun[];
  borders: Path2D; bbBR: BBox;
  /** Per state (IBGE id): outline, municipal borders and bounding box. */
  states: Map<string, { outline: Path2D; borders: Path2D; bb: BBox }>;
  country: Path2D;
}

/** x1, y1, x2, y2, key of the first vertex, key of the second. */
type Edge = [number, number, number, number, number, number];
/** Undirected edge table: outer map keyed by the lower vertex, inner by the higher. */
type Edges = Map<number, Map<number, Edge | null>>;
const eachEdge = function* (t: Edges) { for (const inner of t.values()) for (const e of inner.values()) yield e; };

/**
 * Outlines derived from the municipal mesh itself: an edge shared by two municipalities is internal, and an
 * edge that appears once is a boundary. Chaining those gives a state (or country) outline whose every vertex
 * is also a vertex of the painted municipalities, so the white stroke lands exactly on their edge — which a
 * separately simplified state mesh never does.
 */
function outlineFrom(edges: Edges): Path2D {
  // Boundary edges by vertex, then walked into rings.
  const at = new Map<number, Edge[]>();
  for (const e of eachEdge(edges)) {
    if (!e) continue;
    for (const key of [e[4], e[5]]) {
      const list = at.get(key); if (list) list.push(e); else at.set(key, [e]);
    }
  }
  const path = new Path2D();
  const used = new Set<Edge>();
  for (const start of eachEdge(edges)) {
    if (!start || used.has(start)) continue;
    used.add(start);
    path.moveTo(start[0], start[1]);
    path.lineTo(start[2], start[3]);
    let x = start[2], y = start[3], k = start[5];
    // Follow unused boundary edges from the current vertex until the ring closes (or the chain ends).
    for (let step = 0; step < 100000; step++) {
      const next = (at.get(k) || []).find(e => !used.has(e));
      if (!next) break;
      used.add(next);
      const sameStart = next[4] === k;
      x = sameStart ? next[2] : next[0]; y = sameStart ? next[3] : next[1]; k = sameStart ? next[5] : next[4];
      path.lineTo(x, y);
      if (k === start[4]) break;
    }
    path.closePath();
  }
  return path;
}

export function buildGeography(munMesh: Mesh): Geography {
  const muns = new Map<string, Mun>();
  const borders = new Path2D(), bbBR = box();
  const states = new Map<string, { outline: Path2D; borders: Path2D; bb: BBox }>();
  const state = (id: string) => { let s = states.get(id); if (!s) { s = { outline: new Path2D(), borders: new Path2D(), bb: box() }; states.set(id, s); } return s; };
  // Edge tables for the derived outlines: a second entry replaces the edge with null (shared = internal).
  const byState = new Map<string, Edges>();
  const national: Edges = new Map();
  const addEdge = (table: Edges, e: Edge) => {
    const lo = e[4] < e[5] ? e[4] : e[5], hi = e[4] < e[5] ? e[5] : e[4];
    let inner = table.get(lo); if (!inner) { inner = new Map(); table.set(lo, inner); }
    inner.set(hi, inner.has(hi) ? null : e);
  };
  decode(munMesh, (code, rings) => {
    const path = new Path2D(), bb = box();
    let best = 0, X = 0, Y = 0;
    for (const ring of rings) {
      let a = 0, cx = 0, cy = 0;
      ring.forEach((p, i) => {
        i ? path.lineTo(p[0], p[1]) : path.moveTo(p[0], p[1]);
        bb[0] = Math.min(bb[0], p[0]); bb[1] = Math.min(bb[1], p[1]); bb[2] = Math.max(bb[2], p[0]); bb[3] = Math.max(bb[3], p[1]);
        const q = ring[(i + 1) % ring.length], cr = p[0] * q[1] - q[0] * p[1];
        a += cr; cx += (p[0] + q[0]) * cr; cy += (p[1] + q[1]) * cr;
      });
      path.closePath();
      if (a !== 0 && Math.abs(a) > best) { best = Math.abs(a); X = cx / (3 * a); Y = cy / (3 * a); }
    }
    if (!best) { X = (bb[0] + bb[2]) / 2; Y = (bb[1] + bb[3]) / 2; }
    muns.set(code, { cdi: code, path, X, Y, bb });
    borders.addPath(path); grow(bbBR, bb);
    const id = code.slice(0, 2);
    const s = state(id); s.borders.addPath(path); grow(s.bb, bb);
    let table = byState.get(id); if (!table) { table = new Map(); byState.set(id, table); }
    for (const ring of rings) for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      if (p[2] === q[2]) continue;
      const e: Edge = [p[0], p[1], q[0], q[1], p[2], q[2]];
      addEdge(table, e); addEdge(national, e);
    }
  });
  for (const [id, table] of byState) state(id).outline = outlineFrom(table);
  return { muns, list: [...muns.values()], borders, bbBR, states, country: outlineFrom(national) };
}
