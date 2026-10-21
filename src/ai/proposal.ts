import {
  CORE_FIELDS,
  CORE_KEYS,
  HEM_STYLES,
  NECK_STYLES,
  SIDE_FIELDS,
  SIDE_KEYS,
  defaultParams,
  type FieldSpec,
  type HemStyle,
  type NeckStyle,
  type SideParams,
  type TShirtParams,
} from '../model/schema';
import { constraintIssues, geometryIssues, validateParams } from '../model/validate';

/**
 * Turns an untrusted design proposal (from the AI service or the offline
 * interpreter) into validated editor parameters. Nothing is applied silently:
 * every clamp, ignored value and repair is listed in `notes` for the user.
 */

export interface AppliedProposal {
  ok: true;
  params: TShirtParams;
  name: string;
  summary: string;
  notes: string[];
  unsupported: string[];
}

export type ProposalResult = AppliedProposal | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const r1 = (v: number) => Math.round(v * 10) / 10;

function readNumber(src: Record<string, unknown> | undefined, key: string, spec: FieldSpec, fallback: number, where: string, notes: string[]): number {
  const v = src?.[key];
  if (v === undefined || v === null) return fallback;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    notes.push(`${where}: ignored invalid value ${JSON.stringify(v)}; kept ${fallback}.`);
    return fallback;
  }
  if (v < spec.min) {
    notes.push(`${where}: ${r1(v)} is below the minimum, set to ${spec.min}.`);
    return spec.min;
  }
  if (v > spec.max) {
    notes.push(`${where}: ${r1(v)} is above the maximum, set to ${spec.max}.`);
    return spec.max;
  }
  return v;
}

function readSide(src: unknown, fallback: SideParams, label: string, notes: string[]): SideParams {
  const o = isObj(src) ? src : undefined;
  const out = { ...fallback };
  for (const k of SIDE_KEYS) out[k] = readNumber(o, k, SIDE_FIELDS[k], fallback[k], `${SIDE_FIELDS[k].label} (${label})`, notes);
  return out;
}

/** Fix the handful of cross-field rules that have an obvious, explainable repair. */
function repair(p: TShirtParams, notes: string[]) {
  for (const issue of constraintIssues(p)) {
    if (issue.rule === 'neck-wider-than-shoulders') {
      const w = Math.max(CORE_FIELDS.neckWidth.min, 2 * (Math.min(p.left.shoulderHalf, p.right.shoulderHalf) - 2));
      notes.push(`Neck width reduced from ${r1(p.core.neckWidth)} to ${r1(w)} cm so it fits inside the shoulders.`);
      p.core.neckWidth = w;
    } else if (issue.rule === 'armpit-below-hem') {
      for (const s of ['left', 'right'] as const) {
        const sp = p[s];
        const hemY = p.core.bodyLength + sp.hemOffset;
        if (sp.shoulderDrop + sp.armholeDepth <= hemY - 3) continue;
        const depth = Math.max(SIDE_FIELDS.armholeDepth.min, hemY - 5 - sp.shoulderDrop);
        notes.push(`Armhole depth (wearer's ${s}) reduced from ${r1(sp.armholeDepth)} to ${r1(depth)} cm so the armpit stays above the hem.`);
        sp.armholeDepth = depth;
      }
    } else if (issue.rule === 'neck-too-deep') {
      const maxDepth = Math.max(0.5, p.core.bodyLength + Math.min(0, p.left.hemOffset, p.right.hemOffset) - 8);
      if (p.core.neckDepthFront > maxDepth) {
        notes.push(`Front neck depth reduced from ${r1(p.core.neckDepthFront)} to ${r1(maxDepth)} cm so it stays above the hem.`);
        p.core.neckDepthFront = maxDepth;
      }
      if (p.core.neckDepthBack > maxDepth) p.core.neckDepthBack = Math.min(maxDepth, CORE_FIELDS.neckDepthBack.max);
    }
  }
}

/** Sleeves that hang into the body are the most common invalid shape: raise them until they clear it. */
function repairSleeveOverlap(p: TShirtParams, notes: string[]) {
  if (!geometryIssues(p).some((i) => i.rule === 'self-intersection')) return;
  const start = { left: p.left.sleeveAngle, right: p.right.sleeveAngle };
  for (let step = 0; step < 30 && geometryIssues(p).length; step++) {
    for (const s of ['left', 'right'] as const) p[s].sleeveAngle = Math.max(SIDE_FIELDS.sleeveAngle.min, p[s].sleeveAngle - 5);
  }
  if (geometryIssues(p).length) {
    p.left.sleeveAngle = start.left;
    p.right.sleeveAngle = start.right;
    return;
  }
  for (const s of ['left', 'right'] as const)
    if (p[s].sleeveAngle !== start[s])
      notes.push(`Sleeve angle (wearer's ${s}) raised from ${r1(start[s])}° to ${r1(p[s].sleeveAngle)}° so the sleeve doesn't overlap the body.`);
}

export function applyProposal(raw: unknown): ProposalResult {
  if (!isObj(raw)) return { ok: false, error: 'The generator returned no usable design.' };
  const notes: string[] = [];
  const base = defaultParams();

  const core = isObj(raw.core) ? raw.core : undefined;
  if (!core) notes.push('No centre measurements were provided; defaults used.');
  for (const k of CORE_KEYS) base.core[k] = readNumber(core, k, CORE_FIELDS[k], base.core[k], CORE_FIELDS[k].label, notes);

  const neckStyle = core?.neckStyle;
  if (neckStyle !== undefined && neckStyle !== null) {
    if (NECK_STYLES.includes(neckStyle as NeckStyle)) base.core.neckStyle = neckStyle as NeckStyle;
    else notes.push(`Neckline style "${String(neckStyle)}" is not supported; used ${base.core.neckStyle}.`);
  }
  const hemStyle = core?.hemStyle;
  if (hemStyle !== undefined && hemStyle !== null) {
    if (HEM_STYLES.includes(hemStyle as HemStyle)) base.core.hemStyle = hemStyle as HemStyle;
    else notes.push(`Hem shape "${String(hemStyle)}" is not supported; used ${base.core.hemStyle}.`);
  }

  base.left = readSide(raw.left, base.left, "wearer's left", notes);
  // A missing right side means "same as left".
  base.right = raw.right === undefined || raw.right === null ? { ...base.left } : readSide(raw.right, base.right, "wearer's right", notes);
  base.mirror = JSON.stringify(base.left) === JSON.stringify(base.right);

  repair(base, notes);
  repairSleeveOverlap(base, notes);
  const remaining = validateParams(base);
  if (remaining.length)
    return { ok: false, error: `The generated concept can't be drawn: ${remaining[0].message} Try rephrasing, or start from a preset and edit it.` };

  const unsupported = Array.isArray(raw.unsupported)
    ? raw.unsupported.filter((u): u is string => typeof u === 'string' && !!u.trim()).slice(0, 12).map((u) => u.slice(0, 240))
    : [];
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 60) : 'Generated concept';
  const summary = typeof raw.summary === 'string' ? raw.summary.slice(0, 400) : '';
  return { ok: true, params: base, name, summary, notes, unsupported };
}
