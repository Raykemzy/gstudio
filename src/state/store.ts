import type { DesignRecord } from '../model/design';
import { parseDesign, serializeDesign, type ParseResult } from './designFile';

/**
 * Local-first persistence on top of a Web Storage object (localStorage in the
 * app, an in-memory stand-in in tests). One key per design; the list is derived
 * from the keys, so there is no separate index to drift out of sync.
 */

const DESIGN_PREFIX = 'garment-studio:design:';
const IMAGE_PREFIX = 'garment-studio:image:';

export interface DesignSummary {
  id: string;
  name: string;
  updatedAt: string;
  iteration: number;
  parentId: string | null;
}

export class StorageFullError extends Error {
  constructor() {
    super('Browser storage is full. Delete some designs or reference images, or export designs to files.');
  }
}

export class DesignStore {
  constructor(private readonly storage: Storage) {}

  list(): DesignSummary[] {
    const out: DesignSummary[] = [];
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (!key?.startsWith(DESIGN_PREFIX)) continue;
      const r = parseDesign(this.storage.getItem(key) ?? '');
      if (r.ok) {
        const d = r.design;
        out.push({ id: d.id, name: d.name, updatedAt: d.updatedAt, iteration: d.lineage.iteration, parentId: d.lineage.parentId });
      }
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  load(id: string): ParseResult {
    const json = this.storage.getItem(DESIGN_PREFIX + id);
    if (json == null) return { ok: false, error: 'Design not found.' };
    return parseDesign(json);
  }

  save(design: DesignRecord): DesignRecord {
    const saved = { ...design, updatedAt: new Date().toISOString() };
    this.write(DESIGN_PREFIX + design.id, serializeDesign(saved));
    return saved;
  }

  delete(id: string): void {
    const r = this.load(id);
    if (r.ok && r.design.referenceImage) this.storage.removeItem(IMAGE_PREFIX + r.design.referenceImage.key);
    this.storage.removeItem(DESIGN_PREFIX + id);
  }

  saveImage(key: string, dataUrl: string): void {
    this.write(IMAGE_PREFIX + key, dataUrl);
  }

  loadImage(key: string): string | null {
    return this.storage.getItem(IMAGE_PREFIX + key);
  }

  deleteImage(key: string): void {
    this.storage.removeItem(IMAGE_PREFIX + key);
  }

  private write(key: string, value: string) {
    try {
      this.storage.setItem(key, value);
    } catch (e) {
      if (e instanceof DOMException || (e as Error)?.name === 'QuotaExceededError') throw new StorageFullError();
      throw e;
    }
  }
}

/** Minimal in-memory Storage, used in tests and as a fallback if localStorage is unavailable. */
export class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
}
