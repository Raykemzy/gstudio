import { newId } from '../model/schema';
import { designSchema, type DesignRecord } from '../model/design';
import { cloneGarment, validateDesign } from '../garments';
import type { Issue } from '../model/validate';
import { defaultStyle } from '../model/style';

/**
 * Versioned design file format. Every saved design carries `format` and
 * `schemaVersion`; `migrate` upgrades older versions step by step before the
 * strict schema check, so old designs keep opening as the format evolves.
 */

type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

// Add an entry here when SCHEMA_VERSION is bumped: MIGRATIONS[n] upgrades version n to n + 1.
const MIGRATIONS: Record<number, Migration> = {
  // v2 added colours and panels: older designs get the default (uncoloured) look.
  1: (d) => {
    const params = d.params && typeof d.params === 'object' ? (d.params as Record<string, unknown>) : null;
    return params ? { ...d, params: { ...params, style: params.style ?? defaultStyle() } } : d;
  },
  // v3 added garment types (pants): every older design is a T-shirt.
  2: (d) => {
    const params = d.params && typeof d.params === 'object' ? (d.params as Record<string, unknown>) : null;
    return params ? { ...d, garmentType: d.garmentType ?? 'tshirt', params: { kind: 'tshirt', ...params } } : d;
  },
};

export function migrate(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  let obj = raw as Record<string, unknown>;
  let v = typeof obj.schemaVersion === 'number' ? obj.schemaVersion : 1;
  while (MIGRATIONS[v]) {
    obj = MIGRATIONS[v]({ ...obj });
    v += 1;
    obj.schemaVersion = v;
  }
  return obj;
}

export type ParseResult = { ok: true; design: DesignRecord; warnings: Issue[] } | { ok: false; error: string };

export function parseDesign(json: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, error: 'The file is not valid JSON.' };
  }
  const result = designSchema.safeParse(migrate(raw));
  if (!result.success) {
    const first = result.error.issues[0];
    return { ok: false, error: `Not a valid design file (${first.path.join('.') || 'root'}: ${first.message}).` };
  }
  // A design that parses but breaks a geometry rule still opens (so work is never lost); the editor shows the warnings.
  return { ok: true, design: result.data as DesignRecord, warnings: validateDesign(result.data.params as DesignRecord['params']) };
}

export function serializeDesign(d: DesignRecord): string {
  return JSON.stringify(d, null, 2);
}

/** A new, independent design derived from `d`. The original is not modified. */
export function duplicateDesign(d: DesignRecord, name?: string): DesignRecord {
  const now = new Date().toISOString();
  return {
    ...structuredClone(d),
    id: newId(),
    name: name ?? `${d.name} (copy)`,
    createdAt: now,
    updatedAt: now,
    params: cloneGarment(d.params),
    lineage: { parentId: d.id, iteration: d.lineage.iteration + 1 },
    origin: { ...d.origin, kind: d.origin.kind === 'blank' ? 'duplicate' : d.origin.kind },
  };
}
