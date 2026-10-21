# Garment Studio

A beginner-friendly design studio for experimenting with unconventional T-shirt silhouettes. You edit a structured garment in 2D, see a simplified 3D preview update live, and can optionally start from a generated concept. AI assists; you decide.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # unit tests (geometry, validation, persistence, AI gate)
npm run build && npm start   # production build served on http://localhost:4173
```

**Optional AI generation.** Copy `.env.example` to `.env` and set `GEMINI_API_KEY` (free key from Google AI Studio) or `ANTHROPIC_API_KEY`. The key stays on the server and is never committed. Without it, everything works, and concept generation falls back to an offline keyword matcher that is clearly labelled as not AI.

## What you can do
- Start from a preset: Classic, Oversized boxy, Cropped with wide sleeves, Asymmetric hem.
- Drag the blue dots on the 2D outline, or use the sliders and number boxes. Both edit the same data.
- Turn off **Symmetric** to give each side its own measurements, e.g. asymmetric hems or uneven sleeves.
- Switch between front and back views, and overlay another saved design to compare.
- Rotate and zoom the 3D preview.
- Undo/redo with Ctrl+Z / Ctrl+Shift+Z, save with Ctrl+S, use **Save as copy** for a new iteration, and duplicate, delete or reopen saved designs.
- Export the 2D view as PNG or SVG (garment plus measurements, no app chrome), and the 3D view as PNG.
- Download or import a design as `.json`.
- Attach a reference image. It is stored for reference only.

Designs are saved in this browser's local storage. Use **Download .json** to back them up or move them.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the data model, validation rules, the 2D/3D strategy and known limitations.
