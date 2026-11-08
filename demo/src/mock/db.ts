import { emit } from './bus';

export type Row = { id: string; [k: string]: any };

const STORAGE_KEY = 'autark.mockdb.v4';

/**
 * Tiny document store for the mock backend. Collections are Maps of rows; everything is persisted
 * to localStorage (debounced) so the demo survives reloads. Every write emits a change event.
 */
class MockDB {
  private cols = new Map<string, Map<string, Row>>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  meta: { seededAt: string; version: number } = { seededAt: '', version: 3 };

  init(seed: () => Record<string, Row[]>) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        this.meta = parsed.meta;
        for (const [name, rows] of Object.entries(parsed.cols as Record<string, Row[]>)) {
          this.cols.set(name, new Map(rows.map((r) => [r.id, r])));
        }
        // add collections that were introduced after the user's data was persisted
        const fresh = seed();
        for (const [name, rows] of Object.entries(fresh)) {
          if (!this.cols.has(name)) this.cols.set(name, new Map(rows.map((r) => [r.id, r])));
        }
        return;
      }
    } catch (e) {
      console.warn('[mockdb] failed to load persisted state, reseeding', e);
    }
    this.load(seed());
  }

  private load(data: Record<string, Row[]>) {
    this.cols.clear();
    for (const [name, rows] of Object.entries(data)) this.cols.set(name, new Map(rows.map((r) => [r.id, r])));
    this.meta = { seededAt: new Date().toISOString(), version: 3 };
    this.persistNow();
  }

  reset(seed: () => Record<string, Row[]>) {
    this.load(seed());
    emit({ kind: 'reset' });
  }

  collections(): string[] { return [...this.cols.keys()] }

  private col(name: string): Map<string, Row> {
    let c = this.cols.get(name);
    if (!c) { c = new Map(); this.cols.set(name, c) }
    return c;
  }

  list<T = Row>(name: string): T[] { return [...this.col(name).values()] as T[] }
  get<T = Row>(name: string, id: string): T | undefined { return this.col(name).get(id) as T | undefined }
  find<T = Row>(name: string, pred: (r: T) => boolean): T | undefined { return this.list<T>(name).find(pred) }
  filter<T = Row>(name: string, pred: (r: T) => boolean): T[] { return this.list<T>(name).filter(pred) }

  insert<T extends Row>(name: string, row: T): T {
    this.col(name).set(row.id, row);
    this.changed(name, row.id, 'create');
    return row;
  }

  update<T extends Row>(name: string, id: string, patch: Partial<T> | ((row: T) => T | void)): T {
    const c = this.col(name);
    const cur = c.get(id) as T | undefined;
    if (!cur) throw new Error(`${name}/${id} not found`);
    let next: T;
    if (typeof patch === 'function') {
      const copy = structuredClone(cur);
      const res = patch(copy);
      next = (res ?? copy) as T;
    } else {
      next = { ...cur, ...patch };
    }
    (next as Row).updatedAt = new Date().toISOString();
    c.set(id, next);
    this.changed(name, id, 'update');
    return next;
  }

  remove(name: string, id: string): boolean {
    const ok = this.col(name).delete(id);
    if (ok) this.changed(name, id, 'delete');
    return ok;
  }

  private changed(collection: string, id: string, op: 'create' | 'update' | 'delete') {
    emit({ kind: 'change', collection, id, op });
    this.schedulePersist();
  }

  private schedulePersist() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => { this.saveTimer = null; this.persistNow() }, 400);
  }

  persistNow() {
    try {
      const cols: Record<string, Row[]> = {};
      for (const [name, map] of this.cols) cols[name] = [...map.values()];
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ meta: this.meta, cols }));
    } catch (e) {
      console.warn('[mockdb] persist failed (storage quota?)', e);
    }
  }
}

export const db = new MockDB();
