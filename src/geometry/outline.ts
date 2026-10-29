import type { NeckStyle, Side, TShirtParams } from '../model/schema';
import { cubic, dedupe, roundCorner, vec, type Vec } from './polygon';

/**
 * Derives the flat garment outline from parameters. This is the single geometric
 * definition shared by the 2D editor, validation, export and the 3D preview.
 *
 * Coordinate frame ("model frame"): centimetres, origin on the centre line at the
 * height of the neck-side shoulder points, +y downward, +x toward the WEARER's left
 * (i.e. the garment seen from the front). The back view is drawn mirrored.
 */

export type NeckSurface = 'front' | 'back';

export interface SidePoints {
  neckSide: Vec;
  shoulder: Vec;
  sleeveTop: Vec;
  sleeveBottom: Vec;
  underarm: Vec;
  hemSide: Vec;
}

export interface Outline {
  /** Closed polygon, neck first (wearer's right to left), then down the left side, hem, up the right side. */
  polygon: Vec[];
  /** Neckline used by this outline, from x = -neckWidth/2 to +neckWidth/2. */
  neck: Vec[];
  sides: Record<Side, SidePoints>;
  hemCenter: Vec;
  neckCenter: Vec;
}

export const SIDE_SIGN: Record<Side, 1 | -1> = { left: 1, right: -1 };
const NECK_SAMPLES = 32;
const HEM_SAMPLES = 14;
/** How far the armpit curve reaches along each edge, cm. */
const ARMPIT_RADIUS = 2.5;

/** Depth of a neckline below the shoulder line at horizontal position x (0 outside the neck). */
export function neckDepthAt(style: NeckStyle, halfWidth: number, depth: number, x: number): number {
  const u = Math.min(1, Math.abs(x) / halfWidth);
  if (u >= 1) return 0;
  switch (style) {
    case 'crew':
      return depth * Math.sqrt(1 - u * u);
    case 'scoop':
      return depth * Math.pow(1 - Math.pow(u, 3.5), 1 / 3.5);
    case 'boat':
      return depth * (1 - u * u);
    case 'v':
      return depth * (1 - u);
    case 'square':
      return u <= 0.85 ? depth : (depth * (1 - u)) / 0.15;
  }
}

export function neckY(p: TShirtParams, surface: NeckSurface, x: number): number {
  const a = p.core.neckWidth / 2;
  return surface === 'front'
    ? neckDepthAt(p.core.neckStyle, a, p.core.neckDepthFront, x)
    : neckDepthAt('crew', a, p.core.neckDepthBack, x);
}

/** The neckline that bounds the garment's silhouette: whichever of front/back is higher at each x. */
export function outerNeckY(p: TShirtParams, x: number): number {
  return Math.min(neckY(p, 'front', x), neckY(p, 'back', x));
}

export function neckSampleXs(p: TShirtParams): number[] {
  const a = p.core.neckWidth / 2;
  const xs: number[] = [];
  for (let i = 0; i <= NECK_SAMPLES; i++) xs.push(-a * Math.cos((Math.PI * i) / NECK_SAMPLES));
  return xs;
}

export function neckCurve(p: TShirtParams, surface: NeckSurface | 'outer'): Vec[] {
  return neckSampleXs(p).map((x) => vec(x, surface === 'outer' ? outerNeckY(p, x) : neckY(p, surface, x)));
}

export function sidePoints(p: TShirtParams, side: Side): SidePoints {
  const s = SIDE_SIGN[side];
  const sp = p[side];
  const neckSide = vec((s * p.core.neckWidth) / 2, 0);
  const shoulder = vec(s * sp.shoulderHalf, sp.shoulderDrop);
  const ang = (sp.sleeveAngle * Math.PI) / 180;
  const dir = vec(s * Math.cos(ang), Math.sin(ang));
  const perp = vec(-s * Math.sin(ang), Math.cos(ang));
  const sleeveTop = vec(shoulder.x + dir.x * sp.sleeveLength, shoulder.y + dir.y * sp.sleeveLength);
  const sleeveBottom = vec(sleeveTop.x + perp.x * sp.sleeveOpening, sleeveTop.y + perp.y * sp.sleeveOpening);
  const underarm = vec(s * sp.chestHalf, sp.shoulderDrop + sp.armholeDepth);
  const hemSide = vec(s * sp.hemHalf, p.core.bodyLength + sp.hemOffset);
  return { neckSide, shoulder, sleeveTop, sleeveBottom, underarm, hemSide };
}

/** Hem from the centre point out to one side seam (excluding the centre point itself). */
function hemHalfCurve(p: TShirtParams, center: Vec, hemSide: Vec): Vec[] {
  if (p.core.hemStyle === 'straight') return [hemSide];
  const p1 = vec(hemSide.x * 0.5, center.y);
  const p2 = vec(hemSide.x * 0.85, hemSide.y);
  const pts: Vec[] = [];
  for (let i = 1; i <= HEM_SAMPLES; i++) pts.push(cubic(center, p1, p2, hemSide, i / HEM_SAMPLES));
  return pts;
}

export function buildOutline(p: TShirtParams, surface: NeckSurface | 'outer' = 'front'): Outline {
  const left = sidePoints(p, 'left');
  const right = sidePoints(p, 'right');
  const neck = neckCurve(p, surface);
  const hemCenter = vec(0, p.core.bodyLength);
  const hemLeft = hemHalfCurve(p, hemCenter, left.hemSide); // centre -> left side
  const hemRight = hemHalfCurve(p, hemCenter, right.hemSide); // centre -> right side

  const leftHemSide = hemLeft[hemLeft.length - 1];
  const rightHemSide = hemRight[hemRight.length - 1];
  // Real garments curve at the armpit where the sleeve meets the side seam.
  const armpit = (sleeveBottom: Vec, underarm: Vec, sideHem: Vec) => roundCorner(sleeveBottom, underarm, sideHem, ARMPIT_RADIUS);
  const polygon = dedupe([
    ...neck,
    left.shoulder,
    left.sleeveTop,
    left.sleeveBottom,
    ...armpit(left.sleeveBottom, left.underarm, leftHemSide),
    ...hemLeft.slice().reverse(), // left side seam hem -> towards centre
    hemCenter,
    ...hemRight,
    ...armpit(right.sleeveBottom, right.underarm, rightHemSide).reverse(),
    right.sleeveBottom,
    right.sleeveTop,
    right.shoulder,
  ]);
  const neckCenter = vec(0, surface === 'outer' ? outerNeckY(p, 0) : neckY(p, surface, 0));
  return { polygon, neck, sides: { left, right }, hemCenter, neckCenter };
}

/** The hem from the wearer's right side seam, through the centre, to the left side seam. */
export function hemLine(p: TShirtParams): Vec[] {
  const left = sidePoints(p, 'left');
  const right = sidePoints(p, 'right');
  const hemCenter = vec(0, p.core.bodyLength);
  return dedupe([right.hemSide, ...hemHalfCurve(p, hemCenter, right.hemSide).reverse().slice(1), hemCenter, ...hemHalfCurve(p, hemCenter, left.hemSide)]);
}

/**
 * The body without sleeves: shoulder point straight to the armpit (the armhole seam),
 * down the side seam, along the hem. Used for measurements and body-only clipping.
 */
export function buildBodyOutline(p: TShirtParams, surface: NeckSurface | 'outer' = 'front'): Vec[] {
  const left = sidePoints(p, 'left');
  const right = sidePoints(p, 'right');
  const hemCenter = vec(0, p.core.bodyLength);
  return dedupe([
    ...neckCurve(p, surface),
    left.shoulder,
    left.underarm,
    ...hemHalfCurve(p, hemCenter, left.hemSide).reverse(),
    hemCenter,
    ...hemHalfCurve(p, hemCenter, right.hemSide),
    right.underarm,
    right.shoulder,
  ]);
}

/** Offset a neckline into the garment body by `width` (used for the collar rib band). */
export function offsetNeck(neck: Vec[], width: number): Vec[] {
  return neck.map((pt, i) => {
    const a = neck[Math.max(0, i - 1)], b = neck[Math.min(neck.length - 1, i + 1)];
    const tx = b.x - a.x, ty = b.y - a.y;
    const l = Math.hypot(tx, ty) || 1;
    // Neck runs left-to-right on screen; rotating the tangent clockwise points down into the garment.
    return vec(pt.x - (ty / l) * width, pt.y + (tx / l) * width);
  });
}
