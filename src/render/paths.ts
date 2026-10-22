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
