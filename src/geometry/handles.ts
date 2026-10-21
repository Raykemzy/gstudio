import { CORE_FIELDS, SIDE_FIELDS, cloneParams, type CoreKey, type Side, type SideKey, type TShirtParams } from '../model/schema';
import { clampToSpec } from '../model/validate';
import { SIDE_SIGN, buildOutline, type NeckSurface } from './outline';
import { vec, type Vec } from './polygon';

/**
 * Direct-manipulation handles. A handle's position is always DERIVED from the
 * parameters, and dragging it maps the pointer back onto parameters, so the 2D
 * editor never owns geometry of its own: there is one source of truth.
 */

export type HandleKind = 'neckSide' | 'neckCenter' | 'shoulder' | 'sleeveEnd' | 'sleeveOpening' | 'underarm' | 'hemSide' | 'hemCenter';

export interface Handle {
  id: string;
  kind: HandleKind;
  side?: Side;
  pos: Vec;
  label: string;
}

const KIND_LABEL: Record<HandleKind, string> = {
  neckSide: 'Neck edge: drag sideways to change neck width',
  neckCenter: 'Neckline: drag up/down to change neck depth',
  shoulder: 'Shoulder point: drag to change shoulder width and slope',
  sleeveEnd: 'Sleeve end: drag to change sleeve length and angle',
  sleeveOpening: 'Cuff: drag to change sleeve opening width',
  underarm: 'Armpit: drag to change chest width and armhole depth',
  hemSide: 'Hem corner: drag to change hem width and side length',
  hemCenter: 'Centre hem: drag up/down to change body length',
};

export function getHandles(p: TShirtParams, surface: NeckSurface): Handle[] {
  const o = buildOutline(p, surface);
  const hs: Handle[] = [
    { id: 'neckCenter', kind: 'neckCenter', pos: o.neckCenter, label: KIND_LABEL.neckCenter },
    { id: 'hemCenter', kind: 'hemCenter', pos: o.hemCenter, label: KIND_LABEL.hemCenter },
  ];
  for (const side of ['left', 'right'] as Side[]) {
    const s = o.sides[side];
    const add = (kind: HandleKind, pos: Vec) => hs.push({ id: `${kind}:${side}`, kind, side, pos, label: KIND_LABEL[kind] });
    add('neckSide', s.neckSide);
    add('shoulder', s.shoulder);
    add('sleeveEnd', s.sleeveTop);
    add('sleeveOpening', s.sleeveBottom);
    add('underarm', s.underarm);
    add('hemSide', s.hemSide);
  }
  return hs;
}

const round = (v: number, step: number) => Math.round(v / step) * step;

function setCore(p: TShirtParams, key: CoreKey, value: number) {
  if (!Number.isFinite(value)) return;
  const spec = CORE_FIELDS[key];
  p.core[key] = clampToSpec(round(value, spec.step), spec);
}

function setSide(p: TShirtParams, side: Side, key: SideKey, value: number) {
  if (!Number.isFinite(value)) return;
  const spec = SIDE_FIELDS[key];
  const v = clampToSpec(round(value, spec.step), spec);
  p[side][key] = v;
  if (p.mirror) p[side === 'left' ? 'right' : 'left'][key] = v;
}

/**
 * Apply a drag of `handle` to `pointer` (model frame). Values are clamped to their
 * field ranges; cross-field validity is checked by the caller with validateParams.
 */
export function applyHandleDrag(params: TShirtParams, handle: Pick<Handle, 'kind' | 'side'>, pointer: Vec, surface: NeckSurface): TShirtParams {
  const p = cloneParams(params);
  const side = handle.side ?? 'left';
  const s = SIDE_SIGN[side];
  const sp = p[side];
  switch (handle.kind) {
    case 'neckSide':
      setCore(p, 'neckWidth', 2 * Math.abs(pointer.x));
      break;
    case 'neckCenter':
      setCore(p, surface === 'front' ? 'neckDepthFront' : 'neckDepthBack', pointer.y);
      break;
    case 'hemCenter':
      setCore(p, 'bodyLength', pointer.y);
      break;
    case 'shoulder':
      setSide(p, side, 'shoulderHalf', s * pointer.x);
      setSide(p, side, 'shoulderDrop', pointer.y);
      break;
    case 'sleeveEnd': {
      const dx = s * (pointer.x - s * sp.shoulderHalf);
      const dy = pointer.y - sp.shoulderDrop;
      setSide(p, side, 'sleeveLength', Math.hypot(dx, dy));
      if (Math.hypot(dx, dy) > 1) setSide(p, side, 'sleeveAngle', (Math.atan2(dy, dx) * 180) / Math.PI);
      break;
    }
    case 'sleeveOpening': {
      // Project the pointer onto the cuff direction (perpendicular to the sleeve).
      const top = buildOutline(params, surface).sides[side].sleeveTop;
      const ang = (sp.sleeveAngle * Math.PI) / 180;
      const perp = vec(-s * Math.sin(ang), Math.cos(ang));
      setSide(p, side, 'sleeveOpening', (pointer.x - top.x) * perp.x + (pointer.y - top.y) * perp.y);
      break;
    }
    case 'underarm':
      setSide(p, side, 'chestHalf', s * pointer.x);
      setSide(p, side, 'armholeDepth', pointer.y - sp.shoulderDrop);
      break;
    case 'hemSide':
      setSide(p, side, 'hemHalf', s * pointer.x);
      setSide(p, side, 'hemOffset', pointer.y - p.core.bodyLength);
      break;
  }
  return p;
}
