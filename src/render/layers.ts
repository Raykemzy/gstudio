import type { TShirtParams } from '../model/schema';
import { toModel, type Panel, type PanelFrame } from '../model/style';
import { buildOutline, neckCurve, offsetNeck, sidePoints, type NeckSurface } from '../geometry/outline';
import type { Vec } from '../geometry/polygon';
import { garmentPaths, viewSign } from './paths';

/**
 * The dressed garment as an ordered list of drawable layers (bottom first), in VIEW
 * coordinates. One description feeds every renderer: the SVG editor, image export
 * and the 3D preview's textures, so they always match.
 */

export interface Layer {
  kind: 'body' | 'sleeve' | 'panel' | 'rib' | 'seam' | 'hidden' | 'outline';
  d: string;
  fill?: string;
  stroke?: string;
  /** Stroke weight relative to the outline (1). */
  weight?: number;
  dashed?: boolean;
  /** Clip to the garment outline. */
  clipped: boolean;
  /** With `clipped`: clip to the body only (outline minus the sleeves). */
  bodyOnly?: boolean;
  /** For panels: which panel this is, and whether it's the mirrored copy. */
  panelId?: string;
  mirrorCopy?: boolean;
}

export interface FlatView {
  layers: Layer[];
  /** The garment outline, used as the clip path. */
  clip: string;
  /** The body without sleeves, for panels that stay off the sleeves. */
  bodyClip: string;
  bounds: ReturnType<typeof garmentPaths>['bounds'];
}

export const OUTLINE_INK = '#1f2430';

const f = (n: number) => (Math.round(n * 100) / 100).toString();
const pt = (v: Vec, s: number) => `${f(v.x * s)} ${f(v.y)}`;

function linePath(points: Vec[], surface: NeckSurface, closed: boolean): string {
  const s = viewSign(surface);
  return points.map((p, i) => `${i ? 'L' : 'M'}${pt(p, s)}`).join(' ') + (closed ? ' Z' : '');
}

/** Smooth closed curve through every point (Catmull-Rom converted to cubic Béziers). */
function smoothClosedPath(points: Vec[], surface: NeckSurface): string {
  const s = viewSign(surface);
  const n = points.length;
  const at = (i: number) => points[(i + n) % n];
  let d = `M${pt(points[0], s)}`;
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C${pt(c1, s)} ${pt(c2, s)} ${pt(p2, s)}`;
  }
  return d + ' Z';
}

export function panelFrame(p: TShirtParams): PanelFrame {
  return { leftHalf: p.left.chestHalf, rightHalf: p.right.chestHalf, length: p.core.bodyLength };
}

/** A panel's points in the model frame; the mirror copy flips across the centre line. */
export function panelModelPoints(panel: Panel, frame: PanelFrame, mirrorCopy = false): Vec[] {
  return panel.points.map(([u, v]) => toModel([mirrorCopy ? -u : u, v], frame));
}

export function panelPath(panel: Panel, frame: PanelFrame, surface: NeckSurface, mirrorCopy = false): string {
  const pts = panelModelPoints(panel, frame, mirrorCopy);
  return panel.curved ? smoothClosedPath(pts, surface) : linePath(pts, surface, true);
}

function seamInk(bodyColor: string): string {
  const n = parseInt(bodyColor.slice(1), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum < 0.45 ? 'rgba(232,234,238,0.55)' : 'rgba(31,36,48,0.6)';
}

export function flatView(p: TShirtParams, surface: NeckSurface): FlatView {
  const style = p.style;
  const g = garmentPaths(p, surface);
  const o = buildOutline(p, surface);
  const seam = seamInk(style.body.color);
  const layers: Layer[] = [{ kind: 'body', d: g.outline, fill: style.body.color, clipped: false }];

  // Sleeves: from the shoulder point out to the cuff and back to the armpit.
  const armholes: Vec[][] = [];
  for (const side of ['left', 'right'] as const) {
    const sp = sidePoints(p, side);
    if (p[side].sleeveLength > 0.5) {
      layers.push({ kind: 'sleeve', d: linePath([sp.shoulder, sp.sleeveTop, sp.sleeveBottom, sp.underarm], surface, true), fill: style.sleeves.color, clipped: true });
    }
    armholes.push([sp.shoulder, sp.underarm]);
  }

  const frame = panelFrame(p);
  const panelEdges: Layer[] = [];
  for (const panel of style.panels) {
    if (panel.surface !== surface) continue;
    for (const mirrorCopy of panel.mirrored ? [false, true] : [false]) {
      const d = panelPath(panel, frame, surface, mirrorCopy);
      const bodyOnly = panel.area === 'body';
      layers.push({ kind: 'panel', d, fill: panel.fill.color, clipped: true, bodyOnly, panelId: panel.id, mirrorCopy });
      if (panel.seam) panelEdges.push({ kind: 'seam', d, stroke: seam, weight: 0.5, clipped: true, bodyOnly, panelId: panel.id, mirrorCopy });
    }
  }

  if (p.core.collarWidth > 0) {
    const inner = offsetNeck(o.neck, p.core.collarWidth);
    layers.push({ kind: 'rib', d: linePath([...o.neck, ...inner.reverse()], surface, true), fill: style.rib.color, stroke: seam, weight: 0.4, clipped: true });
  }
  for (const a of armholes) layers.push({ kind: 'seam', d: linePath(a, surface, false), stroke: seam, weight: 0.5, clipped: true });
  layers.push(...panelEdges);
  // The back neckline seen through the front opening sits over the background, so it is always dark.
  if (surface === 'front') layers.push({ kind: 'hidden', d: linePath(neckCurve(p, 'back'), surface, false), stroke: 'rgba(31,36,48,0.6)', weight: 0.5, dashed: true, clipped: false });
  layers.push({ kind: 'outline', d: g.outline, stroke: OUTLINE_INK, weight: 1, clipped: false });

  // Body only: the outline with the four sleeve corners removed, so it runs shoulder point -> armpit.
  const sleevePts = (['left', 'right'] as const).flatMap((side) => (p[side].sleeveLength > 0.5 ? [o.sides[side].sleeveTop, o.sides[side].sleeveBottom] : []));
  const bodyPoly = o.polygon.filter((v) => !sleevePts.some((q) => Math.abs(q.x - v.x) < 1e-9 && Math.abs(q.y - v.y) < 1e-9));
  return { layers, clip: g.outline, bodyClip: linePath(bodyPoly, surface, true), bounds: g.bounds };
}
