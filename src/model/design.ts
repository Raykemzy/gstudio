import { z } from 'zod';
import { newId } from './schema';
import { cloneGarment, garmentParamsSchema, type GarmentKind, type GarmentParams } from '../garments';

/**
 * A saved design: the garment's parameters plus identity, lineage and origin.
 * `garmentType` always equals `params.kind`.
 */

export type OriginKind = 'blank' | 'preset' | 'ai' | 'offline-interpreter' | 'duplicate' | 'import';

/** Reserved for the future material/asset library. Not used by the editor yet. */
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
export const SCHEMA_VERSION = 3;

export interface DesignRecord {
  format: typeof DESIGN_FORMAT;
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  name: string;
  garmentType: GarmentKind;
  createdAt: string;
  updatedAt: string;
  params: GarmentParams;
  lineage: { parentId: string | null; iteration: number };
  origin: { kind: OriginKind; prompt?: string; notes?: string[] };
  referenceImage: ReferenceImageMeta | null;
  materials: MaterialRef[];
}

export function newDesign(params: GarmentParams, name: string, origin: DesignRecord['origin'] = { kind: 'blank' }): DesignRecord {
  const now = new Date().toISOString();
  return {
    format: DESIGN_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    id: newId(),
    name,
    garmentType: params.kind,
    createdAt: now,
    updatedAt: now,
    params: cloneGarment(params),
    lineage: { parentId: null, iteration: 1 },
    origin,
    referenceImage: null,
    materials: [],
  };
}

export const designSchema = z
  .object({
    format: z.literal(DESIGN_FORMAT),
    schemaVersion: z.literal(SCHEMA_VERSION),
    id: z.string().min(1),
    name: z.string(),
    garmentType: z.enum(['tshirt', 'pants']),
    createdAt: z.string(),
    updatedAt: z.string(),
    params: garmentParamsSchema,
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
  })
  .refine((d) => d.garmentType === d.params.kind, { message: 'garmentType does not match the parameters', path: ['garmentType'] });
