import type { TShirtParams } from '../model/schema';
import { buildOutline, neckCurve, offsetNeck, type NeckSurface } from '../geometry/outline';
import { bounds, type Vec } from '../geometry/polygon';

/**
 * SVG path data for a garment view, shared by the interactive editor and image
 * export so an exported image always matches what's on screen.
 * The back view is the model mirrored horizontally (we're looking at it from behind).
 */

export const viewSign = (surface: NeckSurface) => (surface === 'front' ? 1 : -1);
export const toView = (v: Vec, surface: NeckSurface): Vec => ({ x: v.x * viewSign(surface), y: v.y });

const f = (n: number) => (Math.round(n * 100) / 100).toString();
function pathOf(points: Vec[], surface: NeckSurface, closed: boolean): string {
  return points.map((p, i) => `${i ? 'L' : 'M'}${f(p.x * viewSign(surface))} ${f(p.y)}`).join(' ') + (closed ? ' Z' : '');
}

export interface GarmentPaths {
  outline: string;
  collar: string | null;
  /** The other side's neckline, shown dashed in the front view (the back neck is visible through the opening). */
  otherNeck: string | null;
  bounds: ReturnType<typeof bounds>;
}

export function garmentPaths(p: TShirtParams, surface: NeckSurface): GarmentPaths {
  const o = buildOutline(p, surface);
  let collar: string | null = null;
  if (p.core.collarWidth > 0) {
    const inner = offsetNeck(o.neck, p.core.collarWidth);
    collar = pathOf([...o.neck, ...inner.reverse()], surface, true);
  }
  const otherNeck = surface === 'front' ? pathOf(neckCurve(p, 'back'), surface, false) : null;
  const viewPts = o.polygon.map((v) => toView(v, surface));
  return { outline: pathOf(o.polygon, surface, true), collar, otherNeck, bounds: bounds(viewPts) };
}

/** Key measurements in plain language, for labels and export captions. */
export function measurementSummary(p: TShirtParams): string[] {
  const w = (k: 'chestHalf' | 'hemHalf' | 'shoulderHalf') => f(p.left[k] + p.right[k]);
  const sym = (k: keyof TShirtParams['left'], unit = 'cm') =>
    p.left[k] === p.right[k] ? `${f(p.left[k])} ${unit}` : `L ${f(p.left[k])} / R ${f(p.right[k])} ${unit}`;
  return [
    `Body length ${f(p.core.bodyLength)} cm · chest ${w('chestHalf')} cm · hem ${w('hemHalf')} cm · shoulders ${w('shoulderHalf')} cm`,
    `Sleeve length ${sym('sleeveLength')} · opening ${sym('sleeveOpening')} · shoulder slope ${sym('shoulderDrop')}`,
    `Neck ${p.core.neckStyle}, ${f(p.core.neckWidth)} cm wide, ${f(p.core.neckDepthFront)} cm deep (back ${f(p.core.neckDepthBack)} cm) · side hem ${sym('hemOffset')}`,
  ];
}
