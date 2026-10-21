import { describe, expect, it } from 'vitest';
import { applyProposal } from '../src/ai/proposal';
import { interpretOffline } from '../src/ai/offline';
import { validateParams } from '../src/model/validate';
import { buildGarmentMesh } from '../src/geometry/mesh3d';
import { applyHandleDrag, getHandles } from '../src/geometry/handles';

describe('proposal validation', () => {
  it('rejects non-objects safely', () => {
    for (const bad of [null, undefined, 42, 'tee', [1, 2]]) expect(applyProposal(bad).ok).toBe(false);
  });

  it('clamps out-of-range values and reports each one', () => {
    const r = applyProposal({ core: { bodyLength: 500, neckWidth: -3 }, left: { sleeveLength: 9999 } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.params.core.bodyLength).toBe(120);
    expect(r.params.left.sleeveLength).toBe(85);
    expect(r.notes.some((n) => n.includes('Body length'))).toBe(true);
    expect(r.notes.some((n) => n.includes('Sleeve length'))).toBe(true);
    expect(validateParams(r.params)).toEqual([]);
  });

  it('ignores wrong types and unknown enums, with notes', () => {
    const r = applyProposal({ core: { bodyLength: 'long', neckStyle: 'turtleneck', hemStyle: 42 }, left: { chestHalf: Number.NaN } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.params.core.bodyLength).toBe(70);
    expect(r.params.core.neckStyle).toBe('crew');
    expect(r.notes.length).toBeGreaterThanOrEqual(3);
  });

  it('repairs fixable conflicts and explains the repair', () => {
    const r = applyProposal({ core: { neckWidth: 44, bodyLength: 40 }, left: { shoulderHalf: 20, armholeDepth: 45 } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.notes.some((n) => n.startsWith('Neck width reduced'))).toBe(true);
    expect(r.notes.some((n) => n.startsWith('Armhole depth'))).toBe(true);
    expect(validateParams(r.params)).toEqual([]);
  });

  it('refuses geometry it cannot draw instead of crashing', () => {
    // The hem ends above where any armpit could sit.
    const r = applyProposal({ core: { bodyLength: 25 }, left: { hemOffset: -20, shoulderDrop: 0 } });
    expect(r.ok).toBe(false);
  });

  it('raises sleeves that would overlap the body, and says so', () => {
    const r = applyProposal({ left: { sleeveAngle: 80, sleeveLength: 60, sleeveOpening: 30 } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.params.left.sleeveAngle).toBeLessThan(80);
    expect(r.notes.some((n) => n.startsWith('Sleeve angle'))).toBe(true);
    expect(validateParams(r.params)).toEqual([]);
  });

  it('preserves an unusual but valid asymmetric proposal exactly', () => {
    const left = { chestHalf: 30, hemHalf: 34, hemOffset: 18, shoulderHalf: 36, shoulderDrop: 1, armholeDepth: 24, sleeveLength: 10, sleeveOpening: 26, sleeveAngle: 10 };
    const right = { ...left, hemOffset: -14, sleeveLength: 40 };
    const r = applyProposal({ name: 'Asym', core: { bodyLength: 60, hemStyle: 'straight' }, left, right, unsupported: ['pocket'] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.params.left).toEqual(left);
    expect(r.params.right).toEqual(right);
    expect(r.params.mirror).toBe(false);
    expect(r.notes).toEqual([]);
    expect(r.unsupported).toEqual(['pocket']);
  });

  it('generated concepts remain editable (drag + 3D)', () => {
    const r = applyProposal(interpretOffline('cropped boxy tee with wide sleeves'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const h = getHandles(r.params, 'front').find((x) => x.id === 'hemCenter')!;
    const edited = applyHandleDrag(r.params, h, { x: 0, y: 55 }, 'front');
    expect(edited.core.bodyLength).toBe(55);
    expect(validateParams(edited)).toEqual([]);
    expect(buildGarmentMesh(edited).indices.length).toBeGreaterThan(0);
  });
});

describe('offline interpreter', () => {
  const run = (prompt: string) => {
    const r = applyProposal(interpretOffline(prompt));
    if (!r.ok) throw new Error(r.error);
    return r;
  };

  it('handles the PRD example prompts with visibly distinct results', () => {
    const a = run('An oversized boxy tee with dropped shoulders, short wide sleeves and a deep but narrow neckline.');
    expect(a.params.left.chestHalf).toBeGreaterThan(30);
    expect(a.params.left.shoulderHalf).toBeGreaterThan(a.params.left.chestHalf);
    expect(a.params.left.sleeveOpening).toBeGreaterThanOrEqual(30);
    expect(a.params.core.neckDepthFront).toBeGreaterThanOrEqual(20);
    expect(a.params.core.neckWidth).toBeLessThan(16);

    const b = run('A cropped asymmetric T-shirt with exaggerated shoulder proportions and a longer left hem.');
    expect(b.params.core.bodyLength).toBeLessThan(55);
    expect(b.params.left.hemOffset).toBeGreaterThan(b.params.right.hemOffset);
    expect(b.params.mirror).toBe(false);
    expect(b.params.left.shoulderHalf).toBeGreaterThan(35);

    const c = run('A heavyweight-looking tee with a high neckline and an unusually broad body.');
    expect(c.params.core.neckDepthFront).toBeLessThanOrEqual(5);
    expect(c.params.left.chestHalf).toBeGreaterThan(35);
    expect(c.unsupported.some((u) => u.includes('Fabric'))).toBe(true);
  });

  it('says so when it recognises nothing', () => {
    const r = run('something lovely');
    expect(r.summary).toMatch(/did not recognise/);
  });
});
