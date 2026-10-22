import type { TShirtParams } from '../model/schema';
import { flatView, type FlatView } from './layers';
import { SIZES, formatMeasure, graded, pointsOfMeasure, type Size, type Unit } from '../model/pom';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** SVG markup for one view's layers, clipped with a per-view clip id. */
export function svgLayers(view: FlatView, clipId: string, outlineWidth: number): string {
  const parts = [`<clipPath id="${clipId}"><path d="${view.clip}"/></clipPath>`, `<clipPath id="${clipId}-body"><path d="${view.bodyClip}"/></clipPath>`];
  for (const l of view.layers) {
    const attrs = [
      `d="${l.d}"`,
      `fill="${l.fill ?? 'none'}"`,
      l.stroke ? `stroke="${l.stroke}" stroke-width="${outlineWidth * (l.weight ?? 1)}" stroke-linejoin="round"` : '',
      l.dashed ? `stroke-dasharray="${outlineWidth * 2.5} ${outlineWidth * 2}"` : '',
      l.clipped ? `clip-path="url(#${clipId}${l.bodyOnly ? '-body' : ''})"` : '',
    ];
    parts.push(`<path ${attrs.filter(Boolean).join(' ')}/>`);
  }
  return parts.join('\n  ');
}

export interface ExportOptions {
  unit: Unit;
  base: Size;
}

/** The measurement table (points of measure x sizes) as SVG text; returns its markup and height. */
function specTable(p: TShirtParams, x: number, y: number, w: number, fs: number, opts: ExportOptions): { svg: string; height: number } {
  const poms = pointsOfMeasure(p);
  const rowH = fs * 1.7;
  // Column widths as fractions of the table width.
  const fr = [0.05, 0.27, ...SIZES.map(() => 0.1), 0.08];
  const xs: number[] = [];
  fr.reduce((acc, f) => (xs.push(acc), acc + f * w), x);
  const head = ['POM', 'Point of measure', ...SIZES.map((s) => (s === opts.base ? `${s} (sample)` : s)), '±'];
  const cell = (col: number, row: number, text: string, bold = false) =>
    `<text x="${xs[col] + fs * 0.3}" y="${y + rowH * (row + 1) - fs * 0.5}" font-size="${fs * 0.85}"${bold ? ' font-weight="bold"' : ''}>${esc(text)}</text>`;
  const parts: string[] = [
    `<text x="${x}" y="${y - fs * 0.6}" font-size="${fs}" font-weight="bold">Measurements (${opts.unit}, finished, laid flat)</text>`,
    `<rect x="${x}" y="${y}" width="${w}" height="${rowH}" fill="#eef0f3"/>`,
    ...head.map((h, i) => cell(i, 0, h, true)),
  ];
  const baseCol = 2 + SIZES.indexOf(opts.base);
  parts.push(`<rect x="${xs[baseCol]}" y="${y + rowH}" width="${fr[baseCol] * w}" height="${rowH * poms.length}" fill="#f6f7f9"/>`);
  poms.forEach((m, r) => {
    const row = r + 1;
    parts.push(cell(0, row, m.code, true), cell(1, row, m.name));
    SIZES.forEach((s, i) => parts.push(cell(2 + i, row, formatMeasure(graded(m, s, opts.base), opts.unit))));
    parts.push(cell(2 + SIZES.length, row, formatMeasure(m.tolerance, opts.unit)));
    parts.push(`<line x1="${x}" y1="${y + rowH * (row + 1)}" x2="${x + w}" y2="${y + rowH * (row + 1)}" stroke="#d5d9e0" stroke-width="${fs * 0.04}"/>`);
  });
  const height = rowH * (poms.length + 1);
  parts.push(`<text x="${x}" y="${y + height + fs * 1.4}" font-size="${fs * 0.75}" fill="#646b78">HPS = high point shoulder (beside the neck). L / R = wearer's left / right. Sizes graded from the sample with typical steps; tolerances are typical QC values. Confirm both with your factory.</text>`);
  return { svg: parts.join('\n    '), height: height + fs * 2 };
}

/**
 * A standalone flat sketch: front and back side by side, then the measurement
 * table. Only the design itself, no app chrome.
 */
export function buildExportSvg(p: TShirtParams, title: string, opts: ExportOptions = { unit: 'cm', base: 'M' }): string {
  const front = flatView(p, 'front');
  const back = flatView(p, 'back');
  const pad = 10;
  const gap = 14;
  const fb = front.bounds, bb = back.bounds;
  const top = Math.min(fb.minY, bb.minY, 0) - pad;
  const bottom = Math.max(fb.maxY, bb.maxY);
  // Place the back view to the right of the front view.
  const shift = fb.maxX - bb.minX + gap;
  const x0 = fb.minX - pad;
  const w = fb.width + gap + bb.width + 2 * pad;
  const fs = Math.max(1.8, w / 95);
  const label = (x: number, text: string) =>
    `<text x="${x}" y="${bottom + fs * 1.6}" font-size="${fs}" text-anchor="middle" letter-spacing="0.15">${text}</text>`;
  const titleY = bottom + fs * 4;
  const table = specTable(p, x0 + pad, titleY + fs * 2.6, w - 2 * pad, fs, opts);
  const h = titleY + fs * 2.6 + table.height + pad - top;
  const ow = 0.35;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${top} ${w} ${h}" width="${Math.round(w * 10)}" height="${Math.round(h * 10)}">
  <rect x="${x0}" y="${top}" width="${w}" height="${h}" fill="#ffffff"/>
  <g>
  ${svgLayers(front, 'clip-front', ow)}
  </g>
  <g transform="translate(${shift} 0)">
  ${svgLayers(back, 'clip-back', ow)}
  </g>
  <g font-family="Helvetica, Arial, sans-serif" fill="#1f2430">
    ${label((fb.minX + fb.maxX) / 2, 'FRONT')}
    ${label(shift + (bb.minX + bb.maxX) / 2, 'BACK')}
    <text x="${x0 + pad}" y="${titleY}" font-size="${fs * 1.3}" font-weight="bold">${esc(title)}</text>
    ${table.svg}
  </g>
</svg>`;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function svgToPngBlob(svg: string, maxSide = 3000): Promise<Blob> {
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Could not render the SVG.'));
      img.src = url;
    });
    const k = maxSide / Math.max(img.width, img.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * k);
    canvas.height = Math.round(img.height * k);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed.'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const safeFilename = (name: string) => name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'design';
