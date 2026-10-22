import Delaunator from 'delaunator';
import { garmentDef, type GarmentParams } from '../garments';
import type { NeckSurface } from './outline';
import { bounds, dist, signedArea, distToPolyline, pointInPolygon, resampleClosed, vec, type Vec } from './polygon';

/**
 * Simplified 3D preview geometry, derived from the SAME outline as the 2D editor.
 *
 * Method ("inflated flat-lay"): triangulate the flat silhouette, then push each
 * vertex out of the plane by an amount that grows with its distance from the
 * outline edge, capped at `maxDepth`. Narrow parts (sleeves) become round tubes,
 * wide parts (the body) get a flat front with rounded sides. The front and back
 * surfaces meet at the outline. The neck hole is cut out of whichever surface's
 * neckline is deeper.
 *
 * This conveys silhouette and proportion only: there is no body form, drape,
 * gravity or fabric behaviour, and garment depth is synthesised, not measured.
 */

export interface GarmentMesh {
  positions: Float32Array; // xyz per vertex, three.js frame (y up, +z toward viewer = garment front)
  colors: Float32Array; // rgb per vertex
  /** Texture coordinates: model (x, y) mapped into `uvBox`, the same for front and back. */
  uvs: Float32Array;
  uvBox: { minX: number; minY: number; width: number; height: number };
  /** Indices are front triangles first, then back: the first `frontIndexCount` belong to the front. */
  frontIndexCount: number;
  indices: Uint32Array;
  vertexCount: number;
  /** The silhouette (model frame), for the 3D seam line. */
  outline: Vec[];
  /** Rib lines lifted onto the inflated surfaces (xyz triples), drawn as tubes. */
  ribs: { front: number[]; back: number[]; radius: number };
}

export interface MeshOptions {
  spacing?: number; // triangulation density in cm
  maxDepth?: number; // cap on half-thickness in cm
}

/** Interior grid points per surface before the mesh is coarsened. */
const TARGET_INTERIOR_POINTS = 2600;

const BODY_RGB: [number, number, number] = [0.86, 0.87, 0.89];

function resampleOpen(pts: Vec[], step: number): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const n = Math.max(1, Math.ceil(dist(a, b) / step));
    for (let k = 0; k < n; k++) out.push(vec(a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n));
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export function inflate(d: number, maxDepth: number): number {
  const t = Math.min(d, maxDepth) / maxDepth;
  return maxDepth * Math.sqrt(1 - (1 - t) * (1 - t));
}

export function buildGarmentMesh(p: GarmentParams, opts: MeshOptions = {}): GarmentMesh {
  const spec = garmentDef(p).mesh(p);
  const maxDepth = opts.maxDepth ?? spec.maxDepth;
  const outer = spec.outer;
  // Keep the point count roughly constant: big garments get a slightly coarser mesh, so
  // rebuilds stay fast enough for smooth dragging. A regular tee keeps the 1.25 cm default.
  const h = opts.spacing ?? Math.max(1.25, Math.sqrt(Math.abs(signedArea(outer)) / TARGET_INTERIOR_POINTS));

  // Guide curves inside the silhouette become rows of vertices, so cut-outs follow the
  // curve instead of a jagged triangle edge.
  const guides = spec.guides
    .flatMap((row) => resampleOpen(row, h * 0.75))
    .filter((v) => pointInPolygon(v, outer) && distToPolyline(v, outer, true) > h * 0.2);

  const pts: Vec[] = [...resampleClosed(outer, h * 0.75), ...guides];
  const edgeDist: number[] = pts.map((v) => distToPolyline(v, outer, true));
  const b = bounds(outer);
  const gb = guides.length ? bounds(guides) : null;
  for (let y = b.minY + h / 2; y < b.maxY; y += h) {
    for (let x = b.minX + h / 2; x < b.maxX; x += h) {
      const q = vec(x, y);
      if (!pointInPolygon(q, outer)) continue;
      const d = distToPolyline(q, outer, true);
      if (d < h * 0.5) continue;
      if (gb && x > gb.minX - h && x < gb.maxX + h && y > gb.minY - h && y < gb.maxY + h && guides.some((g) => dist(g, q) < h * 0.5)) continue;
      pts.push(q);
      edgeDist.push(d);
    }
  }

  const tri = Delaunator.from(pts, (v) => v.x, (v) => v.y).triangles;
  const n = pts.length;
  const depth = edgeDist.map((d) => inflate(d, maxDepth));
  const inHole = (surface: NeckSurface, c: Vec) => spec.hole?.[surface]?.(c) ?? false;

  const positions = new Float32Array(n * 2 * 3);
  const colors = new Float32Array(n * 2 * 3);
  const uvBox = { minX: b.minX - 1, minY: b.minY - 1, width: b.width + 2, height: b.height + 2 };
  const uvs = new Float32Array(n * 2 * 2);
  for (let i = 0; i < n; i++) {
    const v = pts[i];
    positions.set([v.x, -v.y, depth[i]], i * 3);
    positions.set([v.x, -v.y, -depth[i]], (n + i) * 3);
    const uv = [(v.x - uvBox.minX) / uvBox.width, 1 - (v.y - uvBox.minY) / uvBox.height];
    uvs.set(uv, i * 2);
    uvs.set(uv, (n + i) * 2);
    colors.set(BODY_RGB, i * 3);
    colors.set(BODY_RGB, (n + i) * 3);
  }

  const idx: number[] = [];
  const backIdx: number[] = [];
  for (let t = 0; t < tri.length; t += 3) {
    let [a, bI, c] = [tri[t], tri[t + 1], tri[t + 2]];
    const A = pts[a], B = pts[bI], C = pts[c];
    const centroid = vec((A.x + B.x + C.x) / 3, (A.y + B.y + C.y) / 3);
    if (!pointInPolygon(centroid, outer)) continue;
    // In the y-down model frame a negative orientation is counter-clockwise once y is flipped.
    if ((B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x) > 0) [bI, c] = [c, bI];
    if (!inHole('front', centroid)) idx.push(a, bI, c);
    if (!inHole('back', centroid)) backIdx.push(n + a, n + c, n + bI);
  }

  const lift = (line: Vec[] | undefined, sign: number) =>
    line ? resampleOpen(line, h * 0.5).flatMap((v) => [v.x, -v.y, sign * inflate(distToPolyline(v, outer, true), maxDepth)]) : [];
  return {
    positions,
    colors,
    uvs,
    uvBox,
    frontIndexCount: idx.length,
    indices: Uint32Array.from([...idx, ...backIdx]),
    vertexCount: n * 2,
    outline: outer,
    ribs: { front: lift(spec.ribs?.front, 1), back: lift(spec.ribs?.back, -1), radius: spec.ribRadius ?? 0.5 },
  };
}
