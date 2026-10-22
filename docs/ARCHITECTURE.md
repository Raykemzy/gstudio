# Garment Studio: technical design

Status: Phase 0 (feasibility) and Phase 1 (functional editor) done. Phase 2 (AI generation) works with Gemini, tested with a real key. Claude is also supported but has not been tested live.

## 1. Stack and why

| Concern | Choice | Why / alternatives considered |
|---|---|---|
| App shell | **Vite + React 19 + TypeScript** | Small, mature, fast dev loop. No backend framework needed: Vite's dev/preview server hosts the one AI endpoint. |
| 2D editing | **Plain SVG rendered by React** (no library) | The editor manipulates ~14 named handles, not freeform vectors. Fabric.js/Konva/Paper.js would add a second object model that competes with the garment data. SVG also gives free crisp export. |
| 3D preview | **three.js** (no react-three-fiber) | The scene is a single mesh rebuilt from data, so the r3f abstraction isn't needed. `OrbitControls` gives rotate/zoom. |
| Triangulation | **delaunator** (~3 kB) | Needed to mesh the arbitrary outline for the 3D preview. |
| Validation | **zod** | Validates saved files and imported designs. Also used as the shared schema for AI output. |
| Persistence | **localStorage** + JSON file export/import | Local-first, no accounts. Designs are small (~2 kB). Reference images are downscaled JPEGs. IndexedDB is the upgrade path if storage limits bite. |
| AI | **@google/genai** (Gemini) or **@anthropic-ai/sdk** (Claude), server-side, structured JSON output | The key never reaches the browser. The output is constrained by JSON schema and then re-validated client-side. |
| Tests | **vitest** (+ a Playwright smoke script used during development) | |

## 2. Garment model (single source of truth)

A design is **parameters only**. Every geometric thing (2D outline, handles, 3D mesh, exported image) is a pure function of `params`, so there is nothing to drift out of sync.

```ts
DesignRecord {
  format: "garment-studio.design", schemaVersion: 1,
  id, name, garmentType: "tshirt", createdAt, updatedAt,      // ISO timestamps
  params: {
    core:  { bodyLength, neckWidth, neckDepthFront, neckDepthBack, collarWidth,
             neckStyle: crew|scoop|v|square|boat, hemStyle: curved|straight },
    left:  SideParams,   // WEARER's left
    right: SideParams,   // WEARER's right
    mirror: boolean      // edit both sides together
  },
  lineage:  { parentId, iteration },           // duplicates/"save as copy" point at their parent
  origin:   { kind: blank|preset|ai|offline-interpreter|duplicate|import, prompt?, notes? },
  referenceImage: { key, name, mime, width, height } | null,  // pixels stored separately
  materials: MaterialRef[]                      // reserved for the future material library (unused)
}
SideParams { chestHalf, hemHalf, hemOffset, shoulderHalf, shoulderDrop,
             armholeDepth, sleeveLength, sleeveOpening, sleeveAngle }
```

The field list, labels, help text, ranges and defaults live in **one file**, `src/model/fields.json`. The TypeScript model, the controls, the validation and the AI server's JSON schema and prompt all read it.

Every lateral measurement is per side, which is what makes asymmetry first-class rather than a special case. `mirror` is an editing mode: it is on by default and copies edits to the other side.

### Coordinate frame
Units are cm. The origin is on the centre line at the neck-side shoulder points, with +y pointing down. +x is toward the **wearer's left**, i.e. the garment seen from the front. The back view is drawn mirrored.

### Parameters and ranges (cm unless noted)

| Field | Range | Default |
|---|---|---|
| bodyLength (shoulder-by-neck to centre hem) | 25 – 120 | 70 |
| neckWidth | 8 – 45 | 18 |
| neckDepthFront / neckDepthBack | 0.5 – 45 / 0.5 – 30 | 9 / 2.5 |
| collarWidth (0 = no rib) | 0 – 8 | 2 |
| chestHalf / hemHalf (centre line to side) | 12 – 60 / 10 – 75 | 26 / 26 |
| hemOffset (side seam length vs centre) | −40 – 50 | 0 |
| shoulderHalf | 10 – 50 | 23 |
| shoulderDrop (negative = raised) | −5 – 30 | 4.5 |
| armholeDepth (shoulder point to armpit) | 8 – 50 | 20 |
| sleeveLength (0 = sleeveless) | 0 – 85 | 20 |
| sleeveOpening | 6 – 60 | 17 |
| sleeveAngle (° below horizontal) | −20 – 80 | 25 |

### Starter shapes
`src/model/presets.ts` holds 21 silhouettes, authored for this editor as plain parameters. They are generic shapes, not copies of any brand's garments, so they carry no licensing questions. The geometry tests validate every one.

Importing external references (patterns, tech packs, images) is deferred to the materials/assets phase, which will record source and licence. Free downloads are often not licensed for commercial use.

### Colours and panels (`params.style`, schema v2)
`style` holds the colours of the body, sleeves and neck rib, plus a list of **panels**: closed shapes, each with a colour, used for colour blocking.
- **Coordinates:** panel points are garment-relative, `u = x / chest half-width` of that side and `v = y / body length`, so panels follow the shape when it is resized.
- **Clipping:** a panel is clipped either to the whole garment or to the body only ("keep off the sleeves"), so its shape can run past the edges freely.
- **Options:** panels can be mirrored across the centre line, drawn curved (Catmull-Rom) or straight, and belong to the front or the back.
- **One drawing for everything:** `render/layers.ts` turns a design into an ordered list of layers per view. The SVG editor, the front-and-back export and the 3D preview (painted onto canvas textures with planar UVs) all draw from that list, so they cannot disagree.
- **Old files:** version-1 files open through a migration that adds the default (uncoloured) style.

## 3. Geometry and validation

`src/geometry/outline.ts` derives named keypoints per side: neck side, shoulder point, sleeve top/bottom, underarm and hem side. Together with the sampled neckline and hem curves, these form one closed polygon. Neckline styles are functions `depth(x)`, so front, back and the outer silhouette (the higher of the two at each x) can be combined exactly.

Validation (`src/model/validate.ts`) runs cheapest-first:
1. **Ranges.** Every number is finite and within `fields.json`; enums are known.
2. **Named constraints, with plain-language messages:**
   - The neck is at least 2 cm inside each shoulder.
   - The armpit is ≥ 3 cm above that side's hem.
   - The chest is wider than the neck.
   - The neckline stays ≥ 5 cm above the shortest hem point.
3. **Geometry.** Neither the front nor the back outline may self-intersect (e.g. a hanging sleeve overlapping the body) or collapse to near-zero area.

How invalid input is handled:
- **User edits** (controls, handles): a valid design is never allowed to become invalid. The edit is rejected, the handle turns red, and the reason is shown. Values are clamped to ranges before validation, so dragging to an extreme stops at the limit instead of failing.
- **Saved/imported files**: malformed structure is rejected with a message. A file that is well-formed but geometrically invalid still opens with a warning list, so work is never lost, and edits are allowed while it is being fixed.
- **AI/offline proposals**: wrong types are ignored, out-of-range values are clamped, and known conflicts are repaired (neck too wide, armpit below hem, neck too deep, sleeve overlapping body → raise the sleeve angle). **Every adjustment is listed to the user**; nothing is normalised silently. Anything still invalid is refused with an explanation.

Unsupported shapes (raglan, panels, pockets, slits, hoods, collar height and the like) are not representable. The generators list them under "Not represented in the design" instead of approximating silently.

## 4. 2D ↔ 3D strategy

- **2D**: SVG of the outline, collar band and dashed back neckline. **Handles are derived from params**, and `applyHandleDrag` maps the pointer back to params (e.g. sleeve end → length + angle, armpit → chest width + armhole depth). Controls call the same `commit()` entry point. Undo/redo stores param snapshots; a whole drag or slider gesture merges into one step.
- **3D** ("inflated flat-lay"): the outer silhouette polygon is triangulated (Delaunay over boundary + interior grid + neckline rows), then each vertex is pushed out of the plane by a circular profile of its distance to the edge, capped at ~9 cm. Sleeves become round tubes; the body gets a flat front with rounded sides. Front and back surfaces meet at the outline, the neck opening is cut from the deeper side, and the rib is a tube along each neckline. Rebuild time is ~20–30 ms, throttled to one per animation frame.
- **Consistency** is guaranteed structurally (one function feeds both views) and tested: the 3D bounding box matches the 2D outline bounds for every preset, and body-length and sleeve-length changes move both views by the same amounts.

Because the 3D form is generated from *any* closed outline, future image-reconstructed or freeform outlines will get a 3D preview for free.

### Honest limitations of the 3D preview
- No body form, drape, gravity or fabric. Depth is synthesised, not measured, and the garment looks "padded".
- Hem and cuff openings are closed surfaces; only the neck is open.
- Shoulder slope reads mainly in silhouette, not as a shaped shoulder.
- The caption under the preview says this to the user.

### Stress testing
`tests/stress.test.ts` throws seeded random designs and editing sessions at the model. Any failure prints its seed and parameters so it can be reproduced. It checks:
- outline, validation and 3D never throw, even on invalid input;
- every valid design has a simple outline, a finite 3D mesh whose width and length match 2D, no-op handle drags that change nothing, a clean SVG export, and an exact save/reopen round trip;
- random editing sessions (drags, wild drags, slider values) never turn a valid design invalid, and undo/redo replays every state exactly;
- thousands of malformed AI proposals never throw, and anything accepted is valid.

The quick version runs with `npm test`. The heavy run is `STRESS_SCALE=20 npx vitest run tests/stress.test.ts`.

The stress test found 3D builds of very large garments taking ~100 ms (sluggish dragging). The mesh now adapts its density so the point count stays roughly constant, bringing the worst case to under 40 ms.

## 5. Persistence format
- One localStorage key per design (`garment-studio:design:<id>`); the design list is derived from the keys. Reference images go under `garment-studio:image:<key>`.
- Saving is explicit (Save / Ctrl+S). Leaving with unsaved changes asks first. **Save as copy** and **Duplicate** create a new id with `lineage.parentId` set, so iterations never overwrite the original.
- **Download .json / Import .json** use the same versioned format. Imports always get a new id.
- `src/state/designFile.ts` has a `MIGRATIONS` table: when `SCHEMA_VERSION` is bumped, add a function that upgrades the old shape. Old files then keep opening.

## 6. AI integration
- `server/ai.mjs` runs inside the Vite server (dev and `vite preview`) or `server/serve.mjs` (production), so keys never reach the browser. Endpoints: `GET /api/ai/status`, `POST /api/ai/generate`.
- It holds the shared prompt and the JSON schema, both generated from `fields.json`. Every field is required, so a proposal is always a complete garment. Providers live in `server/providers/`, one small file each, and implement `generate({ system, prompt, schema })`:
  - **Gemini** (`@google/genai`, default when `GEMINI_API_KEY` is set):
    - Uses `responseMimeType: application/json` with `responseJsonSchema`. This schema also carries `minimum`/`maximum`, so ranges are enforced at generation time.
    - Tries `gemini-3-flash-preview`, then `gemini-3.5-flash`, then `gemini-flash-lite-latest`. It moves on when a model is overloaded (503), out of quota (429), retired (404) or slower than 18 s, which keeps the total within Vercel's 60 s limit.
    - `GARMENT_AI_MODEL` pins a single model.
    - Tested 2026-10-22 with a real key: the PRD's example prompts returned distinct, faithful designs in 5–7 s. `gemini-flash-latest` was often overloaded. The lite model works but softens extreme proportions. `gemini-2.5-flash` was no longer available.
  - **Claude** (`@anthropic-ai/sdk`): uses `output_config.format` JSON schema with `effort: "low"` and `fallbacks: "default"`. Model `claude-opus-5-5`.
- Selection: `GARMENT_AI_PROVIDER=gemini|anthropic`, otherwise whichever key is set (Gemini first).
- The client treats the response as untrusted and runs it through the same `applyProposal` gate as the offline interpreter.
- **Without a key**, the "Offline keyword matcher (not AI)" maps ~30 garment phrases to parameters and lists the details it did not understand. Manual editing never depends on either.
- Verified with a real Gemini key: the full schema is accepted and generations pass the client validation gate. The Claude path has not been run against the live API.
- Gemini free tier: keys come from Google AI Studio. Check Google's current terms before relying on it. Free-tier limits are low, and Google's terms have historically allowed free-tier prompts to be used to improve its products, so avoid sending confidential designs there.

## 7. Roadmap (revised 2026-10-22)
The end goal is a simplified "Illustrator for clothing": design the shape, dress it with panels, colours, textures and graphics, and export clean flat sketches.
1. ✅ Shape editor, AI generation, starter shapes, mobile.
2. ✅ **Colour & panels:** per-part colours, colour-blocked panels from templates, editable points, front + back export, colours in 3D.
3. **Textures & patterns:** camo, mesh, acid wash, heather and stripes, or your own uploads, per panel. They show in 3D.
4. **Graphics & text:** logos and prints on the front, back and sleeves, sized in cm.
5. **Construction details:** raglan sleeves, rib cuffs and hem bands, gathered hems, stitch lines, pockets.
6. **More garments:** long sleeve and sweatshirt, then hoodie, then pants.
7. Photo to design, material library, visual polish.
