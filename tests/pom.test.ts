import { describe, expect, it } from 'vitest';
import { defaultParams } from '../src/model/schema';
import type { TShirtParams } from '../src/model/schema';
import { PRESETS } from '../src/model/presets';
import { formatMeasure, graded, measurementCsv, pointsOfMeasure, SIZES, type Pom } from '../src/model/pom';

const byCode = (poms: Pom[], code: string) => poms.find((m) => m.code === code)!;

describe('points of measure', () => {
  const poms = pointsOfMeasure(defaultParams());

  it('matches hand-calculated values for the classic tee', () => {
    // Classic tee: neck 18, shoulders 2 x 23, chest/hem 2 x 26, straight side seams, flat hem at 70.
    expect(byCode(poms, 'A').value).toBe(18);
    expect(byCode(poms, 'D').value).toBe(46);
    expect(byCode(poms, 'H').value).toBe(52); // side seams are vertical, so 2.5 cm lower is the same width
    expect(byCode(poms, 'J').value).toBe(52);
    expect(byCode(poms, 'K').value).toBe(70);
    expect(byCode(poms, 'M').value).toBe(20);
    expect(byCode(poms, 'O').value).toBe(17);
    // Armhole straight: shoulder point (23, 4.5) to armpit (26, 24.5).
    expect(byCode(poms, 'G').value).toBeCloseTo(Math.hypot(3, 20), 1);
    // Across front at 12.7 cm: armhole seam x = 23 + 3 * (12.7 - 4.5) / 20, both sides.
    expect(byCode(poms, 'F').value).toBeCloseTo(2 * (23 + (3 * 8.2) / 20), 1);
    const bicep = byCode(poms, 'N').value as number;
    expect(bicep).toBeGreaterThan(14);
    expect(bicep).toBeLessThan(22);
  });

  it('measures chest below the armpit, so a flared body reads wider than at the armpit', () => {
    const p = defaultParams();
    p.left.hemHalf = p.right.hemHalf = 40; // A-line
    const chest = byCode(pointsOfMeasure(p), 'H').value as number;
    expect(chest).toBeGreaterThan(52);
  });

  it('reports left and right separately on asymmetric designs', () => {
    const asym = pointsOfMeasure((PRESETS.find((x) => x.id === 'asymmetric')!.params() as TShirtParams));
    const length = byCode(asym, 'K').value;
    expect(Array.isArray(length)).toBe(true);
    const [l, r] = length as [number, number];
    expect(l).toBeGreaterThan(r); // longer on the wearer's left
    expect(Array.isArray(byCode(asym, 'M').value)).toBe(true); // uneven sleeves
  });

  it('leaves out measurements that do not apply', () => {
    const sleeveless = pointsOfMeasure((PRESETS.find((x) => x.id === 'muscle')!.params() as TShirtParams));
    expect(sleeveless.some((m) => 'MNO'.includes(m.code))).toBe(false);
    const crop = pointsOfMeasure((PRESETS.find((x) => x.id === 'cropped')!.params() as TShirtParams)); // 48 cm long, armpit at 29 cm
    expect(crop.some((m) => m.code === 'I')).toBe(false); // too short for a waist 20 cm below the armpit
  });

  it('every preset produces finite, positive measurements', () => {
    for (const pr of PRESETS)
      for (const m of pointsOfMeasure((pr.params() as TShirtParams))) for (const v of [m.value].flat()) expect(Number.isFinite(v) && v > 0, `${pr.id} ${m.code}`).toBe(true);
  });
});

describe('grading and output', () => {
  it('grades from the base size by the step', () => {
    const chest = byCode(pointsOfMeasure(defaultParams()), 'H');
    expect(graded(chest, 'M', 'M')).toBe(52);
    expect(graded(chest, 'XL', 'M')).toBeCloseTo(52 + 2 * 2.54, 5);
    expect(graded(chest, 'XS', 'M')).toBeCloseTo(52 - 2 * 2.54, 5);
  });

  it('formats cm and inches (to the nearest 1/8)', () => {
    expect(formatMeasure(52, 'cm')).toBe('52');
    expect(formatMeasure(50.8, 'in')).toBe('20');
    expect(formatMeasure([30, 28], 'cm')).toBe('L 30 / R 28');
  });

  it('writes a spreadsheet with one row per measurement and every size', () => {
    const csv = measurementCsv(pointsOfMeasure(defaultParams()), { styleName: 'Test, "tee"', base: 'M', unit: 'cm' });
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('Style,"Test, ""tee"""');
    const header = lines.find((l) => l.startsWith('POM,'))!;
    for (const s of SIZES) expect(header).toContain(s);
    expect(lines.filter((l) => /^[A-O],/.test(l)).length).toBe(pointsOfMeasure(defaultParams()).length);
  });
});
