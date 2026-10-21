import type { TShirtParams } from '../model/schema';
import type { NeckSurface } from '../geometry/outline';
import { garmentPaths, measurementSummary } from './paths';

/** A standalone SVG of the design only (no handles, no app chrome), sized to the garment with a margin. */
export function buildExportSvg(p: TShirtParams, surface: NeckSurface, title: string): string {
  const g = garmentPaths(p, surface);
  const pad = 8;
  const captionH = 16;
  const x0 = g.bounds.minX - pad;
  const y0 = Math.min(g.bounds.minY, 0) - pad;
  const w = g.bounds.width + 2 * pad;
  const h = g.bounds.maxY - y0 + pad + captionH;
  const lines = measurementSummary(p);
  const fs = Math.max(1.6, w / 75);
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const capY = g.bounds.maxY + pad;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${w} ${h}" width="${Math.round(w * 10)}" height="${Math.round(h * 10)}">
  <rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="#ffffff"/>
  <clipPath id="garment"><path d="${g.outline}"/></clipPath>
  <path d="${g.outline}" fill="#eef0f3" stroke="#1f2430" stroke-width="0.35" stroke-linejoin="round"/>
  ${g.collar ? `<path d="${g.collar}" fill="#c9ced8" stroke="#1f2430" stroke-width="0.2" clip-path="url(#garment)"/>` : ''}
  ${g.otherNeck ? `<path d="${g.otherNeck}" fill="none" stroke="#1f2430" stroke-width="0.2" stroke-dasharray="0.8 0.6"/>` : ''}
  <g font-family="Helvetica, Arial, sans-serif" fill="#1f2430">
    <text x="${x0 + pad}" y="${capY + fs * 1.2}" font-size="${fs * 1.3}" font-weight="bold">${esc(title)} (${surface} view)</text>
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

export async function svgToPngBlob(svg: string, maxSide = 2400): Promise<Blob> {
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
