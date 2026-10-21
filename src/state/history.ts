/**
 * Undo/redo over immutable snapshots. Consecutive commits sharing a `mergeKey`
 * within `mergeWindowMs` collapse into one step, so a whole drag or slider
 * gesture undoes in one go.
 */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  private lastKey: string | null = null;
  private lastTime = 0;

  constructor(
    private current: T,
    private readonly limit = 200,
    private readonly mergeWindowMs = 1000,
  ) {}

  get present(): T {
    return this.current;
  }
  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }

  commit(next: T, mergeKey?: string, now = Date.now()): void {
    const merge = mergeKey != null && mergeKey === this.lastKey && now - this.lastTime <= this.mergeWindowMs;
    if (!merge) {
      this.past.push(this.current);
      if (this.past.length > this.limit) this.past.shift();
    }
    this.current = next;
    this.future = [];
    this.lastKey = mergeKey ?? null;
    this.lastTime = now;
  }

  undo(): T {
    const prev = this.past.pop();
    if (prev !== undefined) {
      this.future.push(this.current);
      this.current = prev;
    }
    this.lastKey = null;
    return this.current;
  }

  redo(): T {
    const next = this.future.pop();
    if (next !== undefined) {
      this.past.push(this.current);
      this.current = next;
    }
    this.lastKey = null;
    return this.current;
  }

  /** Start fresh (e.g. after opening a different design). */
  reset(value: T): void {
    this.past = [];
    this.future = [];
    this.current = value;
    this.lastKey = null;
  }
}
