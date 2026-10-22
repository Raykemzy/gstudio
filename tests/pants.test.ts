import { describe, expect, it } from 'vitest';
import { pantsDefaults, pantsOutline, PANTS_CORE_FIELDS, PANTS_SIDE_FIELDS, type PantsParams } from '../src/garments/pants';
import { dragHandle, garmentHandles, garmentPoms, validateDesign } from '../src/garments';
import { PRESETS } from '../src/model/presets';
import { newDesign } from '../src/model/design';
import { parseDesign, serializeDesign } from '../src/state/designFile';
import { flatView } from '../src/render/layers';
import { buildGarmentMesh } from '../src/geometry/mesh3d';
import { buildExportSvg } from '../src/render/exportImage';
import { bounds, findSelfIntersection } from '../src/geometry/polygon';
import type { Pom } from '../src/model/pom';

const preset = (id: string) => PRESETS.find((p) => p.id === id)!.params() as PantsParams;
const pom = (poms: Pom[], name: string) => poms.find((m) => m.name === name);

describe('pants shape', () => {
  it('default pants are valid, with the legs meeting at the crotch', () => {
    const p = pantsDefaults();
    expect(validateDesign(p)).toEqual([]);
    const o = pantsOutline(p);
    expect(o).toContainEqual({ x: 0, y: p.core.rise });
    expect(bounds(o).maxY).toBeCloseTo(p.core.rise + p.left.inseam, 5);
  });

  it('shorts are just pants with a short inseam', () => {
    const p = preset('shorts');
    expect(p.kind).toBe('pants');
    expect(bounds(pantsOutline(p)).maxY).toBeCloseTo(p.core.rise + 18, 5);
  });

  it('refuses legs that would cross the middle', () => {
    const p = pantsDefaults();
    p.left.legSplay = p.right.legSplay = -15;
    p.left.legOpening = p.right.legOpening = 40;
    expect(validateDesign(p).map((i) => i.rule)).toContain('legs-overlap');
  });

  it('refuses a waistband taller than the rise', () => {
    const p = pantsDefaults();
    p.core.rise = 15;
    p.core.waistbandHeight = 10;
    expect(validateDesign(p)[0].rule).toBe('band-too-tall');
  });
});

describe('pants dots', () => {
  const handle = (p: PantsParams, id: string) => garmentHandles(p, 'front').find((h) => h.id === id)!;

  it('dropping any dot where it already is changes nothing', () => {
    for (const id of ['straight-pants', 'baggy-cargo', 'jogger', 'flare', 'shorts', 'cargo-shorts']) {
      const p = preset(id);
      for (const surface of ['front', 'back'] as const)
        for (const h of garmentHandles(p, surface)) {
          const after = dragHandle(p, h, h.pos, surface) as PantsParams;
          for (const part of ['core', 'left', 'right'] as const)
            for (const [k, v] of Object.entries(after[part]))
              if (typeof v === 'number') expect(v, `${id} ${h.id} ${part}.${k}`).toBeCloseTo((p[part] as Record<string, number>)[k], 6);
        }
    }
  });

  it('each dot changes what its label says', () => {
    const p = pantsDefaults();
    const drag = (id: string, to: { x: number; y: number }) => dragHandle(p, handle(p, id), to, 'front') as PantsParams;
    expect(drag('waist:left', { x: 25, y: 0 }).core.waistWidth).toBe(50);
    expect(drag('crotch', { x: 0, y: 34 }).core.rise).toBe(34);
    expect(drag('thigh:left', { x: 36, y: 29 }).left.thighWidth).toBe(36);
    const hem = handle(p, 'hemOuter:left').pos;
    const longer = drag('hemOuter:left', { x: hem.x, y: hem.y + 5 });
    expect(longer.left.inseam).toBe(p.left.inseam + 5);
    expect(longer.right.inseam).toBe(p.right.inseam + 5); // symmetric: both legs
  });

  it('asymmetric pants: dragging one leg leaves the other alone', () => {
    const p = pantsDefaults();
    p.mirror = false;
    const hem = handle(p, 'hemOuter:right').pos;
    const next = dragHandle(p, handle(p, 'hemOuter:right'), { x: hem.x, y: hem.y - 40 }, 'front') as PantsParams;
    expect(next.right.inseam).toBe(p.right.inseam - 40);
    expect(next.left).toEqual(p.left);
  });
});

describe('pants drawing, 3D and files', () => {
  it('draws the waistband, fly, back pockets, cargo pockets and elastic cuffs when switched on', () => {
    const cargo = preset('cargo-jogger');
    const front = flatView(cargo, 'front').layers;
    expect(front.filter((l) => l.kind === 'rib').length).toBe(3); // waistband + two cuffs
    expect(front.filter((l) => l.fill === cargo.style.body.color && l.kind === 'seam').length).toBe(4); // 2 pockets + 2 flaps
    const straight = preset('straight-pants');
    expect(flatView(straight, 'front').layers.some((l) => l.dashed && l.kind === 'seam')).toBe(true); // fly / hem stitching
    expect(flatView(straight, 'back').layers.filter((l) => l.kind === 'seam' && l.d.split('L').length === 5).length).toBe(2); // two 5-point back pockets
  });

  it('every pants and shorts preset builds a 3D form matching its 2D outline', () => {
    for (const pr of PRESETS.filter((x) => x.params().kind === 'pants')) {
      const p = pr.params();
      const m = buildGarmentMesh(p);
      let minX = Infinity, maxX = -Infinity, minY = Infinity;
      for (let i = 0; i < m.positions.length; i += 3) {
        minX = Math.min(minX, m.positions[i]); maxX = Math.max(maxX, m.positions[i]); minY = Math.min(minY, m.positions[i + 1]);
      }
      const b = bounds(pantsOutline(p as PantsParams));
      expect(minX, pr.id).toBeCloseTo(b.minX, 1);
      expect(maxX, pr.id).toBeCloseTo(b.maxX, 1);
      expect(-minY, pr.id).toBeCloseTo(b.maxY, 1);
      expect(m.ribs.front.length).toBe(0);
    }
  });

  it('saves and reopens pants exactly; exports without errors', () => {
    const p = preset('baggy-cargo');
    p.style.body.color = '#5b5e3c';
    const r = parseDesign(serializeDesign(newDesign(p, 'cargo')));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.design.garmentType).toBe('pants');
      expect(r.design.params).toEqual(p);
      expect(r.warnings).toEqual([]);
    }
    expect(buildExportSvg(p, 'cargo')).not.toMatch(/NaN|undefined/);
  });

  it('rejects a file whose garment type does not match its parameters', () => {
    const d = JSON.parse(serializeDesign(newDesign(pantsDefaults(), 'x')));
    d.garmentType = 'tshirt';
    expect(parseDesign(JSON.stringify(d)).ok).toBe(false);
  });
});

describe('pants measurements', () => {
  it('matches hand-calculated values for straight pants', () => {
    const p = pantsDefaults();
    const poms = garmentPoms(p);
    expect(pom(poms, 'Waist')!.value).toBe(40);
    expect(pom(poms, 'Front rise')!.value).toBe(29);
    expect(pom(poms, 'Inseam')!.value).toBe(79);
    expect(pom(poms, 'Leg opening')!.value).toBe(20);
    // Thigh 2.5 cm below the crotch: a little narrower than the 27 cm leg at the crotch (legs taper).
    const thigh = pom(poms, 'Thigh')!.value as number;
    expect(thigh).toBeLessThan(27);
    expect(thigh).toBeGreaterThan(24);
    // Outseam runs from the waist corner down the side: longer than rise + inseam straight down.
    expect(pom(poms, 'Outseam')!.value as number).toBeGreaterThan(29 + 79);
  });

  it('shorts have no knee measurement; asymmetric legs report left and right', () => {
    expect(pom(garmentPoms(preset('shorts')), 'Knee')).toBeUndefined();
    const p = pantsDefaults();
    p.mirror = false;
    p.right.inseam = 20;
    expect(pom(garmentPoms(p), 'Inseam')!.value).toEqual([79, 20]);
  });
});

describe('pants stress', () => {
  it('random pants never crash; valid ones have simple outlines and finite 3D', () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    let valid = 0;
    for (let i = 0; i < 400; i++) {
      const p = pantsDefaults();
      for (const [k, s] of Object.entries(PANTS_CORE_FIELDS)) (p.core as unknown as Record<string, number>)[k] = s.min + rand() * (s.max - s.min);
      for (const side of ['left', 'right'] as const)
        for (const [k, s] of Object.entries(PANTS_SIDE_FIELDS)) (p[side] as Record<string, number>)[k] = s.min + rand() * (s.max - s.min);
      p.mirror = false;
      p.core.cargoPockets = rand() < 0.5;
      p.core.cuffStyle = rand() < 0.5 ? 'elastic' : 'plain';
      const issues = validateDesign(p);
      if (issues.length) continue;
      valid++;
      expect(findSelfIntersection(pantsOutline(p))).toBeNull();
      for (const l of flatView(p, 'front').layers) expect(l.d).not.toMatch(/NaN|Infinity/);
      if (valid <= 25) {
        const m = buildGarmentMesh(p);
        for (const v of m.positions) expect(Number.isFinite(v)).toBe(true);
      }
    }
    expect(valid).toBeGreaterThan(20);
  });
});
