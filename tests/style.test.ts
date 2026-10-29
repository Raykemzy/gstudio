import { ribShadeOf, withBodyColour } from '../src/model/style';
import { buildBodyOutline, buildOutline, sidePoints } from '../src/geometry/outline';
import { pointInPolygon } from '../src/geometry/polygon';
import { SCHEMA_VERSION } from '../src/model/design';
import { newDesign } from '../src/model/design';
import { describe, expect, it } from 'vitest';
import { defaultParams, cloneParams, type TShirtParams } from '../src/model/schema';
import { PANEL_TEMPLATES, fromModel, toModel, styleSchema, type Panel } from '../src/model/style';
import { flatView, panelFrame, panelModelPoints } from '../src/render/layers';
import { buildExportSvg } from '../src/render/exportImage';
import { parseDesign, serializeDesign } from '../src/state/designFile';
import { buildGarmentMesh } from '../src/geometry/mesh3d';

function withPanel(p: TShirtParams, templateId: string, extra: Partial<Panel> = {}): TShirtParams {
  const t = PANEL_TEMPLATES.find((x) => x.id === templateId)!;
  const next = cloneParams(p);
  next.style.panels.push({ id: templateId, name: t.name, surface: 'front', points: t.points, curved: t.curved, mirrored: t.mirrored, seam: true, area: t.area, fill: { color: '#121214' }, ...extra });
  return next;
}

describe('garment-relative panel coordinates', () => {
  it('round-trips between model and panel coordinates on both sides', () => {
    const f = panelFrame(defaultParams());
    for (const pt of [[0.5, 0.3], [-0.8, 0.9], [1.4, -0.2], [0, 1]] as [number, number][]) {
      const back = fromModel(toModel(pt, f), f);
      expect(back[0]).toBeCloseTo(pt[0]);
      expect(back[1]).toBeCloseTo(pt[1]);
    }
  });

  it('panels follow the garment when it is resized', () => {
    const p = withPanel(defaultParams(), 'side-curve');
    const before = panelModelPoints(p.style.panels[0], panelFrame(p));
    const wider = cloneParams(p);
    wider.left.chestHalf *= 1.5;
    wider.core.bodyLength *= 1.2;
    const after = panelModelPoints(wider.style.panels[0], panelFrame(wider));
    after.forEach((a, i) => {
      expect(a.x).toBeCloseTo(before[i].x * 1.5);
      expect(a.y).toBeCloseTo(before[i].y * 1.2);
    });
  });
});

describe('flat views', () => {
  it('draws body, sleeves, rib, seams and outline in order, with the outline on top', () => {
    const v = flatView(defaultParams(), 'front');
    expect(v.layers[0].kind).toBe('body');
    expect(v.layers.at(-1)!.kind).toBe('outline');
    expect(v.layers.filter((l) => l.kind === 'sleeve')).toHaveLength(2);
    expect(v.layers.some((l) => l.kind === 'rib')).toBe(true);
  });

  it('uses the chosen colours', () => {
    const p = defaultParams();
    p.style.body.color = '#121214';
    p.style.sleeves.color = '#5b5e3c';
    const v = flatView(p, 'front');
    expect(v.layers[0].fill).toBe('#121214');
    expect(v.layers.filter((l) => l.kind === 'sleeve').every((l) => l.fill === '#5b5e3c')).toBe(true);
  });

  it('a mirrored panel is drawn twice, a single one once; panels only show on their own surface', () => {
    const mirrored = flatView(withPanel(defaultParams(), 'side-curve'), 'front').layers.filter((l) => l.kind === 'panel');
    expect(mirrored).toHaveLength(2);
    expect(mirrored.map((l) => l.mirrorCopy)).toEqual([false, true]);
    const single = withPanel(defaultParams(), 'yoke');
    expect(flatView(single, 'front').layers.filter((l) => l.kind === 'panel')).toHaveLength(1);
    expect(flatView(single, 'back').layers.filter((l) => l.kind === 'panel')).toHaveLength(0);
  });

  it('panels and sleeves are clipped to the garment; the outline is not', () => {
    const v = flatView(withPanel(defaultParams(), 'hem-band'), 'front');
    for (const l of v.layers) {
      if (l.kind === 'panel' || l.kind === 'sleeve' || l.kind === 'rib') expect(l.clipped).toBe(true);
      if (l.kind === 'outline' || l.kind === 'body') expect(l.clipped).toBe(false);
    }
  });

  it('a sleeveless design has no sleeve layers', () => {
    const p = defaultParams();
    p.left.sleeveLength = p.right.sleeveLength = 0;
    expect(flatView(p, 'front').layers.some((l) => l.kind === 'sleeve')).toBe(false);
  });
});

describe('export and files', () => {
  it('exports front and back side by side in one image', () => {
    const svg = buildExportSvg(withPanel(defaultParams(), 'side-curve'), 'Test');
    expect(svg).toContain('FRONT');
    expect(svg).toContain('BACK');
    expect(svg).toContain('clip-front');
    expect(svg).toContain('clip-back');
    expect(svg).not.toMatch(/NaN|undefined/);
  });

  it('saves and reopens colours and panels exactly', () => {
    const p = withPanel(defaultParams(), 'diagonal', { surface: 'back' });
    p.style.body.color = '#2a2a2c';
    const r = parseDesign(serializeDesign(newDesign(p, 'styled')));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.design.params.style).toEqual(p.style);
  });

  it('opens version-1 files (from before colours existed) with the default look', () => {
    const v2 = JSON.parse(serializeDesign(newDesign(defaultParams(), 'old')));
    delete v2.params.style;
    v2.schemaVersion = 1;
    const r = parseDesign(JSON.stringify(v2));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.design.schemaVersion).toBe(SCHEMA_VERSION);
      expect(r.design.params.kind).toBe('tshirt');
      expect(r.design.params.style).toEqual(defaultParams().style);
    }
  });

  it('rejects malformed styles', () => {
    const bad = [
      { ...defaultParams().style, body: { color: 'red' } },
      { ...defaultParams().style, panels: [{ id: 'x', name: 'x', surface: 'side', points: [[0, 0], [1, 1], [0, 1]], curved: true, mirrored: false, seam: true, area: 'body', fill: { color: '#000000' } }] },
      { ...defaultParams().style, panels: [{ id: 'x', name: 'x', surface: 'front', points: [[0, 0], [1, 1]], curved: true, mirrored: false, seam: true, area: 'body', fill: { color: '#000000' } }] },
    ];
    for (const s of bad) expect(styleSchema.safeParse(s).success).toBe(false);
  });
});

describe('3D texture coordinates', () => {
  it('every vertex has a UV inside 0..1, and front triangles come first', () => {
    const m = buildGarmentMesh(defaultParams());
    expect(m.uvs.length).toBe((m.vertexCount * 2));
    for (const u of m.uvs) expect(u >= 0 && u <= 1).toBe(true);
    expect(m.frontIndexCount).toBeGreaterThan(0);
    expect(m.frontIndexCount).toBeLessThan(m.indices.length);
    for (let i = 0; i < m.frontIndexCount; i++) expect(m.indices[i]).toBeLessThan(m.vertexCount / 2);
  });
});

describe('panel areas', () => {
  it('"keep off the sleeves" panels clip to the body; whole-garment panels to the full outline', () => {
    const p = withPanel(withPanel(defaultParams(), 'side-curve'), 'yoke');
    const v = flatView(p, 'front');
    const panels = v.layers.filter((l) => l.kind === 'panel');
    expect(panels.filter((l) => l.panelId === 'side-curve').every((l) => l.bodyOnly)).toBe(true);
    expect(panels.filter((l) => l.panelId === 'yoke').every((l) => !l.bodyOnly)).toBe(true);
    // A point in the middle of a sleeve is inside the garment but outside the body-only shape.
    const sp = sidePoints(p as TShirtParams, 'left');
    const midSleeve = { x: (sp.shoulder.x + sp.sleeveTop.x + sp.sleeveBottom.x + sp.underarm.x) / 4, y: (sp.shoulder.y + sp.sleeveTop.y + sp.sleeveBottom.y + sp.underarm.y) / 4 };
    expect(pointInPolygon(midSleeve, buildOutline(p as TShirtParams, 'front').polygon)).toBe(true);
    expect(pointInPolygon(midSleeve, buildBodyOutline(p as TShirtParams, 'front'))).toBe(false);
    expect(v.bodyClip).not.toBe(v.clip);
  });
});

describe('armhole seam', () => {
  it('can be turned off; files saved before the option existed keep the seam', () => {
    const p = defaultParams();
    const seams = (q: TShirtParams) => flatView(q, 'front').layers.filter((l) => l.kind === 'seam').length;
    const withSeam = seams(p);
    p.style.armholeSeam = false;
    expect(withSeam - seams(p)).toBe(2); // exactly the two armhole seams go
    const old = JSON.parse(serializeDesign(newDesign(defaultParams(), 'x')));
    delete old.params.style.armholeSeam;
    const r = parseDesign(JSON.stringify(old));
    expect(r.ok && r.design.params.style.armholeSeam).toBe(true);
  });
});

describe('colour linking', () => {
  it('sleeves and rib follow the body colour until they are set separately', () => {
    const base = defaultParams().style;
    const black = withBodyColour(base, '#121214');
    expect(black.sleeves.color).toBe('#121214');
    expect(black.rib.color).toBe(ribShadeOf('#121214'));
    // Set the sleeves separately: they no longer follow, the rib still does.
    const custom = withBodyColour({ ...black, sleeves: { color: '#b3261e' } }, '#e9dfc9');
    expect(custom.sleeves.color).toBe('#b3261e');
    expect(custom.rib.color).toBe(ribShadeOf('#e9dfc9'));
  });
});
