import { buildOutline } from '../geometry/outline';
import { findSelfIntersection, signedArea } from '../geometry/polygon';
import {
  CORE_FIELDS,
  CORE_KEYS,
  HEM_STYLES,
  NECK_STYLES,
  SIDE_FIELDS,
  SIDE_KEYS,
  type FieldSpec,
  type Side,
  type TShirtParams,
} from './schema';

export interface Issue {
  /** Machine-readable rule id. */
  rule: string;
  /** Plain-language explanation for the user. */
  message: string;
}

const SIDES: Side[] = ['left', 'right'];
const sideName = (s: Side) => (s === 'left' ? "wearer's left" : "wearer's right");

export function clampToSpec(value: number, spec: FieldSpec): number {
  return Math.min(spec.max, Math.max(spec.min, value));
}

/** Every number within its documented range and both enums valid. */
export function rangeIssues(p: TShirtParams): Issue[] {
  const issues: Issue[] = [];
  const check = (v: unknown, spec: FieldSpec, where: string) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) issues.push({ rule: 'not-a-number', message: `${where} is not a valid number.` });
    else if (v < spec.min || v > spec.max)
      issues.push({ rule: 'out-of-range', message: `${where} must be between ${spec.min} and ${spec.max} (got ${v}).` });
  };
  for (const k of CORE_KEYS) check(p.core[k], CORE_FIELDS[k], CORE_FIELDS[k].label);
  for (const s of SIDES) for (const k of SIDE_KEYS) check(p[s][k], SIDE_FIELDS[k], `${SIDE_FIELDS[k].label} (${sideName(s)})`);
  if (!NECK_STYLES.includes(p.core.neckStyle)) issues.push({ rule: 'bad-enum', message: `Unknown neckline style "${p.core.neckStyle}".` });
  if (!HEM_STYLES.includes(p.core.hemStyle)) issues.push({ rule: 'bad-enum', message: `Unknown hem shape "${p.core.hemStyle}".` });
  return issues;
}

/** Relationships between parameters that a single range can't express. */
export function constraintIssues(p: TShirtParams): Issue[] {
  const issues: Issue[] = [];
  const halfNeck = p.core.neckWidth / 2;
  for (const s of SIDES) {
    const sp = p[s];
    if (halfNeck > sp.shoulderHalf - 2)
      issues.push({ rule: 'neck-wider-than-shoulders', message: `The neckline is too wide for the ${sideName(s)} shoulder (shoulders must extend at least 2 cm beyond the neck).` });
    const underarmY = sp.shoulderDrop + sp.armholeDepth;
    const hemY = p.core.bodyLength + sp.hemOffset;
    if (underarmY > hemY - 3)
      issues.push({ rule: 'armpit-below-hem', message: `On the ${sideName(s)} the armpit would sit below the hem. Lengthen the body or shorten the armhole.` });
    if (sp.chestHalf < halfNeck + 1)
      issues.push({ rule: 'chest-narrower-than-neck', message: `The ${sideName(s)} chest is narrower than the neck opening.` });
  }
  const deepest = Math.max(p.core.neckDepthFront, p.core.neckDepthBack);
  const shortest = Math.min(p.core.bodyLength + Math.min(0, p.left.hemOffset, p.right.hemOffset), p.core.bodyLength);
  if (deepest > shortest - 5)
    issues.push({ rule: 'neck-too-deep', message: 'The neckline reaches (almost) to the hem.' });
  return issues;
}

/** Geometric validity of the derived outlines (front and back). */
export function geometryIssues(p: TShirtParams): Issue[] {
  for (const surface of ['front', 'back'] as const) {
    const { polygon } = buildOutline(p, surface);
    if (polygon.length < 4 || Math.abs(signedArea(polygon)) < 1)
      return [{ rule: 'degenerate', message: 'The outline has collapsed to (almost) nothing.' }];
    if (findSelfIntersection(polygon))
      return [{ rule: 'self-intersection', message: `That would make the ${surface} outline cross over itself (e.g. a sleeve overlapping the body).` }];
  }
  return [];
}

/** All problems, cheapest checks first. An empty list means the design is safe to render and edit. */
export function validateParams(p: TShirtParams): Issue[] {
  const r = rangeIssues(p);
  if (r.length) return r;
  const c = constraintIssues(p);
  if (c.length) return c;
  return geometryIssues(p);
}
