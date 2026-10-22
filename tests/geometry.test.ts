import { PRESETS } from '../src/model/presets';
import { describe, expect, it } from 'vitest';
import { cloneParams, defaultParams, type TShirtParams } from '../src/model/schema';
import { validateParams } from '../src/model/validate';
import { buildOutline } from '../src/geometry/outline';
import { applyHandleDrag, getHandles } from '../src/geometry/handles';
import { buildGarmentMesh } from '../src/geometry/mesh3d';
import { bounds, findSelfIntersection, type Vec } from '../src/geometry/polygon';

function meshBounds(p: TShirtParams) {
  const m = buildGarmentMesh(p);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < m.positions.length; i += 3) {
    minX = Math.min(minX, m.positions[i]); maxX = Math.max(maxX, m.positions[i]);
    minY = Math.min(minY, m.positions[i + 1]); maxY = Math.max(maxY, m.positions[i + 1]);
    maxZ = Math.max(maxZ, m.positions[i + 2]);
  }
  return { minX, maxX, minY, maxY, maxZ, triangles: m.indices.length / 3 };
}

describe('outline', () => {
  it('default and all presets are valid, simple polygons', () => {
    for (const pr of PRESETS) {
      const p = pr.params();
      expect(validateParams(p), pr.name).toEqual([]);
      expect(findSelfIntersection(buildOutline(p).polygon)).toBeNull();
    }
  });

  it('widening the body moves the underarms outward', () => {
    const p = defaultParams();
    const before = buildOutline(p).sides.left.underarm.x;
    p.left.chestHalf += 5;
    p.right.chestHalf += 5;
    const o = buildOutline(p);
    expect(o.sides.left.underarm.x).toBeCloseTo(before + 5);
    expect(o.sides.right.underarm.x).toBeCloseTo(-(before + 5));
  });

  it('neck depth moves the front neck centre but not the back', () => {
    const p = defaultParams();
    p.core.neckDepthFront = 20;
    expect(buildOutline(p, 'front').neckCenter.y).toBeCloseTo(20);
    expect(buildOutline(p, 'back').neckCenter.y).toBeCloseTo(p.core.neckDepthBack);
  });

  it('every neckline style produces a valid outline', () => {
    for (const style of ['crew', 'scoop', 'v', 'square', 'boat'] as const) {
      const p = defaultParams();
      p.core.neckStyle = style;
      p.core.neckDepthFront = 15;
      expect(validateParams(p), style).toEqual([]);
    }
  });

  it('asymmetric hems are preserved, not normalised', () => {
    const p = PRESETS.find((x) => x.id === 'asymmetric')!.params();
    const o = buildOutline(p);
    expect(o.sides.left.hemSide.y).toBeGreaterThan(o.sides.right.hemSide.y + 20);
  });
});

describe('2D and 3D stay in sync', () => {
  it('3D width and height follow the 2D outline bounds', () => {
    for (const pr of PRESETS) {
      const p = pr.params();
      const b2 = bounds(buildOutline(p, 'outer').polygon);
      const b3 = meshBounds(p);
      expect(b3.minX).toBeCloseTo(b2.minX, 1);
      expect(b3.maxX).toBeCloseTo(b2.maxX, 1);
      expect(-b3.minY).toBeCloseTo(b2.maxY, 1);
      expect(b3.triangles).toBeGreaterThan(500);
    }
  });

  it('a body-length change updates both views by the same amount', () => {
    const p = defaultParams();
    const before2 = bounds(buildOutline(p).polygon).maxY;
    const before3 = -meshBounds(p).minY;
    p.core.bodyLength += 12;
    expect(bounds(buildOutline(p).polygon).maxY - before2).toBeCloseTo(12, 5);
    expect(-meshBounds(p).minY - before3).toBeCloseTo(12, 1);
  });

  it('a sleeve-length change widens both views', () => {
    const p = defaultParams();
    const w2 = bounds(buildOutline(p).polygon).width;
    const w3 = meshBounds(p).maxX;
    p.left.sleeveLength = p.right.sleeveLength = 40;
    expect(bounds(buildOutline(p).polygon).width).toBeGreaterThan(w2 + 20);
    expect(meshBounds(p).maxX).toBeGreaterThan(w3 + 10);
  });

  it('the front neck hole removes front triangles; deeper neck removes more', () => {
    const p = defaultParams();
    const shallow = buildGarmentMesh(p).indices.length;
    p.core.neckDepthFront = 25;
    expect(buildGarmentMesh(p).indices.length).toBeLessThan(shallow);
  });
});

describe('direct manipulation', () => {
  const handle = (p: TShirtParams, id: string) => getHandles(p, 'front').find((h) => h.id === id)!;
  const drag = (p: TShirtParams, id: string, to: Vec) => applyHandleDrag(p, handle(p, id), to, 'front');

  it('handles sit on the outline points they represent', () => {
    const p = defaultParams();
    const o = buildOutline(p);
    expect(handle(p, 'underarm:left').pos).toEqual(o.sides.left.underarm);
    expect(handle(p, 'hemCenter').pos).toEqual(o.hemCenter);
  });

  it('dragging a handle updates the parameters, and the handle follows the pointer', () => {
    const p = defaultParams();
    const next = drag(p, 'underarm:left', { x: 30, y: 28 });
    expect(next.left.chestHalf).toBe(30);
    expect(next.left.armholeDepth).toBeCloseTo(28 - p.left.shoulderDrop);
    expect(handle(next, 'underarm:left').pos).toEqual({ x: 30, y: 28 });
    // mirror mode copies to the other side
    expect(next.right.chestHalf).toBe(30);
    // the original is untouched
    expect(p.left.chestHalf).toBe(26);
  });

  it('dragging without mirror only changes one side', () => {
    const p = defaultParams();
    p.mirror = false;
    const next = drag(p, 'hemSide:right', { x: -20, y: 85 });
    expect(next.right.hemHalf).toBe(20);
    expect(next.right.hemOffset).toBe(15);
    expect(next.left).toEqual(p.left);
  });

  it('sleeve end drag sets length and angle', () => {
    const p = defaultParams();
    const sp = handle(p, 'shoulder:left').pos;
    const next = drag(p, 'sleeveEnd:left', { x: sp.x + 30, y: sp.y });
    expect(next.left.sleeveLength).toBeCloseTo(30);
    expect(next.left.sleeveAngle).toBeCloseTo(0);
    const right = drag(cloneParams(p), 'sleeveEnd:right', { x: -sp.x - 30, y: sp.y + 30 });
    expect(right.right.sleeveAngle).toBeCloseTo(45);
  });

  it('extreme drags are clamped to field ranges, never NaN', () => {
    const p = defaultParams();
    const next = drag(p, 'hemCenter', { x: 0, y: 1e9 });
    expect(next.core.bodyLength).toBe(120);
    const n2 = drag(p, 'sleeveEnd:left', { x: Number.NaN, y: 5 });
    for (const v of Object.values(n2.left)) expect(Number.isFinite(v)).toBe(true);
  });

  it('a drag that would cross the outline over itself is reported as invalid', () => {
    const p = defaultParams();
    p.left.sleeveAngle = p.right.sleeveAngle = 75;
    p.left.sleeveLength = p.right.sleeveLength = 60;
    p.left.sleeveOpening = p.right.sleeveOpening = 25;
    const issues = validateParams(p);
    expect(issues.length).toBeGreaterThan(0);
  });
});
