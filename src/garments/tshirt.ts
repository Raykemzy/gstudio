import { CORE_FIELDS, HALF_WIDTH_KEYS, SIDE_FIELDS, defaultParams, type TShirtParams } from '../model/schema';
import { validateParams } from '../model/validate';
import { pointsOfMeasure } from '../model/pom';
import { buildBodyOutline, buildOutline, hemLine, neckCurve, neckY, offsetNeck, sidePoints } from '../geometry/outline';
import { applyHandleDrag, getHandles } from '../geometry/handles';
import { dist, extendEnds, lerp, offsetPolyline, quadPoints, vec, type Vec } from '../geometry/polygon';
import type { FlatPart, GarmentDef, MeshSpec, Surface } from './types';

/** The T-shirt, wrapping the original tee modules behind the shared garment interface. */

const SIGN = { left: 1, right: -1 } as const;

/** The armhole seam: from the shoulder point, curving down and in to the armpit like a set-in sleeve. */
function armholeCurve(shoulder: Vec, underarm: Vec): Vec[] {
  const ctrl = vec(shoulder.x + (underarm.x - shoulder.x) * 0.15, shoulder.y + (underarm.y - shoulder.y) * 0.8);
  return [shoulder, ...quadPoints(shoulder, ctrl, underarm, 10)];
}

/** y of the hem at horizontal position x (hem points run right side -> left side). */
function hemYAt(hem: Vec[], x: number): number {
  for (let i = 0; i < hem.length - 1; i++) {
    const a = hem[i], b = hem[i + 1];
    if ((x >= a.x && x <= b.x) || (x <= a.x && x >= b.x)) return a.y + ((x - a.x) / (b.x - a.x || 1)) * (b.y - a.y);
  }
  return hem[x < 0 ? 0 : hem.length - 1].y;
}

const fold = (points: Vec[]): FlatPart => ({ kind: 'fold', points, closed: false, stroke: true, weight: 0.45, clip: 'all' });
const stitch = (points: Vec[], clip: FlatPart['clip'] = 'all'): FlatPart => ({ kind: 'detail', points, closed: false, stroke: true, weight: 0.35, dashed: true, clip });

function flatParts(p: TShirtParams, surface: Surface) {
  const o = buildOutline(p, surface);
  const under: FlatPart[] = [];
  const over: FlatPart[] = [];
  const cw = p.core.collarWidth;

  for (const side of ['left', 'right'] as const) {
    const s = SIGN[side];
    const sp = sidePoints(p, side);
    const armhole = armholeCurve(sp.shoulder, sp.underarm);
    const L = p[side];
    if (L.sleeveLength > 0.5) {
      // Sleeve: shoulder point out to the cuff, back to the armpit, then up the armhole seam.
      under.push({ kind: 'sleeve', points: [sp.shoulder, sp.sleeveTop, sp.sleeveBottom, ...armhole.slice().reverse()], closed: true, fill: 'sleeves', clip: 'all' });
    }
    if (p.style.armholeSeam) over.push({ kind: 'seam', points: armhole, closed: false, stroke: true, weight: 0.5, clip: 'all' });

    // Double-needle stitching across the sleeve hem, running between the sleeve's two edges.
    const topLen = dist(sp.shoulder, sp.sleeveTop), underLen = dist(sp.underarm, sp.sleeveBottom);
    if (L.sleeveLength > 4 && underLen > 3) {
      for (const d of [1.6, 2.2]) {
        over.push(stitch([lerp(sp.sleeveTop, sp.shoulder, Math.min(0.45, d / topLen)), lerp(sp.sleeveBottom, sp.underarm, Math.min(0.45, d / underLen))]));
      }
    }

    // Fold lines: drag lines from the armpit, and one soft fold in the sleeve.
    const ua = sp.underarm;
    over.push(fold([vec(ua.x - s * 1.2, ua.y + 2.5), ...quadPoints(vec(ua.x - s * 1.2, ua.y + 2.5), vec(ua.x - s * 2, ua.y + 7.5), vec(ua.x - s * 5.5, ua.y + 12), 8)]));
    over.push(fold([vec(ua.x - s * 0.8, ua.y + 7), ...quadPoints(vec(ua.x - s * 0.8, ua.y + 7), vec(ua.x - s * 1.6, ua.y + 11), vec(ua.x - s * 3.8, ua.y + 15), 8)]));
    if (L.sleeveLength > 10 && underLen > 6) {
      const dir = vec((sp.sleeveTop.x - sp.shoulder.x) / (topLen || 1), (sp.sleeveTop.y - sp.shoulder.y) / (topLen || 1));
      const at = (u: number, back: number) => vec(lerp(sp.sleeveBottom, sp.sleeveTop, u).x - dir.x * back, lerp(sp.sleeveBottom, sp.sleeveTop, u).y - dir.y * back);
      const a = at(0.18, Math.min(9, L.sleeveLength * 0.45)), c = at(0.3, Math.min(6, L.sleeveLength * 0.3)), b = at(0.5, Math.min(4, L.sleeveLength * 0.2));
      over.push(fold([a, ...quadPoints(a, c, b, 6)]));
    }
  }

  // Neck: the rib band with its knit texture and the stitching just below it.
  if (cw > 0) {
    const inner = offsetNeck(o.neck, cw);
    over.push({ kind: 'rib', points: [...o.neck, ...inner.slice().reverse()], closed: true, fill: 'rib', stroke: true, weight: 0.4, clip: 'all' });
    const ribLines = resampleOpenEven(o.neck, 0.9);
    const ribInner = offsetNeck(ribLines, cw);
    ribLines.forEach((v, i) => i > 0 && i < ribLines.length - 1 && over.push({ kind: 'detail', points: [v, ribInner[i]], closed: false, stroke: true, weight: 0.22, clip: 'all' }));
    over.push(stitch(offsetNeck(o.neck, cw + 0.45)));
  } else {
    over.push(stitch(offsetNeck(o.neck, 0.8)));
  }

  // Bottom hem: double-needle stitching following the hem's shape, kept off the sleeves.
  const hem = hemLine(p);
  for (const d of [1.8, 2.4]) over.push(stitch(extendEnds(offsetPolyline(hem, d), 4), 'body'));
  // Soft folds rising from the hem.
  for (const s of [1, -1]) {
    const x = s * (s > 0 ? p.left.hemHalf : p.right.hemHalf) * 0.5;
    const y = hemYAt(hem, x);
    over.push(fold([vec(x, y - 0.8), ...quadPoints(vec(x, y - 0.8), vec(x - s * 0.4, y - 4.5), vec(x - s * 1.6, y - 8), 6)]));
  }

  // The back neckline, seen through the front opening.
  if (surface === 'front') over.push({ kind: 'hidden', points: neckCurve(p, 'back'), closed: false, stroke: true, weight: 0.5, dashed: true, clip: 'none' });
  return { outline: o.polygon, body: buildBodyOutline(p, surface), under, over };
}

/** Points spaced evenly (about `step` cm apart) along an open polyline. */
function resampleOpenEven(pts: Vec[], step: number): Vec[] {
  const out: Vec[] = [pts[0]];
  let carry = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const l = dist(a, b);
    let t = step - carry;
    while (t <= l) {
      out.push(lerp(a, b, t / l));
      t += step;
    }
    carry = l - (t - step);
  }
  return out;
}

function mesh(p: TShirtParams): MeshSpec {
  const halfNeck = p.core.neckWidth / 2;
  const hole = (surface: Surface) => (c: Vec) => Math.abs(c.x) < halfNeck && c.y < neckY(p, surface, c.x) - 1e-6;
  return {
    outer: buildOutline(p, 'outer').polygon,
    maxDepth: Math.min(13, Math.max(6, (0.36 * (p.left.chestHalf + p.right.chestHalf)) / 2)),
    // Neckline curves inside the silhouette become rows of vertices so the cut-out follows the curve.
    guides: [neckCurve(p, 'front'), neckCurve(p, 'back')],
    hole: { front: hole('front'), back: hole('back') },
    ribs: p.core.collarWidth > 0 ? { front: neckCurve(p, 'front'), back: neckCurve(p, 'back') } : undefined,
    ribRadius: Math.max(0.3, p.core.collarWidth * 0.4),
  };
}

export const tshirtDef: GarmentDef<TShirtParams> = {
  kind: 'tshirt',
  label: 'T-shirt',
  hint: 'Drag the dots to reshape: neck, shoulders, sleeves, armpits and hem.',
  defaults: defaultParams,
  form: {
    coreFields: CORE_FIELDS,
    sideFields: SIDE_FIELDS,
    halfWidthKeys: HALF_WIDTH_KEYS,
    degreeKeys: new Set(['sleeveAngle']),
    enums: {
      hemStyle: { label: 'Hem shape', options: [{ value: 'curved', label: 'Curved' }, { value: 'straight', label: 'Straight lines' }] },
      neckStyle: {
        label: 'Neckline style',
        options: [
          { value: 'crew', label: 'Crew (round)' },
          { value: 'scoop', label: 'Scoop (U)' },
          { value: 'v', label: 'V-neck' },
          { value: 'square', label: 'Square' },
          { value: 'boat', label: 'Boat (wide, shallow)' },
        ],
      },
    },
    toggles: {},
    groups: [
      { id: 'body', title: 'Body', core: ['bodyLength'], side: ['chestHalf', 'hemHalf', 'hemOffset'], enums: ['hemStyle'], open: true },
      { id: 'shoulders', title: 'Shoulders', core: [], side: ['shoulderHalf', 'shoulderDrop'], open: true },
      { id: 'sleeves', title: 'Sleeves', core: [], side: ['sleeveLength', 'sleeveOpening', 'sleeveAngle', 'armholeDepth'], open: true },
      { id: 'neck', title: 'Neckline & collar', core: ['neckWidth', 'neckDepthFront', 'neckDepthBack', 'collarWidth'], side: [], enums: ['neckStyle'] },
    ],
  },
  styleLabels: { body: 'Body', sleeves: 'Sleeves', rib: 'Neck rib', armholeSeam: 'Show armhole seam (sleeve joining line)' },
  flatParts,
  handles: (p, surface) => getHandles(p, surface),
  drag: (p, h, ptr, surface) => applyHandleDrag(p, h as Parameters<typeof applyHandleDrag>[1], ptr, surface),
  validate: validateParams,
  mesh,
  panelFrame: (p) => ({ leftHalf: p.left.chestHalf, rightHalf: p.right.chestHalf, length: p.core.bodyLength }),
  pointsOfMeasure,
};
