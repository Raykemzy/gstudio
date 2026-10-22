import { newDesign } from '../src/model/design';
/**
 * Stress tests: thousands of random designs and random editing sessions, checked
 * against rules that must always hold. Seeded, so any failure reproduces exactly.
 *
 *   npm test                          quick run (part of the normal suite)
 *   STRESS_SCALE=50 npx vitest run tests/stress.test.ts    heavy run
 */
import { describe, expect, it } from 'vitest';
import {
  CORE_FIELDS,
  CORE_KEYS,
  HEM_STYLES,
  NECK_STYLES,
  SIDE_FIELDS,
  SIDE_KEYS,
  cloneParams,
  
  paramsEqual,
  type FieldSpec,
  type TShirtParams,
} from '../src/model/schema';
import { PRESETS } from '../src/model/presets';
import { validateParams } from '../src/model/validate';
import { buildOutline, type NeckSurface } from '../src/geometry/outline';
import { applyHandleDrag, getHandles } from '../src/geometry/handles';
import { buildGarmentMesh } from '../src/geometry/mesh3d';
import { bounds, findSelfIntersection } from '../src/geometry/polygon';
import { buildExportSvg } from '../src/render/exportImage';
import { parseDesign, serializeDesign } from '../src/state/designFile';
import { History } from '../src/state/history';
import { applyProposal } from '../src/ai/proposal';
import { PANEL_TEMPLATES, SWATCHES, styleSchema, type GarmentStyle } from '../src/model/style';
import { flatView } from '../src/render/layers';

const SCALE = Number(process.env.STRESS_SCALE ?? 1);
const n = (base: number) => Math.max(1, Math.round(base * SCALE));
const LONG = 120_000 * Math.max(1, SCALE); // ms; these tests do real 3D builds

/** Small seeded PRNG (mulberry32): same seed, same sequence. */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)];
  /** Value on the field's step grid; one in five lands exactly on a range edge. */
  const field = (s: FieldSpec) => {
    const r = next();
    const v = r < 0.1 ? s.min : r < 0.2 ? s.max : s.min + next() * (s.max - s.min);
    return Math.min(s.max, Math.max(s.min, Math.round(v / s.step) * s.step));
  };
  return { next, pick, field };
}
type Rng = ReturnType<typeof rng>;

function randomStyle(r: Rng): GarmentStyle {
  const color = () => r.pick(SWATCHES).color;
  const panels = Array.from({ length: Math.floor(r.next() * 5) }, (_, i) => {
    const t = r.pick(PANEL_TEMPLATES);
    return {
      id: `p${i}`,
      name: t.name,
      surface: r.pick(['front', 'back'] as const),
      // Jitter the template so shapes vary, including points well outside the garment.
      points: t.points.map(([u, v]) => [u + (r.next() - 0.5) * 0.6, v + (r.next() - 0.5) * 0.4] as [number, number]),
      curved: r.next() < 0.5,
      mirrored: r.next() < 0.5,
      seam: r.next() < 0.7,
      area: r.pick(['body', 'whole'] as const),
      fill: { color: color() },
    };
  });
  return { body: { color: color() }, sleeves: { color: color() }, rib: { color: color() }, armholeSeam: r.next() < 0.5, panels };
}

function randomParams(r: Rng): TShirtParams {
  const side = () => Object.fromEntries(SIDE_KEYS.map((k) => [k, r.field(SIDE_FIELDS[k])])) as TShirtParams['left'];
  const left = side();
  const mirror = r.next() < 0.5;
  return {
    kind: 'tshirt',
    core: {
      ...(Object.fromEntries(CORE_KEYS.map((k) => [k, r.field(CORE_FIELDS[k])])) as Record<(typeof CORE_KEYS)[number], number>),
      neckStyle: r.pick(NECK_STYLES),
      hemStyle: r.pick(HEM_STYLES),
    },
    left,
    right: mirror ? { ...left } : side(),
    mirror,
    style: randomStyle(r),
  };
}

/** Walk away from a preset with random handle drags, keeping only valid steps (what the editor does). */
function randomWalk(r: Rng, start: TShirtParams, steps: number): TShirtParams {
  let p = start;
  for (let i = 0; i < steps; i++) {
    const surface: NeckSurface = r.next() < 0.5 ? 'front' : 'back';
    const h = r.pick(getHandles(p, surface));
    const next = applyHandleDrag(p, h, { x: h.pos.x + (r.next() - 0.5) * 30, y: h.pos.y + (r.next() - 0.5) * 30 }, surface);
    if (validateParams(next).length === 0) p = next;
  }
  return p;
}

const allFinite = (xs: ArrayLike<number>) => {
  for (let i = 0; i < xs.length; i++) if (!Number.isFinite(xs[i])) return false;
  return true;
};

/** The rules every valid design must satisfy. Returns a description of the first broken rule, or null. */
function checkValidDesign(p: TShirtParams): string | null {
  for (const surface of ['front', 'back'] as const) {
    const o = buildOutline(p, surface);
    if (!o.polygon.every((v) => Number.isFinite(v.x) && Number.isFinite(v.y))) return `${surface} outline has non-finite points`;
    if (findSelfIntersection(o.polygon)) return `${surface} outline crosses itself`;
  }

  const mesh = buildGarmentMesh(p);
  if (!allFinite(mesh.positions)) return '3D positions contain NaN/Infinity';
  if (mesh.indices.length < 300) return `3D mesh has too few triangles (${mesh.indices.length / 3})`;
  for (let i = 0; i < mesh.indices.length; i++) if (mesh.indices[i] >= mesh.vertexCount) return '3D index out of range';
  // 2D and 3D agree on width and length.
  const b2 = bounds(buildOutline(p, 'outer').polygon);
  let minX = Infinity, maxX = -Infinity, minY = Infinity;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    minX = Math.min(minX, mesh.positions[i]);
    maxX = Math.max(maxX, mesh.positions[i]);
    minY = Math.min(minY, mesh.positions[i + 1]);
  }
  if (Math.abs(minX - b2.minX) > 0.05 || Math.abs(maxX - b2.maxX) > 0.05 || Math.abs(-minY - b2.maxY) > 0.05)
    return `2D/3D disagree: 2D x[${b2.minX.toFixed(2)},${b2.maxX.toFixed(2)}] bottom ${b2.maxY.toFixed(2)}; 3D x[${minX.toFixed(2)},${maxX.toFixed(2)}] bottom ${(-minY).toFixed(2)}`;

  // Dropping any handle exactly where it already is changes nothing.
  for (const surface of ['front', 'back'] as const) {
    for (const h of getHandles(p, surface)) {
      const after = applyHandleDrag(p, h, h.pos, surface);
      for (const part of ['core', 'left', 'right'] as const)
        for (const [k, v] of Object.entries(after[part]))
          if (typeof v === 'number' && Math.abs(v - (p[part] as Record<string, number>)[k]) > 1e-6)
            return `no-op drag of ${h.id} (${surface}) changed ${part}.${k}: ${(p[part] as Record<string, number>)[k]} -> ${v}`;
    }
  }

  // Flat views (editor, export and 3D textures all draw these) are well-formed.
  if (!styleSchema.safeParse(p.style).success) return 'style failed its schema';
  for (const surface of ['front', 'back'] as const)
    for (const l of flatView(p, surface).layers) if (/NaN|Infinity|undefined/.test(l.d)) return `${surface} ${l.kind} layer has a bad path`;

  // Export and save/reopen.
  if (/NaN|Infinity/.test(buildExportSvg(p, 'x'))) return 'export SVG contains NaN';
  const reopened = parseDesign(serializeDesign(newDesign(p, 'stress')));
  if (!reopened.ok) return `save/reopen failed: ${reopened.error}`;
  if (!paramsEqual(reopened.design.params, p)) return 'save/reopen changed the design';
  if (reopened.warnings.length) return 'a valid design reopened with warnings';
  return null;
}

function fail(seed: number, p: TShirtParams, why: string): never {
  throw new Error(`${why}\nseed=${seed}\nparams=${JSON.stringify(p)}`);
}

describe('stress: random designs never crash anything', () => {
  it(`validates ${n(3000)} uniformly random designs without throwing`, () => {
    let valid = 0;
    for (let seed = 1; seed <= n(3000); seed++) {
      const p = randomParams(rng(seed));
      let issues;
      try {
        for (const s of ['front', 'back', 'outer'] as const) buildOutline(p, s);
        issues = validateParams(p);
      } catch (e) {
        fail(seed, p, `threw: ${(e as Error).message}`);
      }
      if (issues.length === 0) valid++;
    }
    // Not a rule, but worth seeing: how much of the raw parameter space is drawable.
    console.info(`[stress] ${valid} of ${n(3000)} fully random designs were valid (${((100 * valid) / n(3000)).toFixed(1)}%)`);
  }, LONG);

  it(`builds 3D for ${n(150)} random designs (valid or not) without throwing or NaN`, () => {
    const times: { ms: number; seed: number; verts: number }[] = [];
    for (let seed = 10_001; seed < 10_001 + n(150); seed++) {
      const p = randomParams(rng(seed));
      try {
        const t = performance.now();
        const m = buildGarmentMesh(p);
        times.push({ ms: performance.now() - t, seed, verts: m.vertexCount });
        if (!allFinite(m.positions)) fail(seed, p, 'non-finite 3D positions');
      } catch (e) {
        fail(seed, p, `3D build threw: ${(e as Error).message}`);
      }
    }
    times.sort((a, b) => b.ms - a.ms);
    const median = times[Math.floor(times.length / 2)].ms;
    console.info(`[stress] 3D build: median ${median.toFixed(0)} ms, slowest ${times.slice(0, 3).map((t) => `${t.ms.toFixed(0)} ms (seed ${t.seed}, ${t.verts} verts)`).join(', ')}`);
  }, LONG);
});

describe('stress: every valid design satisfies all the rules', () => {
  it(`checks random valid designs (uniform + random walks from presets)`, () => {
    let checked = 0;
    let slowest = 0;
    for (let seed = 20_001; checked < n(120); seed++) {
      const r = rng(seed);
      const p = r.next() < 0.5 ? randomParams(r) : randomWalk(r, (r.pick(PRESETS.filter((x) => x.params().kind === 'tshirt')).params() as TShirtParams), 40);
      if (validateParams(p).length) continue;
      const t = performance.now();
      const why = checkValidDesign(p);
      slowest = Math.max(slowest, performance.now() - t);
      if (why) fail(seed, p, why);
      checked++;
    }
    console.info(`[stress] ${checked} valid designs passed every rule; slowest full check ${slowest.toFixed(0)} ms`);
  }, LONG);
});

describe('stress: random editing sessions', () => {
  it(`never leaves a valid design invalid, and undo/redo replays exactly`, () => {
    for (let seed = 30_001; seed < 30_001 + n(40); seed++) {
      const r = rng(seed);
      const history = new History<TShirtParams>((r.pick(PRESETS.filter((x) => x.params().kind === 'tshirt')).params() as TShirtParams));
      const committed: TShirtParams[] = [history.present];
      for (let step = 0; step < 150; step++) {
        const p = history.present;
        let next: TShirtParams;
        if (r.next() < 0.6) {
          const surface: NeckSurface = r.next() < 0.5 ? 'front' : 'back';
          const h = r.pick(getHandles(p, surface));
          // Mostly small drags, sometimes wild ones far off the canvas.
          const reach = r.next() < 0.15 ? 400 : 25;
          next = applyHandleDrag(p, h, { x: h.pos.x + (r.next() - 0.5) * reach, y: h.pos.y + (r.next() - 0.5) * reach }, surface);
        } else {
          // A slider or typed value: any in-range number for one field.
          next = cloneParams(p);
          if (r.next() < 0.3) {
            const k = r.pick(CORE_KEYS);
            next.core[k] = r.field(CORE_FIELDS[k]);
          } else {
            const k = r.pick(SIDE_KEYS);
            const v = r.field(SIDE_FIELDS[k]);
            if (next.mirror) next.left[k] = next.right[k] = v;
            else next[r.pick(['left', 'right'] as const)][k] = v;
          }
        }
        // The editor's rule: an edit that would break a valid design is refused.
        if (validateParams(next).length === 0) {
          history.commit(next);
          committed.push(next);
        }
        if (validateParams(history.present).length) fail(seed, history.present, `design became invalid at step ${step}`);
      }
      // Undo all the way back, then redo all the way forward: every state must match exactly.
      for (let i = committed.length - 1; i > 0; i--) {
        if (!paramsEqual(history.present, committed[i])) fail(seed, history.present, `undo mismatch at ${i}`);
        history.undo();
      }
      if (!paramsEqual(history.present, committed[0])) fail(seed, history.present, 'undo did not return to the start');
      for (let i = 1; i < committed.length; i++) {
        history.redo();
        if (!paramsEqual(history.present, committed[i])) fail(seed, history.present, `redo mismatch at ${i}`);
      }
    }
  }, LONG);
});

describe('stress: garbage AI output', () => {
  const junk = (r: Rng, depth = 0): unknown => {
    const x = r.next();
    if (depth > 3 || x < 0.25) return r.pick([null, undefined, NaN, Infinity, -1e9, 1e9, 0, -0, '', 'wide', true, 42.5, '70']);
    if (x < 0.4) return Array.from({ length: Math.floor(r.next() * 4) }, () => junk(r, depth + 1));
    const keys = [...CORE_KEYS, ...SIDE_KEYS, 'core', 'left', 'right', 'mirror', 'neckStyle', 'hemStyle', 'name', 'unsupported', '__proto__', 'constructor'];
    return Object.fromEntries(Array.from({ length: Math.floor(r.next() * 8) }, () => [r.pick(keys), junk(r, depth + 1)]));
  };

  it(`handles ${n(2000)} random malformed proposals without throwing; anything accepted is valid`, () => {
    let accepted = 0;
    for (let seed = 40_001; seed < 40_001 + n(2000); seed++) {
      const r = rng(seed);
      // Half pure junk, half a real-looking proposal with junk mixed in.
      const raw =
        r.next() < 0.5
          ? junk(r)
          : (() => {
              const p = randomParams(r);
              const o: Record<string, unknown> = { name: 'x', core: { ...p.core }, left: { ...p.left }, right: r.next() < 0.3 ? junk(r) : { ...p.right } };
              const part = r.pick(['core', 'left'] as const);
              (o[part] as Record<string, unknown>)[r.pick([...CORE_KEYS, ...SIDE_KEYS])] = junk(r);
              return o;
            })();
      let res;
      try {
        res = applyProposal(raw);
      } catch (e) {
        throw new Error(`applyProposal threw on seed ${seed}: ${(e as Error).message}`);
      }
      if (res.ok) {
        accepted++;
        expect(validateParams(res.params), `seed ${seed}`).toEqual([]);
      }
    }
    console.info(`[stress] ${accepted} of ${n(2000)} malformed proposals were safely repaired and accepted`);
  }, LONG);
});
