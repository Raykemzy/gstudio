import type { NeckSurface } from '../geometry/outline';
import type { Vec } from '../geometry/polygon';

/** The back view is the model mirrored horizontally (we're looking at it from behind). */

export const viewSign = (surface: NeckSurface) => (surface === 'front' ? 1 : -1);
export const toView = (v: Vec, surface: NeckSurface): Vec => ({ x: v.x * viewSign(surface), y: v.y });
