import type { TShirtParams } from '../model/schema';
import { flatView, type FlatView } from './layers';
import { measurementSummary } from './paths';

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

/**
 * A standalone flat sketch: front and back side by side with labels and key
 * measurements. Only the design itself, no app chrome.
 */
export function buildExportSvg(p: TShirtParams, title: string): string {
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
  const lines = measurementSummary(p);
  const capY = bottom + fs * 2.6;
  const h = capY + fs * (2.8 + lines.length * 1.4) + pad - top;
  const label = (x: number, text: string) =>
    `<text x="${x}" y="${bottom + fs * 1.6}" font-size="${fs}" text-anchor="middle" letter-spacing="0.15">${text}</text>`;
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
    <text x="${x0 + pad}" y="${capY + fs * 1.2}" font-size="${fs * 1.3}" font-weight="bold">${esc(title)}</text>
    ${lines.map((l, i) => `<text x="${x0 + pad}" y="${capY + fs * (2.8 + i * 1.4)}" font-size="${fs}">${esc(l)}</text>`).join('\n    ')}
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
