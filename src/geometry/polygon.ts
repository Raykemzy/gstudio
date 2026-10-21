export interface Vec {
  x: number;
  y: number;
}

export const vec = (x: number, y: number): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec, s: number): Vec => ({ x: a.x * s, y: a.y * s });
export const len = (a: Vec): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

export function cubic(p0: Vec, p1: Vec, p2: Vec, p3: Vec, t: number): Vec {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

/** Drop consecutive points closer than eps (including the wrap-around pair). */
export function dedupe(points: Vec[], eps = 1e-6): Vec[] {
  const out: Vec[] = [];
  for (const p of points) if (!out.length || dist(out[out.length - 1], p) > eps) out.push(p);
  while (out.length > 1 && dist(out[0], out[out.length - 1]) <= eps) out.pop();
  return out;
}

/** Signed area; positive when the polygon winds clockwise in y-down screen space. */
export function signedArea(poly: Vec[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function pointInPolygon(p: Vec, poly: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function distToSegment(p: Vec, a: Vec, b: Vec): number {
  const abx = b.x - a.x, aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  let t = l2 ? ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
}

export function distToPolyline(p: Vec, pts: Vec[], closed: boolean): number {
  let d = Infinity;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) d = Math.min(d, distToSegment(p, pts[i], pts[(i + 1) % pts.length]));
  return d;
}

const orient = (a: Vec, b: Vec, c: Vec) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

function onSegment(a: Vec, b: Vec, p: Vec, eps: number): boolean {
  return (
    Math.min(a.x, b.x) - eps <= p.x && p.x <= Math.max(a.x, b.x) + eps &&
    Math.min(a.y, b.y) - eps <= p.y && p.y <= Math.max(a.y, b.y) + eps
  );
}

export function segmentsIntersect(a: Vec, b: Vec, c: Vec, d: Vec, eps = 1e-9): boolean {
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  if (((o1 > eps && o2 < -eps) || (o1 < -eps && o2 > eps)) && ((o3 > eps && o4 < -eps) || (o3 < -eps && o4 > eps))) return true;
  if (Math.abs(o1) <= eps && onSegment(a, b, c, eps)) return true;
  if (Math.abs(o2) <= eps && onSegment(a, b, d, eps)) return true;
  if (Math.abs(o3) <= eps && onSegment(c, d, a, eps)) return true;
  if (Math.abs(o4) <= eps && onSegment(c, d, b, eps)) return true;
  return false;
}

/** Returns the index pair of the first two non-adjacent crossing edges, or null if the polygon is simple. */
export function findSelfIntersection(poly: Vec[]): [number, number] | null {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // adjacent through the wrap-around
      if (segmentsIntersect(a, b, poly[j], poly[(j + 1) % n])) return [i, j];
    }
  }
  return null;
}

/** Resample a closed polygon so no edge is longer than `step`, keeping every original vertex. */
export function resampleClosed(poly: Vec[], step: number): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const n = Math.max(1, Math.ceil(dist(a, b) / step));
    for (let k = 0; k < n; k++) out.push(lerp(a, b, k / n));
  }
  return out;
}

export function bounds(points: Vec[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}
