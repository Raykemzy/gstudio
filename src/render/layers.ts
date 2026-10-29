import type { GarmentParams } from '../garments';
import { garmentDef } from '../garments';
import type { FlatPart } from '../garments/types';
import { toModel, type Panel, type PanelFrame } from '../model/style';
import type { NeckSurface } from '../geometry/outline';
import { bounds, type Vec } from '../geometry/polygon';
import { toView, viewSign } from './paths';

/**
 * The dressed garment as an ordered list of drawable layers (bottom first), in VIEW
 * coordinates. One description feeds every renderer: the SVG editor, image export
 * and the 3D preview's textures, so they always match.
 */

export interface Layer {
  kind: 'body' | 'sleeve' | 'panel' | 'rib' | 'seam' | 'hidden' | 'fold' | 'outline';
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
  bounds: ReturnType<typeof bounds>;
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

export function panelFrame(p: GarmentParams): PanelFrame {
  return garmentDef(p).panelFrame(p);
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
  // Flat-sketch convention: construction lines are solid black like the outline; on dark
  // garments they turn light so they stay visible.
  return lum < 0.32 ? 'rgba(226,228,232,0.85)' : '#1f2430';
}

/** The body colour in shadow: what you see of the garment's inside through an opening. */
function shadeOf(color: string): string {
  const n = parseInt(color.slice(1), 16);
  return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(c * 0.82).toString(16).padStart(2, '0')).join('');
}

/** Fold lines: softer than seams so they read as fabric, not construction. */
function foldInk(bodyColor: string): string {
  const n = parseInt(bodyColor.slice(1), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum < 0.45 ? 'rgba(232,234,238,0.28)' : 'rgba(31,36,48,0.3)';
}

function partLayer(part: FlatPart, surface: NeckSurface, style: GarmentParams['style'], seam: string): Layer {
  const kind: Layer['kind'] = part.kind === 'detail' ? 'seam' : part.kind;
  return {
    kind,
    d: linePath(part.points, surface, part.closed),
    fill: part.fill ? (part.fill === 'shade' ? shadeOf(style.body.color) : style[part.fill].color) : undefined,
    // Hidden lines sit over the background, so they are always dark.
    stroke: part.stroke ? (part.kind === 'hidden' ? 'rgba(31,36,48,0.6)' : part.kind === 'fold' ? foldInk(style.body.color) : seam) : undefined,
    weight: part.weight,
    dashed: part.dashed,
    clipped: part.clip !== 'none',
    bodyOnly: part.clip === 'body',
  };
}

export function flatView(p: GarmentParams, surface: NeckSurface): FlatView {
  const style = p.style;
  const parts = garmentDef(p).flatParts(p, surface);
  const seam = seamInk(style.body.color);
  const outlinePath = linePath(parts.outline, surface, true);
  const layers: Layer[] = [{ kind: 'body', d: outlinePath, fill: style.body.color, clipped: false }];
  layers.push(...parts.under.map((part) => partLayer(part, surface, style, seam)));

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
  layers.push(...panelEdges);
  layers.push(...parts.over.filter((part) => style.folds || part.kind !== 'fold').map((part) => partLayer(part, surface, style, seam)));
  layers.push({ kind: 'outline', d: outlinePath, stroke: OUTLINE_INK, weight: 1, clipped: false });

  return { layers, clip: outlinePath, bodyClip: linePath(parts.body, surface, true), bounds: bounds(parts.outline.map((v) => toView(v, surface))) };
}
