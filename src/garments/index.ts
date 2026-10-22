import { z } from 'zod';
import { tshirtParamsSchema, type TShirtParams } from '../model/schema';
import type { Issue } from '../model/validate';
import type { Pom } from '../model/pom';
import type { Vec } from '../geometry/polygon';
import { tshirtDef } from './tshirt';
import { pantsDef, pantsParamsSchema, type PantsParams } from './pants';
import type { GarmentDef, GarmentHandle, Surface } from './types';

/**
 * The garment registry. Everything outside src/garments asks these functions
 * instead of assuming a T-shirt. To add a garment type: write its module,
 * add it to GARMENTS, the params union and the schema union.
 */

export type GarmentParams = TShirtParams | PantsParams;
export type GarmentKind = GarmentParams['kind'];

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each def is typed by its own module
const GARMENTS: Record<GarmentKind, GarmentDef<any>> = { tshirt: tshirtDef, pants: pantsDef };

export const GARMENT_KINDS: { kind: GarmentKind; label: string }[] = [
  { kind: 'tshirt', label: tshirtDef.label },
  { kind: 'pants', label: pantsDef.label },
];

export function garmentDef(p: GarmentParams): GarmentDef<GarmentParams> {
  return GARMENTS[p.kind];
}

export const garmentParamsSchema = z.discriminatedUnion('kind', [tshirtParamsSchema, pantsParamsSchema]);

export function cloneGarment<P extends GarmentParams>(p: P): P {
  return structuredClone(p);
}

export function validateDesign(p: GarmentParams): Issue[] {
  return garmentDef(p).validate(p);
}

export function garmentHandles(p: GarmentParams, surface: Surface): GarmentHandle[] {
  return garmentDef(p).handles(p, surface);
}

export function dragHandle(p: GarmentParams, h: Pick<GarmentHandle, 'kind' | 'side'>, pointer: Vec, surface: Surface): GarmentParams {
  return garmentDef(p).drag(p, h, pointer, surface);
}

export function garmentPoms(p: GarmentParams): Pom[] {
  return garmentDef(p).pointsOfMeasure(p);
}

export function garmentOutline(p: GarmentParams, surface: Surface): Vec[] {
  return garmentDef(p).flatParts(p, surface).outline;
}

export type { GarmentHandle, Surface } from './types';
