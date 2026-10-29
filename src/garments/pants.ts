import { z } from 'zod';
import pf from './pantsFields.json';
import type { FieldSpec, Side } from '../model/schema';
import { defaultStyle, styleSchema, type GarmentStyle } from '../model/style';
import type { Issue } from '../model/validate';
import { crossingsAtY, type Pom } from '../model/pom';
import { catmullRom, cubic, dedupe, findSelfIntersection, offsetPolyline, quadPoints, signedArea, vec, xAtY, type Vec } from '../geometry/polygon';
import type { FlatPart, FlatParts, GarmentDef, GarmentHandle, MeshSpec, Surface } from './types';

/**
 * Pants, cargos and shorts (shorts are pants with a short inseam).
 *
 * Model frame: centimetres, origin at the centre of the waist top edge, +y down,
 * +x toward the WEARER's left, front view. Each leg runs from the crotch
 * (0, rise) and the outer hip down to its hem; left and right legs can differ.
 */

export type PantsCoreKey = keyof typeof pf.core;
export type PantsSideKey = keyof typeof pf.side;
export type WaistStyle = 'band' | 'elastic';
export type CuffStyle = 'plain' | 'elastic';

export const PANTS_CORE_FIELDS = pf.core as Record<PantsCoreKey, FieldSpec>;
export const PANTS_SIDE_FIELDS = pf.side as Record<PantsSideKey, FieldSpec>;
const CORE_KEYS = Object.keys(PANTS_CORE_FIELDS) as PantsCoreKey[];
const SIDE_KEYS = Object.keys(PANTS_SIDE_FIELDS) as PantsSideKey[];
const TOGGLE_KEYS = ['fly', 'frontPockets', 'cargoPockets', 'backPockets'] as const;
type ToggleKey = (typeof TOGGLE_KEYS)[number];

export type PantsCore = Record<PantsCoreKey, number> & { waistStyle: WaistStyle; cuffStyle: CuffStyle } & Record<ToggleKey, boolean>;
export type PantsSide = Record<PantsSideKey, number>;

export interface PantsParams {
  kind: 'pants';
  core: PantsCore;
  left: PantsSide;
  right: PantsSide;
  mirror: boolean;
  style: GarmentStyle;
}

const IN = 2.54;
const KNEE_AT = 0.45; // knee sits this far down the inseam

const SIGN: Record<Side, 1 | -1> = { left: 1, right: -1 };
const r1 = (n: number) => Math.round(n * 10) / 10;

export function pantsDefaults(): PantsParams {
  const side = Object.fromEntries(SIDE_KEYS.map((k) => [k, PANTS_SIDE_FIELDS[k].default])) as PantsSide;
  return {
    kind: 'pants',
    core: {
      ...(Object.fromEntries(CORE_KEYS.map((k) => [k, PANTS_CORE_FIELDS[k].default])) as Record<PantsCoreKey, number>),
      waistStyle: 'band',
      cuffStyle: 'plain',
      fly: pf.toggles.fly.default,
      frontPockets: pf.toggles.frontPockets.default,
      cargoPockets: pf.toggles.cargoPockets.default,
      backPockets: pf.toggles.backPockets.default,
    },
    left: { ...side },
    right: { ...side },
    mirror: true,
    style: defaultStyle(),
  };
}

// ---------- geometry ----------

interface LegPoints {
  waist: Vec;
  /** The whole side seam as one smooth curve: waist corner (excluded) down to the outer hem. */
  outerSeam: Vec[];
  /** The inside leg as one smooth curve: crotch (excluded) down to the inner hem. */
  innerSeam: Vec[];
  thigh: Vec;
  outerKnee: Vec;
  outerHem: Vec;
  innerHem: Vec;
  innerKnee: Vec;
}

function leg(p: PantsParams, side: Side): LegPoints {
  const s = SIGN[side];
  const L = p[side];
  const W = p.core.waistWidth / 2;
  const R = p.core.rise;
  const tc = L.thighWidth / 2;
  const hc = tc + L.legSplay;
  const kc = tc + (hc - tc) * KNEE_AT;
  const kneeY = R + L.inseam * KNEE_AT;
  const hemY = R + L.inseam;
  const waist = vec(s * W, 0);
  const thigh = vec(s * L.thighWidth, R);
  const outerKnee = vec(s * (kc + L.kneeWidth / 2), kneeY);
  const outerHem = vec(s * (hc + L.legOpening / 2), hemY);
  const innerHem = vec(s * (hc - L.legOpening / 2), hemY);
  const innerKnee = vec(s * (kc - L.kneeWidth / 2), kneeY);
  // One smooth side seam through the waist, the hip, the thigh, knee and hem: no corner
  // where the hip meets the leg. The hip point eases out from the waist like a real seam.
  const hipPoint = vec(s * (W + (L.thighWidth - W) * 0.78), R * 0.5);
  const outerSeam = catmullRom([waist, hipPoint, thigh, outerKnee, outerHem], 8).slice(1);
  const innerSeam = catmullRom([vec(0, R), innerKnee, innerHem], 10).slice(1);
  return { waist, outerSeam, innerSeam, thigh, outerKnee, outerHem, innerHem, innerKnee };
}

export function pantsOutline(p: PantsParams): Vec[] {
  const l = leg(p, 'left'), r = leg(p, 'right');
  return dedupe([
    r.waist,
    l.waist,
    ...l.outerSeam, // down the left side to the hem
    ...l.innerSeam.slice().reverse(), // up the inside leg (inner hem -> just below the crotch)
    vec(0, p.core.rise), // the inside legs meet in a smooth curve at the crotch
    ...r.innerSeam, // down the right inside leg to the inner hem
    ...r.outerSeam.slice().reverse().slice(1), // up the right side, ending just below the waist corner
  ]);
}

/** x of the outer seam at height y. */
function outerXAt(lp: LegPoints, y: number): number {
  return xAtY(lp.outerSeam, y);
}

/** x of the inside leg seam at height y. */
function innerXAt(lp: LegPoints, _p: PantsParams, y: number): number {
  return xAtY(lp.innerSeam, y);
}

const rect = (x0: number, y0: number, x1: number, y1: number): Vec[] => [vec(x0, y0), vec(x1, y0), vec(x1, y1), vec(x0, y1)];

function flatParts(p: PantsParams, surface: Surface): FlatParts {
  const outline = pantsOutline(p);
  const W = p.core.waistWidth / 2;
  const R = p.core.rise;
  const wb = p.core.waistbandHeight;
  const over: FlatPart[] = [];
  const far = W + 80;

  const stitch = (points: Vec[], weight = 0.35): FlatPart => ({ kind: 'detail', points, closed: false, stroke: true, weight, dashed: true, clip: 'all' });
  const line = (points: Vec[], weight = 0.5): FlatPart => ({ kind: 'seam', points, closed: false, stroke: true, weight, clip: 'all' });
  const fold = (a: Vec, c: Vec, b: Vec): FlatPart => ({ kind: 'fold', points: [a, ...quadPoints(a, c, b, 6)], closed: false, stroke: true, weight: 0.45, clip: 'all' });
  const circle = (c: Vec, r: number): Vec[] => Array.from({ length: 14 }, (_, i) => vec(c.x + r * Math.cos((i / 14) * 2 * Math.PI), c.y + r * Math.sin((i / 14) * 2 * Math.PI)));
  /** Outer side seam x at height y on one side (from the outline itself, so it follows the hip curve). */
  const sideX = (s: number, y: number) => {
    const xs = crossingsAtY(outline, y).filter((x) => s * x > 0);
    return xs.length ? s * Math.max(...xs.map(Math.abs)) : s * W;
  };

  // Front pocket openings: a curve from the waistband out to the side seam, with stitching.
  if (surface === 'front' && p.core.frontPockets) {
    for (const s of [1, -1]) {
      const yEnd = wb + Math.min(R * 0.45, 14);
      const a = vec(s * W * 0.52, wb), c = vec(s * W * 0.6, wb + (yEnd - wb) * 0.85), b = vec(sideX(s, yEnd) + s * 1.5, yEnd);
      const curve = [a, ...quadPoints(a, c, b, 10)];
      over.push(line(curve));
      // Stitching sits on the body side of the opening (whichever offset lies lower).
      const o1 = offsetPolyline(curve, 0.6), o2 = offsetPolyline(curve, -0.6);
      over.push(stitch(o1[5].y > o2[5].y ? o1 : o2));
    }
  }

  if (wb > 0) {
    over.push({ kind: 'rib', points: rect(-far, -5, far, wb), closed: true, fill: 'rib', stroke: true, weight: 0.5, clip: 'all' });
    if (p.core.waistStyle === 'elastic') {
      for (let x = -W + 1.2; x < W - 0.6; x += 1.6) over.push({ kind: 'detail', points: [vec(x, wb * 0.18), vec(x, wb * 0.82)], closed: false, stroke: true, weight: 0.3, clip: 'all' });
    } else {
      // Topstitching along the band, belt loops, and a button at the top of the fly.
      over.push(stitch([vec(-far, 0.6), vec(far, 0.6)]), stitch([vec(-far, wb - 0.6), vec(far, wb - 0.6)]));
      if (wb >= 2) {
        const loops = surface === 'front' ? [W * 0.55, W - 2] : [0, W * 0.5, W - 2];
        for (const lx of loops)
          for (const s of lx === 0 ? [1] : [1, -1])
            over.push({ kind: 'detail', points: rect(s * lx - 0.6, -0.3, s * lx + 0.6, wb + 0.9), closed: true, fill: 'rib', stroke: true, weight: 0.4, clip: 'all' });
        if (surface === 'front' && p.core.fly) over.push({ kind: 'detail', points: circle(vec(0, wb / 2), Math.min(0.9, wb * 0.25)), closed: true, fill: 'rib', stroke: true, weight: 0.45, clip: 'all' });
      }
    }
  }
  // Centre seam, and the fly stitching on the front.
  over.push(line([vec(0, wb), vec(0, R)]));
  if (surface === 'front' && p.core.fly) {
    const fx = Math.min(3.8, W * 0.2);
    const end = vec(0, R * 0.78);
    const fly: Vec[] = [vec(fx, wb)];
    for (let i = 0; i <= 8; i++) fly.push(cubic(vec(fx, R * 0.5), vec(fx, R * 0.7), vec(fx * 0.4, R * 0.78), end, i / 8));
    over.push(stitch(fly, 0.45));
  }
  if (surface === 'back') {
    // Back yoke seam: a shallow V across the seat, typical of jeans and work pants.
    if (p.core.waistStyle === 'band') {
      const yokeY = wb + Math.min(6, R * 0.2);
      over.push(line([vec(-far, yokeY - 1.5), vec(0, yokeY + 1.5), vec(far, yokeY - 1.5)]));
    }
    if (p.core.backPockets) {
      const pw = Math.min(14, W * 0.42), ph = pw * 1.1, top = wb + Math.min(8, R * 0.26);
      for (const s of [1, -1]) {
        const cx = s * W * 0.5;
        const pocket = [vec(cx - pw / 2, top), vec(cx + pw / 2, top), vec(cx + pw / 2, top + ph * 0.82), vec(cx, top + ph), vec(cx - pw / 2, top + ph * 0.82)];
        over.push({ kind: 'detail', points: pocket, closed: true, stroke: true, weight: 0.5, clip: 'all' });
        over.push(stitch([vec(cx - pw / 2 + 0.5, top + 1.2), vec(cx + pw / 2 - 0.5, top + 1.2)]));
      }
    }
  }

  for (const side of ['left', 'right'] as const) {
    const s = SIGN[side];
    const lp = leg(p, side);
    const inseam = p[side].inseam;
    if (p.core.cargoPockets && inseam >= 12) {
      const top = R + Math.min(8, inseam * 0.15);
      const h = Math.min(21, inseam * 0.38);
      const legW = Math.abs(outerXAt(lp, top) - innerXAt(lp, p, top));
      const w = Math.min(17, legW * 0.55);
      const edge = Math.abs(outerXAt(lp, top + h / 2)) - 1.5; // sits just inside the outer seam
      const x0 = s * (edge - w), x1 = s * edge;
      over.push({ kind: 'detail', points: rect(x0, top, x1, top + h), closed: true, fill: 'body', stroke: true, weight: 0.5, clip: 'all' });
      over.push(stitch(rect(x0 + s * 0.5, top + 0.5, x1 - s * 0.5, top + h - 0.5).concat([vec(x0 + s * 0.5, top + 0.5)])));
      over.push({ kind: 'detail', points: rect(x0 - s * 0.6, top - 0.6, x1 + s * 0.6, top + Math.min(5.5, h * 0.3)), closed: true, fill: 'body', stroke: true, weight: 0.5, clip: 'all' });
    }
    const hemY = lp.outerHem.y;
    const band = p.core.cuffStyle === 'elastic' ? Math.min(4.5, inseam * 0.25) : 0;
    if (band > 0) {
      const y = hemY - band;
      over.push({ kind: 'rib', points: [vec(innerXAt(lp, p, y), y), vec(outerXAt(lp, y), y), lp.outerHem, lp.innerHem], closed: true, fill: 'rib', stroke: true, weight: 0.5, clip: 'all' });
      const x0 = innerXAt(lp, p, y), x1 = outerXAt(lp, y);
      for (let t = 0.08; t < 0.95; t += 0.09) {
        const xa = x0 + (x1 - x0) * t, xb = lp.innerHem.x + (lp.outerHem.x - lp.innerHem.x) * t;
        over.push({ kind: 'detail', points: [vec(xa, y + band * 0.15), vec(xb, hemY - band * 0.15)], closed: false, stroke: true, weight: 0.3, clip: 'all' });
      }
    } else {
      // Double-needle hem stitching.
      for (const d of [Math.min(1.8, inseam * 0.12), Math.min(2.4, inseam * 0.16)]) {
        const y = hemY - d;
        over.push(stitch([vec(innerXAt(lp, p, y) - s * 2, y), vec(outerXAt(lp, y) + s * 2, y)]));
      }
    }

    // Fold lines: whiskers from the crotch, and soft creases at the knee on long legs.
    if (inseam > 8) {
      over.push(fold(vec(s * 1.5, R + 1), vec(s * 3.5, R - 1.5), vec(s * Math.min(8, W * 0.4), R - 5)));
      over.push(fold(vec(s * 2.5, R + 3), vec(s * 5, R + 1), vec(s * Math.min(10, W * 0.5), R - 1.5)));
    }
    if (inseam > 45) {
      const ky = lp.outerKnee.y;
      const xi = innerXAt(lp, p, ky), xo = outerXAt(lp, ky);
      const at = (t: number, dy: number) => vec(xi + (xo - xi) * t, ky + dy);
      over.push(fold(at(0.3, -2), at(0.5, -3.2), at(0.72, -1.5)));
      over.push(fold(at(0.35, 2.5), at(0.52, 1.5), at(0.66, 2.8)));
    }
  }
  return { outline, body: outline, under: [], over };
}

// ---------- handles ----------

const LABELS: Record<string, string> = {
  waist: 'Waist corner: drag sideways to change the waist width',
  crotch: 'Crotch: drag up/down to change the rise',
  thigh: 'Thigh: drag sideways to change the thigh width',
  knee: 'Knee: drag sideways to change the knee width',
  hemOuter: 'Outer hem: drag to change the leg length and opening',
  hemInner: 'Inner hem: drag sideways to angle the leg in or out',
};

function handles(p: PantsParams): GarmentHandle[] {
  const hs: GarmentHandle[] = [{ id: 'crotch', kind: 'crotch', pos: vec(0, p.core.rise), label: LABELS.crotch }];
  for (const side of ['left', 'right'] as const) {
    const lp = leg(p, side);
    const add = (kind: string, pos: Vec) => hs.push({ id: `${kind}:${side}`, kind, side, pos, label: LABELS[kind] });
    add('waist', lp.waist);
    add('thigh', lp.thigh);
    add('knee', lp.outerKnee);
    add('hemOuter', lp.outerHem);
    add('hemInner', lp.innerHem);
  }
  return hs;
}

const round = (v: number, step: number) => Math.round(v / step) * step;
const clamp = (v: number, s: FieldSpec) => Math.min(s.max, Math.max(s.min, round(v, s.step)));

function cloneP(p: PantsParams): PantsParams {
  return { ...p, core: { ...p.core }, left: { ...p.left }, right: { ...p.right }, style: structuredClone(p.style) };
}

function drag(params: PantsParams, h: Pick<GarmentHandle, 'kind' | 'side'>, ptr: Vec): PantsParams {
  const p = cloneP(params);
  const side = h.side ?? 'left';
  const s = SIGN[side];
  const L = params[side];
  const setCore = (k: PantsCoreKey, v: number) => Number.isFinite(v) && (p.core[k] = clamp(v, PANTS_CORE_FIELDS[k]));
  const setSide = (k: PantsSideKey, v: number) => {
    if (!Number.isFinite(v)) return;
    const c = clamp(v, PANTS_SIDE_FIELDS[k]);
    p[side][k] = c;
    if (p.mirror) p[side === 'left' ? 'right' : 'left'][k] = c;
  };
  const tc = L.thighWidth / 2, hc = tc + L.legSplay;
  switch (h.kind) {
    case 'waist': setCore('waistWidth', 2 * Math.abs(ptr.x)); break;
    case 'crotch': setCore('rise', ptr.y); break;
    case 'thigh': setSide('thighWidth', s * ptr.x); break;
    case 'knee': setSide('kneeWidth', 2 * (s * ptr.x - (tc + (hc - tc) * KNEE_AT))); break;
    case 'hemOuter':
      setSide('inseam', ptr.y - params.core.rise);
      setSide('legOpening', 2 * (s * ptr.x - hc));
      break;
    case 'hemInner': setSide('legSplay', s * ptr.x + L.legOpening / 2 - tc); break;
  }
  return p;
}

// ---------- validation ----------

function validate(p: PantsParams): Issue[] {
  const issues: Issue[] = [];
  const num = (v: unknown, s: FieldSpec, where: string) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) issues.push({ rule: 'not-a-number', message: `${where} is not a valid number.` });
    else if (v < s.min || v > s.max) issues.push({ rule: 'out-of-range', message: `${where} must be between ${s.min} and ${s.max} (got ${v}).` });
  };
  for (const k of CORE_KEYS) num(p.core[k], PANTS_CORE_FIELDS[k], PANTS_CORE_FIELDS[k].label);
  for (const side of ['left', 'right'] as const) for (const k of SIDE_KEYS) num(p[side][k], PANTS_SIDE_FIELDS[k], `${PANTS_SIDE_FIELDS[k].label} (wearer's ${side})`);
  if (issues.length) return issues;

  if (p.core.waistbandHeight > p.core.rise - 6) issues.push({ rule: 'band-too-tall', message: 'The waistband is taller than the rise allows. Lower the band or lengthen the rise.' });
  for (const side of ['left', 'right'] as const) {
    const lp = leg(p, side);
    // The whole curved inside seam (below the crotch) must stay on its own side of the centre line.
    // The legs nearly touch just below the crotch, so the gap is only required further down.
    if (lp.innerSeam.some((v) => SIGN[side] * v.x < (v.y > p.core.rise + 8 ? 0.5 : 0)))
      issues.push({ rule: 'legs-overlap', message: `The wearer's ${side} leg would cross the middle. Angle it outwards or make it narrower.` });
  }
  if (issues.length) return issues;
  const poly = pantsOutline(p);
  if (Math.abs(signedArea(poly)) < 1) return [{ rule: 'degenerate', message: 'The outline has collapsed to (almost) nothing.' }];
  if (findSelfIntersection(poly)) return [{ rule: 'self-intersection', message: 'That would make the outline cross over itself.' }];
  return [];
}

// ---------- measurements ----------

function pointsOfMeasure(p: PantsParams): Pom[] {
  const poly = pantsOutline(p);
  const R = p.core.rise;
  const perSide = (f: (s: Side) => number): number | [number, number] => {
    const l = r1(f('left')), r = r1(f('right'));
    return Math.abs(l - r) < 0.05 ? l : [l, r];
  };
  /** Width of one leg at height y (crossings on that side of the centre). */
  const legWidthAt = (side: Side, y: number) => {
    const xs = crossingsAtY(poly, y).filter((x) => SIGN[side] * x > 0).map(Math.abs);
    return xs.length >= 2 ? Math.max(...xs) - Math.min(...xs) : 0;
  };
  const hipY = Math.min(7 * IN, R - 2);
  const hipXs = crossingsAtY(poly, hipY);
  const outseam = (side: Side) => {
    const lp = leg(p, side);
    const pts = [lp.waist, ...lp.outerSeam];
    let d = 0;
    for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    return d;
  };
  const kneeBelow = 13 * IN;
  const longEnough = Math.min(p.left.inseam, p.right.inseam) > kneeBelow + 5;
  const poms: Pom[] = [
    { code: 'A', name: 'Waist', howToMeasure: 'Across the top of the waistband, relaxed, laid flat', value: r1(p.core.waistWidth), tolerance: IN / 2, grade: IN * 0.75 },
    { code: 'B', name: 'Waistband height', howToMeasure: 'Top edge to the waistband seam', value: r1(p.core.waistbandHeight), tolerance: IN / 8, grade: 0 },
    { code: 'C', name: 'Front rise', howToMeasure: 'From the top of the waistband down the centre front to the crotch seam', value: r1(R), tolerance: IN / 4, grade: IN / 4 },
    { code: 'D', name: 'Hip', howToMeasure: '18 cm (7 in) below the waist top, side to side', value: r1(hipXs.length >= 2 ? Math.max(...hipXs) - Math.min(...hipXs) : 0), tolerance: IN / 2, grade: IN },
    { code: 'E', name: 'Thigh', howToMeasure: '2.5 cm (1 in) below the crotch, across one leg', value: perSide((s) => legWidthAt(s, R + IN)), tolerance: IN / 4, grade: IN / 2 },
    { code: 'F', name: 'Knee', howToMeasure: '33 cm (13 in) below the crotch, across one leg', value: longEnough ? perSide((s) => legWidthAt(s, R + kneeBelow)) : 0, tolerance: IN / 4, grade: IN * 0.375 },
    { code: 'G', name: 'Leg opening', howToMeasure: 'Across the hem of one leg, laid flat', value: perSide((s) => p[s].legOpening), tolerance: IN / 4, grade: IN / 4 },
    { code: 'H', name: 'Inseam', howToMeasure: 'From the crotch seam down the inside leg to the hem', value: perSide((s) => p[s].inseam), tolerance: IN / 2, grade: IN / 2 },
    { code: 'I', name: 'Outseam', howToMeasure: 'From the top of the waistband down the side to the hem', value: perSide(outseam), tolerance: IN / 2, grade: IN / 2 },
  ];
  // Drop measurements that don't apply (no waistband, shorts too short for a knee).
  return poms.filter((m) => (Array.isArray(m.value) ? Math.max(...m.value) : m.value) > 0);
}

// ---------- definition ----------

export const pantsDef: GarmentDef<PantsParams> = {
  kind: 'pants',
  label: 'Pants & shorts',
  hint: 'Drag the dots to reshape: waist corners, crotch (rise), thighs, knees and hems.',
  defaults: pantsDefaults,
  form: {
    coreFields: PANTS_CORE_FIELDS,
    sideFields: PANTS_SIDE_FIELDS,
    halfWidthKeys: new Set(),
    degreeKeys: new Set(),
    enums: {
      waistStyle: { label: 'Waist', options: [{ value: 'band', label: 'Waistband' }, { value: 'elastic', label: 'Elastic (gathered)' }] },
      cuffStyle: { label: 'Leg hem', options: [{ value: 'plain', label: 'Plain hem' }, { value: 'elastic', label: 'Elastic cuff (jogger)' }] },
    },
    toggles: {
      fly: { label: pf.toggles.fly.label },
      frontPockets: { label: pf.toggles.frontPockets.label },
      cargoPockets: { label: pf.toggles.cargoPockets.label },
      backPockets: { label: pf.toggles.backPockets.label },
    },
    groups: [
      { id: 'waist', title: 'Waist & rise', core: ['waistWidth', 'rise', 'waistbandHeight'], side: [], enums: ['waistStyle'], toggles: ['fly', 'frontPockets', 'backPockets'], open: true },
      { id: 'legs', title: 'Legs', core: [], side: ['thighWidth', 'kneeWidth', 'legOpening', 'inseam', 'legSplay'], enums: ['cuffStyle'], toggles: ['cargoPockets'], open: true },
    ],
  },
  styleLabels: { body: 'Body', rib: 'Waistband & cuffs' },
  flatParts,
  handles: (p) => handles(p),
  drag: (p, h, ptr) => drag(p, h, ptr),
  validate,
  mesh(p): MeshSpec {
    const thigh = (p.left.thighWidth + p.right.thighWidth) / 2;
    return { outer: pantsOutline(p), maxDepth: Math.min(11, Math.max(5, 0.33 * thigh)), guides: [] };
  },
  panelFrame: (p) => ({ leftHalf: p.left.thighWidth, rightHalf: p.right.thighWidth, length: p.core.rise + (p.left.inseam + p.right.inseam) / 2 }),
  pointsOfMeasure,
};

// ---------- persistence ----------

const num = z.number().finite();
export const pantsParamsSchema = z.object({
  kind: z.literal('pants'),
  core: z.object({
    ...(Object.fromEntries(CORE_KEYS.map((k) => [k, num])) as Record<PantsCoreKey, typeof num>),
    waistStyle: z.enum(['band', 'elastic']),
    cuffStyle: z.enum(['plain', 'elastic']),
    fly: z.boolean(),
    // Added after pants first shipped: older files get front pockets.
    frontPockets: z.boolean().default(true),
    cargoPockets: z.boolean(),
    backPockets: z.boolean(),
  }),
  left: z.object(Object.fromEntries(SIDE_KEYS.map((k) => [k, num])) as Record<PantsSideKey, typeof num>),
  right: z.object(Object.fromEntries(SIDE_KEYS.map((k) => [k, num])) as Record<PantsSideKey, typeof num>),
  mirror: z.boolean(),
  style: styleSchema,
});

/** Presets helper: defaults overridden by `core` and `side`; `right` makes it asymmetric. */
export function pants(core: Partial<PantsCore>, side: Partial<PantsSide>, right?: Partial<PantsSide>): () => PantsParams {
  return () => {
    const p = pantsDefaults();
    Object.assign(p.core, core);
    Object.assign(p.left, side);
    Object.assign(p.right, side, right ?? {});
    p.mirror = !right;
    return p;
  };
}
