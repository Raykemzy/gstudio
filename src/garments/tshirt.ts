import { CORE_FIELDS, HALF_WIDTH_KEYS, SIDE_FIELDS, defaultParams, type TShirtParams } from '../model/schema';
import { validateParams } from '../model/validate';
import { pointsOfMeasure } from '../model/pom';
import { buildOutline, neckCurve, neckY, offsetNeck, sidePoints } from '../geometry/outline';
import { applyHandleDrag, getHandles } from '../geometry/handles';
import type { Vec } from '../geometry/polygon';
import type { FlatPart, GarmentDef, MeshSpec, Surface } from './types';

/** The T-shirt, wrapping the original tee modules behind the shared garment interface. */

function flatParts(p: TShirtParams, surface: Surface) {
  const o = buildOutline(p, surface);
  const under: FlatPart[] = [];
  const over: FlatPart[] = [];
  const sleeveCorners: Vec[] = [];
  for (const side of ['left', 'right'] as const) {
    const sp = sidePoints(p, side);
    if (p[side].sleeveLength > 0.5) {
      // Sleeve: shoulder point out to the cuff and back to the armpit.
      under.push({ kind: 'sleeve', points: [sp.shoulder, sp.sleeveTop, sp.sleeveBottom, sp.underarm], closed: true, fill: 'sleeves', clip: 'all' });
      sleeveCorners.push(o.sides[side].sleeveTop, o.sides[side].sleeveBottom);
    }
  }
  if (p.core.collarWidth > 0) {
    const inner = offsetNeck(o.neck, p.core.collarWidth);
    over.push({ kind: 'rib', points: [...o.neck, ...inner.reverse()], closed: true, fill: 'rib', stroke: true, weight: 0.4, clip: 'all' });
  }
  if (p.style.armholeSeam)
    for (const side of ['left', 'right'] as const) {
      const sp = sidePoints(p, side);
      over.push({ kind: 'seam', points: [sp.shoulder, sp.underarm], closed: false, stroke: true, weight: 0.5, clip: 'all' });
    }
  // The back neckline, seen through the front opening.
  if (surface === 'front') over.push({ kind: 'hidden', points: neckCurve(p, 'back'), closed: false, stroke: true, weight: 0.5, dashed: true, clip: 'none' });
  // Body only: the outline with the sleeve corners removed, so it runs shoulder point -> armpit.
  const body = o.polygon.filter((v) => !sleeveCorners.some((q) => Math.abs(q.x - v.x) < 1e-9 && Math.abs(q.y - v.y) < 1e-9));
  return { outline: o.polygon, body, under, over };
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
