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

const line = (points: Vec[], weight = 0.6): FlatPart => ({ kind: 'seam', points, closed: false, stroke: true, weight, clip: 'all' });

function flatParts(p: TShirtParams, surface: Surface) {
  // Front view: the silhouette's top edge is the BACK neckline, and the inside of the back
  // shows through the front opening, as on a real flat sketch.
  const outline = buildOutline(p, surface === 'front' ? 'outer' : 'back').polygon;
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
    if (p.style.armholeSeam) {
      over.push(line(armhole));
      // Dropped shoulders: the body's own edge carries on up under the sleeve to the shoulder line.
      const halfNeck = p.core.neckWidth / 2;
      if (L.shoulderHalf > L.chestHalf + 1.5 && L.chestHalf > halfNeck + 1) {
        const yTop = (L.shoulderDrop * (L.chestHalf - halfNeck)) / (L.shoulderHalf - halfNeck);
        const top = vec(s * L.chestHalf, yTop + 0.4);
        over.push(line([top, ...quadPoints(top, vec(s * (L.chestHalf + 0.3), (yTop + sp.underarm.y) / 2), sp.underarm, 8)]));
      }
    }

    // Sleeve hem band: one clean line across the sleeve, parallel to the hem.
    const topLen = dist(sp.shoulder, sp.sleeveTop), underLen = dist(sp.underarm, sp.sleeveBottom);
    if (L.sleeveLength > 4 && underLen > 3) {
      const band = Math.min(2, L.sleeveLength * 0.2);
      over.push(line([lerp(sp.sleeveTop, sp.shoulder, Math.min(0.45, band / topLen)), lerp(sp.sleeveBottom, sp.underarm, Math.min(0.45, band / underLen))]));
    }

    // Fold lines (off by default): drag lines from the armpit and a soft fold in the sleeve.
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

  // Neck.
  const backNeck = neckCurve(p, 'back');
  if (surface === 'front') {
    // The inside of the back, seen through the front neck opening, and the back rib's lower edge.
    const frontNeck = neckCurve(p, 'front');
    over.push({ kind: 'detail', points: [...neckCurve(p, 'outer'), ...frontNeck.slice().reverse()], closed: true, fill: 'shade', clip: 'all' });
    if (cw > 0) {
      const visible = offsetNeck(backNeck, cw).filter((v) => v.y < neckY(p, 'front', v.x) - 0.15);
      if (visible.length > 1) over.push(line(visible, 0.5));
    }
  }
  const neck = neckCurve(p, surface);
  if (cw > 0) {
    over.push({ kind: 'rib', points: [...neck, ...offsetNeck(neck, cw).reverse()], closed: true, fill: 'rib', stroke: true, weight: 0.6, clip: 'all' });
  } else {
    over.push(line(offsetNeck(neck, 0.8), 0.4)); // a narrow binding instead of a rib
  }

  // Bottom hem band: one clean line following the hem's shape, kept off the sleeves.
  const hem = hemLine(p);
  over.push({ ...line(extendEnds(offsetPolyline(hem, 2), 4)), clip: 'body' });
  // Soft folds rising from the hem (off by default).
  for (const s of [1, -1]) {
    const x = s * (s > 0 ? p.left.hemHalf : p.right.hemHalf) * 0.5;
    const y = hemYAt(hem, x);
    over.push(fold([vec(x, y - 0.8), ...quadPoints(vec(x, y - 0.8), vec(x - s * 0.4, y - 4.5), vec(x - s * 1.6, y - 8), 6)]));
  }

  return { outline, body: buildBodyOutline(p, surface), under, over };
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
