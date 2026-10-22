import { PRESETS } from '../src/model/presets';
import { describe, expect, it } from 'vitest';
import { History } from '../src/state/history';
import { DesignStore, MemoryStorage } from '../src/state/store';
import { duplicateDesign, parseDesign, serializeDesign } from '../src/state/designFile';
import { defaultParams, newDesign, paramsEqual } from '../src/model/schema';

describe('history', () => {
  it('undoes and redoes several edits in order', () => {
    const h = new History(0);
    h.commit(1);
    h.commit(2);
    h.commit(3);
    expect(h.undo()).toBe(2);
    expect(h.undo()).toBe(1);
    expect(h.redo()).toBe(2);
    h.commit(10); // a new edit clears the redo stack
    expect(h.canRedo).toBe(false);
    expect(h.undo()).toBe(2);
    expect(h.undo()).toBe(1);
    expect(h.undo()).toBe(0);
    expect(h.undo()).toBe(0); // nothing left: stays put
  });

  it('merges a continuous gesture into one undo step', () => {
    const h = new History(0);
    h.commit(1, 'drag-1', 1000);
    h.commit(2, 'drag-1', 1100);
    h.commit(3, 'drag-1', 1200);
    h.commit(4, 'drag-2', 1300);
    expect(h.undo()).toBe(3);
    expect(h.undo()).toBe(0);
  });

  it('does not merge the same key after the time window', () => {
    const h = new History(0);
    h.commit(1, 'field', 0);
    h.commit(2, 'field', 5000);
    expect(h.undo()).toBe(1);
  });
});

describe('persistence', () => {
  it('saves and reopens a design with identical parameters', () => {
    const storage = new MemoryStorage();
    const store = new DesignStore(storage);
    const d = newDesign(PRESETS.find((p) => p.id === 'asymmetric')!.params(), 'Asym test');
    store.save(d);
    // simulate a reload: brand-new store over the same storage
    const reopened = new DesignStore(storage).load(d.id);
    expect(reopened.ok).toBe(true);
    if (reopened.ok) {
      expect(paramsEqual(reopened.design.params, d.params)).toBe(true);
      expect(reopened.design.name).toBe('Asym test');
      expect(reopened.warnings).toEqual([]);
    }
    expect(store.list().map((s) => s.id)).toEqual([d.id]);
  });

  it('duplicating creates an independent design and leaves the original unchanged', () => {
    const store = new DesignStore(new MemoryStorage());
    const original = store.save(newDesign(defaultParams(), 'Original'));
    const copy = duplicateDesign(original, 'Variant');
    copy.params.left.chestHalf = 40;
    store.save(copy);
    const reloaded = store.load(original.id);
    expect(reloaded.ok && reloaded.design.params.left.chestHalf).toBe(26);
    expect(copy.id).not.toBe(original.id);
    expect(copy.lineage).toEqual({ parentId: original.id, iteration: 2 });
    expect(store.list()).toHaveLength(2);
  });

  it('rejects malformed files without throwing', () => {
    expect(parseDesign('not json').ok).toBe(false);
    expect(parseDesign('{}').ok).toBe(false);
    const d = newDesign(defaultParams(), 'x');
    const broken = JSON.parse(serializeDesign(d));
    broken.params.left.chestHalf = 'wide';
    expect(parseDesign(JSON.stringify(broken)).ok).toBe(false);
  });

  it('opens a structurally valid design with impossible geometry, flagging it instead of failing', () => {
    const d = newDesign(defaultParams(), 'x');
    d.params.core.neckWidth = 45;
    const r = parseDesign(serializeDesign(d));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('deleting a design removes it and its reference image', () => {
    const storage = new MemoryStorage();
    const store = new DesignStore(storage);
    const d = newDesign(defaultParams(), 'x');
    d.referenceImage = { key: 'img1', name: 'ref.jpg', mime: 'image/jpeg', width: 10, height: 10 };
    store.saveImage('img1', 'data:image/jpeg;base64,AAAA');
    store.save(d);
    store.delete(d.id);
    expect(storage.length).toBe(0);
  });
});
