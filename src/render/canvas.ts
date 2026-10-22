import type { FlatView } from './layers';

/**
 * Draw a flat view onto a 2D canvas (used for the 3D preview's textures). Paths
 * are the same SVG path strings the editor uses, via Path2D.
 */
export function drawFlatView(ctx: CanvasRenderingContext2D, view: FlatView, lineWidth: number) {
  const clip = new Path2D(view.clip);
  const bodyClip = new Path2D(view.bodyClip);
  for (const layer of view.layers) {
    const path = new Path2D(layer.d);
    ctx.save();
    if (layer.clipped) ctx.clip(layer.bodyOnly ? bodyClip : clip);
    if (layer.fill) {
      ctx.fillStyle = layer.fill;
      ctx.fill(path);
    }
    if (layer.stroke) {
      ctx.strokeStyle = layer.stroke;
      ctx.lineWidth = lineWidth * (layer.weight ?? 1);
      ctx.lineJoin = 'round';
      ctx.setLineDash(layer.dashed ? [lineWidth * 2.5, lineWidth * 2] : []);
      ctx.stroke(path);
    }
    ctx.restore();
  }
}
