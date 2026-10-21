import { z } from 'zod';
import fields from './fields.json';

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
  core: CoreParams;
  left: SideParams;
  right: SideParams;
  /** When true, edits to one side are copied to the other. */
  mirror: boolean;
}

export type OriginKind = 'blank' | 'preset' | 'ai' | 'offline-interpreter' | 'duplicate' | 'import';

/** Reserved for the future material/asset library. Not used by the MVP editor. */
export interface MaterialRef {
  id: string;
  region: 'body' | 'sleeves' | 'collar' | 'all';
  name: string;
  sourceUrl?: string;
  licence?: string;
}

export interface ReferenceImageMeta {
  key: string;
  name: string;
  mime: string;
  width: number;
  height: number;
}

export const DESIGN_FORMAT = 'garment-studio.design';
export const SCHEMA_VERSION = 1;

export interface DesignRecord {
  format: typeof DESIGN_FORMAT;
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  name: string;
  garmentType: 'tshirt';
  createdAt: string;
  updatedAt: string;
  params: TShirtParams;
  lineage: { parentId: string | null; iteration: number };
  origin: { kind: OriginKind; prompt?: string; notes?: string[] };
  referenceImage: ReferenceImageMeta | null;
  materials: MaterialRef[];
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
    core: {
      ...defaultsOf(CORE_FIELDS),
      neckStyle: fields.enums.neckStyle.default as NeckStyle,
      hemStyle: fields.enums.hemStyle.default as HemStyle,
    },
    left: { ...side },
    right: { ...side },
    mirror: true,
  };
}

export function cloneParams(p: TShirtParams): TShirtParams {
  return { core: { ...p.core }, left: { ...p.left }, right: { ...p.right }, mirror: p.mirror };
}

export function paramsEqual(a: TShirtParams, b: TShirtParams): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function newDesign(params: TShirtParams, name: string, origin: DesignRecord['origin'] = { kind: 'blank' }): DesignRecord {
  const now = new Date().toISOString();
  return {
    format: DESIGN_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    id: newId(),
    name,
    garmentType: 'tshirt',
    createdAt: now,
    updatedAt: now,
    params: cloneParams(params),
    lineage: { parentId: null, iteration: 1 },
    origin,
    referenceImage: null,
    materials: [],
  };
}

// ---------- presets (starting points, all fully editable) ----------

function preset(core: Partial<CoreParams>, side: Partial<SideParams>, right?: Partial<SideParams>): TShirtParams {
  const p = defaultParams();
  Object.assign(p.core, core);
  Object.assign(p.left, side);
  Object.assign(p.right, side, right ?? {});
  p.mirror = !right;
  return p;
}

export const PRESETS: { id: string; name: string; params: () => TShirtParams }[] = [
  { id: 'classic', name: 'Classic tee', params: defaultParams },
  {
    id: 'boxy',
    name: 'Oversized boxy',
    params: () =>
      preset(
        { bodyLength: 72, neckWidth: 20, neckDepthFront: 8, collarWidth: 2.5, hemStyle: 'straight' },
        { chestHalf: 34, hemHalf: 34, shoulderHalf: 32, shoulderDrop: 7, armholeDepth: 27, sleeveLength: 24, sleeveOpening: 23, sleeveAngle: 32 },
      ),
  },
  {
    id: 'cropped',
    name: 'Cropped, wide sleeves',
    params: () =>
      preset(
        { bodyLength: 48, neckWidth: 19, neckDepthFront: 7, hemStyle: 'straight' },
        { chestHalf: 31, hemHalf: 32, shoulderHalf: 28, shoulderDrop: 5, armholeDepth: 24, sleeveLength: 22, sleeveOpening: 30, sleeveAngle: 20 },
      ),
  },
  {
    id: 'asymmetric',
    name: 'Asymmetric hem',
    params: () =>
      preset(
        { bodyLength: 68, neckWidth: 17, neckDepthFront: 12, neckStyle: 'v', hemStyle: 'straight' },
        { chestHalf: 28, hemHalf: 30, shoulderHalf: 26, shoulderDrop: 3, sleeveLength: 18, sleeveOpening: 18, sleeveAngle: 22, hemOffset: 14 },
        { hemOffset: -12, sleeveLength: 30, hemHalf: 27 },
      ),
  },
];

// ---------- runtime schemas (persistence) ----------

const num = z.number().finite();
const coreSchema = z.object({
  ...(Object.fromEntries(CORE_KEYS.map((k) => [k, num])) as Record<CoreKey, typeof num>),
  neckStyle: z.enum(NECK_STYLES as [NeckStyle, ...NeckStyle[]]),
  hemStyle: z.enum(HEM_STYLES as [HemStyle, ...HemStyle[]]),
});
const sideSchema = z.object(Object.fromEntries(SIDE_KEYS.map((k) => [k, num])) as Record<SideKey, typeof num>);

export const paramsSchema = z.object({ core: coreSchema, left: sideSchema, right: sideSchema, mirror: z.boolean() });

export const designSchema = z.object({
  format: z.literal(DESIGN_FORMAT),
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string().min(1),
  name: z.string(),
  garmentType: z.literal('tshirt'),
  createdAt: z.string(),
  updatedAt: z.string(),
  params: paramsSchema,
  lineage: z.object({ parentId: z.string().nullable(), iteration: z.number().int().min(1) }),
  origin: z.object({
    kind: z.enum(['blank', 'preset', 'ai', 'offline-interpreter', 'duplicate', 'import']),
    prompt: z.string().optional(),
    notes: z.array(z.string()).optional(),
  }),
  referenceImage: z
    .object({ key: z.string(), name: z.string(), mime: z.string(), width: z.number(), height: z.number() })
    .nullable(),
  materials: z.array(
    z.object({
      id: z.string(),
      region: z.enum(['body', 'sleeves', 'collar', 'all']),
      name: z.string(),
      sourceUrl: z.string().optional(),
      licence: z.string().optional(),
    }),
  ),
});
