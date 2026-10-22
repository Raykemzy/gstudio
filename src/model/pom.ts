import type { Side, TShirtParams } from './schema';
import { buildOutline, sidePoints } from '../geometry/outline';
import type { Vec } from '../geometry/polygon';

/**
 * Points of measure (POM): the measurements a factory takes from a finished garment
 * laid flat, calculated from the design the way they'd be measured on a sample.
 * Definitions follow common tech-pack conventions (CLO-SET and Sizely templates):
 * widths are flat (half the circumference), lengths from the high point shoulder
 * (HPS, beside the neck). Tolerances and grading steps are those templates' typical
 * values, converted to cm. Treat them as starting points to agree with a factory.
 */

const IN = 2.54;

export interface Pom {
  code: string;
  name: string;
  howToMeasure: string;
  /** cm at the base size. One value, or [wearer's left, wearer's right] when the sides differ. */
  value: number | [number, number];
  /** ± allowed deviation for a QC sample, cm. */
  tolerance: number;
  /** Change per size step, cm. */
  grade: number;
}

export const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'] as const;
export type Size = (typeof SIZES)[number];

/** All x positions where the horizontal line at height y crosses the polygon. */
function crossingsAtY(poly: Vec[], y: number): number[] {
  const xs: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
  }
  return xs;
}

/** Lowest point of the polygon on the vertical line at x (the hem below that point). */
function lowestAtX(poly: Vec[], x: number): number | null {
  let best: number | null = null;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if ((a.x <= x && b.x > x) || (b.x <= x && a.x > x)) {
      const y = a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y);
      if (best === null || y > best) best = y;
    }
  }
  return best;
}

/** The body only: outline without the sleeve corners, so widths run armhole to armhole / seam to seam. */
function bodyPolygon(p: TShirtParams): Vec[] {
  const o = buildOutline(p, 'front');
  const sleeve = (['left', 'right'] as const).flatMap((s) => (p[s].sleeveLength > 0.5 ? [o.sides[s].sleeveTop, o.sides[s].sleeveBottom] : []));
  return o.polygon.filter((v) => !sleeve.some((q) => Math.abs(q.x - v.x) < 1e-9 && Math.abs(q.y - v.y) < 1e-9));
}

/** Flat width across the body at height y (0 if the line misses the body). */
function widthAt(body: Vec[], y: number): number {
  const xs = crossingsAtY(body, y);
  return xs.length >= 2 ? Math.max(...xs) - Math.min(...xs) : 0;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const perSide = (f: (s: Side) => number): number | [number, number] => {
  const l = r1(f('left')), r = r1(f('right'));
  return Math.abs(l - r) < 0.05 ? l : [l, r];
};

export function pointsOfMeasure(p: TShirtParams): Pom[] {
  const body = bodyPolygon(p);
  const sp = { left: sidePoints(p, 'left'), right: sidePoints(p, 'right') };
  const armpitY = Math.max(sp.left.underarm.y, sp.right.underarm.y);
  const hps = p.core.neckWidth / 2;
  const front = buildOutline(p, 'front').polygon;

  /** Upper arm: sleeve width square to the sleeve, measured 2.5 cm along the underside from the armpit. */
  const bicep = (s: Side) => {
    const q = sp[s];
    if (p[s].sleeveLength < 0.5) return 0;
    const ux = q.sleeveBottom.x - q.underarm.x, uy = q.sleeveBottom.y - q.underarm.y;
    const ul = Math.hypot(ux, uy) || 1;
    const at = { x: q.underarm.x + (ux / ul) * Math.min(IN, ul), y: q.underarm.y + (uy / ul) * Math.min(IN, ul) };
    // Distance from that point to the line along the top of the sleeve.
    const tx = q.sleeveTop.x - q.shoulder.x, ty = q.sleeveTop.y - q.shoulder.y;
    const tl = Math.hypot(tx, ty) || 1;
    return Math.abs((at.x - q.shoulder.x) * ty - (at.y - q.shoulder.y) * tx) / tl;
  };

  const poms: Pom[] = [
    { code: 'A', name: 'Neck width', howToMeasure: 'Edge to edge across the neck opening, straight', value: r1(p.core.neckWidth), tolerance: IN / 4, grade: IN / 4 },
    { code: 'B', name: 'Front neck drop', howToMeasure: 'From the HPS line down to the front neck edge', value: r1(p.core.neckDepthFront), tolerance: IN / 8, grade: 0 },
    { code: 'C', name: 'Back neck drop', howToMeasure: 'From the HPS line down to the back neck edge', value: r1(p.core.neckDepthBack), tolerance: IN / 8, grade: 0 },
    { code: 'D', name: 'Shoulder width', howToMeasure: 'Shoulder point to shoulder point, straight across', value: r1(p.left.shoulderHalf + p.right.shoulderHalf), tolerance: IN / 4, grade: IN / 2 },
    { code: 'E', name: 'Shoulder slope', howToMeasure: 'Drop from the HPS to the shoulder point', value: perSide((s) => p[s].shoulderDrop), tolerance: IN / 4, grade: 0 },
    { code: 'F', name: 'Across front', howToMeasure: '12.7 cm (5 in) below the HPS, armhole seam to armhole seam', value: r1(widthAt(body, 5 * IN)), tolerance: IN / 4, grade: IN / 2 },
    { code: 'G', name: 'Armhole (straight)', howToMeasure: 'Straight line from the shoulder point to the armpit', value: perSide((s) => Math.hypot(sp[s].underarm.x - sp[s].shoulder.x, sp[s].underarm.y - sp[s].shoulder.y)), tolerance: IN / 4, grade: IN / 4 },
    { code: 'H', name: 'Chest', howToMeasure: '2.5 cm (1 in) below the armpits, side to side', value: r1(widthAt(body, armpitY + IN)), tolerance: IN / 2, grade: IN },
    { code: 'I', name: 'Waist', howToMeasure: '20 cm (8 in) below the armpits, side to side', value: r1(widthAt(body, armpitY + 8 * IN)), tolerance: IN / 2, grade: IN },
    { code: 'J', name: 'Hem width', howToMeasure: 'Across the bottom opening, side seam to side seam, relaxed', value: r1(p.left.hemHalf + p.right.hemHalf), tolerance: IN / 2, grade: IN },
    { code: 'K', name: 'Body length from HPS', howToMeasure: 'From the HPS straight down to the hem', value: perSide((s) => (lowestAtX(front, (s === 'left' ? 1 : -1) * hps) ?? p.core.bodyLength)), tolerance: IN / 2, grade: IN },
    { code: 'L', name: 'Centre front length', howToMeasure: 'From the HPS line down the centre to the hem', value: r1(p.core.bodyLength), tolerance: IN / 2, grade: IN },
    { code: 'M', name: 'Sleeve length', howToMeasure: 'From the shoulder point along the top of the sleeve to the hem', value: perSide((s) => p[s].sleeveLength), tolerance: IN / 4, grade: IN / 2 },
    { code: 'N', name: 'Bicep (upper arm)', howToMeasure: '2.5 cm (1 in) below the armpit, across the sleeve', value: perSide(bicep), tolerance: IN / 4, grade: IN / 2 },
    { code: 'O', name: 'Sleeve opening', howToMeasure: 'Across the sleeve hem, flat, relaxed', value: perSide((s) => p[s].sleeveOpening), tolerance: IN / 8, grade: IN / 4 },
  ];
  // Drop measurements that don't apply to this shape (e.g. sleeveless, or a crop too short for a waist).
  return poms.filter((m) => {
    const v = Array.isArray(m.value) ? Math.max(...m.value) : m.value;
    if (m.code === 'I' && armpitY + 8 * IN >= Math.min(sp.left.hemSide.y, sp.right.hemSide.y, p.core.bodyLength)) return false;
    if (m.code === 'F' && 5 * IN >= armpitY) return false;
    if ('MNO'.includes(m.code) && p.left.sleeveLength < 0.5 && p.right.sleeveLength < 0.5) return false;
    return v > 0;
  });
}

/** Value at another size: base value plus (steps from the base size) x grade. */
export function graded(m: Pom, size: Size, base: Size): number | [number, number] {
  const steps = SIZES.indexOf(size) - SIZES.indexOf(base);
  // Exact values; rounding happens only when displayed.
  const g = (v: number) => Math.max(0, v + steps * m.grade);
  return Array.isArray(m.value) ? [g(m.value[0]), g(m.value[1])] : g(m.value);
}

export type Unit = 'cm' | 'in';

export function formatMeasure(v: number | [number, number], unit: Unit): string {
  const one = (n: number) => (unit === 'cm' ? r1(n).toString() : (Math.round((n / IN) * 8) / 8).toString());
  return Array.isArray(v) ? `L ${one(v[0])} / R ${one(v[1])}` : one(v);
}

const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** The measurement spec as CSV, laid out like the templates' measurement tab. */
export function measurementCsv(p: TShirtParams, opts: { styleName: string; base: Size; unit: Unit }): string {
  const poms = pointsOfMeasure(p);
  const rows: string[][] = [
    ['Style', opts.styleName],
    ['Base (sample) size', opts.base],
    ['Unit', opts.unit],
    ['Finished garment measurements, laid flat. L / R = wearer\'s left / right where the sides differ.'],
    [],
    ['POM', 'Point of measure', 'How to measure', ...SIZES, `Grade (${opts.unit})`, `Tolerance +/- (${opts.unit})`],
    ...poms.map((m) => [
      m.code,
      m.name,
      m.howToMeasure,
      ...SIZES.map((s) => formatMeasure(graded(m, s, opts.base), opts.unit)),
      formatMeasure(m.grade, opts.unit),
      formatMeasure(m.tolerance, opts.unit),
    ]),
  ];
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}
