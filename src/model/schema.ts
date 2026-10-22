import { z } from 'zod';
import fields from './fields.json';
import { defaultStyle, styleSchema, type GarmentStyle } from './style';

/**
 * The garment model. All lengths are centimetres on a flat, front-facing garment.
 * "left"/"right" always mean the WEARER's left/right (so in the front view the
 * wearer's left appears on the right-hand side of the screen).
 */

export type CoreKey = keyof typeof fields.core;
export type SideKey = keyof typeof fields.side;
export type NeckStyle = 'crew' | 'scoop' | 'v' | 'square' | 'boat';
export type HemStyle = 'curved' | 'straight';
export type Side = 'left' | 'right';

export interface FieldSpec {
  label: string;
  help: string;
  min: number;
  max: number;
  step: number;
  default: number;
  group: string;
}

export const CORE_FIELDS = fields.core as Record<CoreKey, FieldSpec>;
export const SIDE_FIELDS = fields.side as Record<SideKey, FieldSpec>;
export const CORE_KEYS = Object.keys(CORE_FIELDS) as CoreKey[];
export const SIDE_KEYS = Object.keys(SIDE_FIELDS) as SideKey[];
export const NECK_STYLES = fields.enums.neckStyle.options as NeckStyle[];
export const HEM_STYLES = fields.enums.hemStyle.options as HemStyle[];

/** Side fields stored as a half-width (centre line to edge). Shown doubled when mirrored. */
export const HALF_WIDTH_KEYS: ReadonlySet<SideKey> = new Set(['chestHalf', 'hemHalf', 'shoulderHalf']);

export type CoreParams = Record<CoreKey, number> & { neckStyle: NeckStyle; hemStyle: HemStyle };
export type SideParams = Record<SideKey, number>;

export interface TShirtParams {
  kind: 'tshirt';
  core: CoreParams;
  left: SideParams;
  right: SideParams;
  /** When true, edits to one side are copied to the other. */
  mirror: boolean;
  /** Colours and panels. Not part of the shape: validation of geometry ignores it. */
  style: GarmentStyle;
}

// ---------- defaults ----------

function defaultsOf<K extends string>(specs: Record<K, FieldSpec>): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const k of Object.keys(specs) as K[]) out[k] = specs[k].default;
  return out;
}

export function defaultParams(): TShirtParams {
  const side = defaultsOf(SIDE_FIELDS);
  return {
    kind: 'tshirt',
    core: {
      ...defaultsOf(CORE_FIELDS),
      neckStyle: fields.enums.neckStyle.default as NeckStyle,
      hemStyle: fields.enums.hemStyle.default as HemStyle,
    },
    left: { ...side },
    right: { ...side },
    mirror: true,
    style: defaultStyle(),
  };
}

export function cloneParams(p: TShirtParams): TShirtParams {
  return { kind: 'tshirt', core: { ...p.core }, left: { ...p.left }, right: { ...p.right }, mirror: p.mirror, style: structuredClone(p.style) };
}

export function paramsEqual<P>(a: P, b: P): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------- runtime schemas (persistence) ----------

const num = z.number().finite();
const coreSchema = z.object({
  ...(Object.fromEntries(CORE_KEYS.map((k) => [k, num])) as Record<CoreKey, typeof num>),
  neckStyle: z.enum(NECK_STYLES as [NeckStyle, ...NeckStyle[]]),
  hemStyle: z.enum(HEM_STYLES as [HemStyle, ...HemStyle[]]),
});
const sideSchema = z.object(Object.fromEntries(SIDE_KEYS.map((k) => [k, num])) as Record<SideKey, typeof num>);

export const tshirtParamsSchema = z.object({ kind: z.literal('tshirt'), core: coreSchema, left: sideSchema, right: sideSchema, mirror: z.boolean(), style: styleSchema });


