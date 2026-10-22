# Garment Studio

A beginner-friendly design studio for experimenting with unconventional T-shirt silhouettes. You edit a structured garment in 2D, see a simplified 3D preview update live, and can optionally start from a generated concept. AI assists; you decide.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # unit + quick stress tests (geometry, validation, persistence, AI gate)
STRESS_SCALE=20 npx vitest run tests/stress.test.ts   # heavy stress run
npm run build && npm start   # production build served on http://localhost:4173
```

**Optional AI generation.** Copy `.env.example` to `.env` and set `GEMINI_API_KEY` (free key from Google AI Studio) or `ANTHROPIC_API_KEY`. The key stays on the server and is never committed. Without it, everything works, and concept generation falls back to an offline keyword matcher that is clearly labelled as not AI.

## Deploy to Vercel
1. In Vercel, **Add New → Project** and import this GitHub repo. The settings come from `vercel.json`, so nothing needs changing.
2. Optional: under **Settings → Environment Variables**, add `GEMINI_API_KEY` (or `ANTHROPIC_API_KEY`), then redeploy. Without it the hosted app works fully, using the offline matcher.

The AI endpoints run as serverless functions in `api/ai/`. Saved designs live in each visitor's own browser storage.

## What you can do
- Start from one of 21 starter shapes (**New**), grouped as Essentials, Oversized, Cropped, Sleeves, Necklines & hems and Experimental. Every shape stays fully editable.
- Colour the body, sleeves and neck rib, and add **panels** for colour blocking (side curves, yoke, hem band, diagonal split, stripes, arch). Drag a panel's squares to reshape it, tap **+** to add points, mirror it across both sides, and keep it off the sleeves if you like.
- Drag the blue dots on the 2D outline, or use the sliders and number boxes. Both edit the same data.
- Switch between **Symmetric** and **Asymmetric** above the garment. Asymmetric lets each side have its own measurements, e.g. a diagonal hem or uneven sleeves. Going back to symmetric copies the wearer's left side onto the right, and Undo reverses that.
- Switch between front and back views, and overlay another saved design to compare.
- Tap the empty canvas to hide the dots and see the clean garment; tap the garment to bring them back.
- Zoom the canvas only (not the page): pinch on a trackpad or phone, Ctrl/⌘ + scroll, or the − / + / Fit buttons. When zoomed in, drag or scroll to move around.
- Rotate and zoom the 3D preview, or **Lock angle** to keep a viewpoint while you edit. The lock is remembered in this browser.
- Undo/redo with Ctrl+Z / Ctrl+Shift+Z, save with Ctrl+S, use **Save as copy** for a new iteration, and duplicate, delete or reopen saved designs.
- Export a flat sketch (front and back side by side, with measurements) as PNG or SVG, and the 3D view as PNG.
- Download or import a design as `.json`.
- Attach a reference image. It is stored for reference only.
- Works on phones: the garment comes first, then the 3D preview and generator, then the controls. Drag targets are enlarged for fingers.

Designs are saved in this browser's local storage. Use **Download .json** to back them up or move them.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the data model, validation rules, the 2D/3D strategy and known limitations.
