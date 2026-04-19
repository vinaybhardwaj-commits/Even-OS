/**
 * PC.4.C.3 — IndexedDB offline draft queue.
 *
 * When the DB probe goes red, write-path surfaces (vitals, eMAR give/hold,
 * short notes) can enqueue their payload here instead of dropping it. On
 * the next red → green transition, the caller flushes via `replay()` which
 * hands each draft back to the original tRPC mutation. Successful replays
 * delete the row; failures stay queued with `attempts++` so the next cycle
 * can try again.
 *
 * Design choices:
 * - IndexedDB (not localStorage) — 5MB+ quota, async, survives tab refresh
 * - Minimal vanilla wrapper (no `idb` dep) — this is 120 lines, don't add
 *   a dependency for it
 * - LWW squash on (patient_id, surface, field_set): if the same nurse
 *   re-records vitals 5 times during a DB outage, we keep only the last
 *   one — the intermediate state never mattered
 * - 200-row LRU cap per patient: drops oldest when exceeded so a runaway
 *   offline session can't blow the quota
 *
 * Store schema (chart_drafts, keyPath='id' auto-increment):
 *   { id, patient_id, surface, field_set, payload, created_at, updated_at,
 *     attempts, last_error }
 *
 * Indexes:
 *   - 'by_squash'   → [patient_id, surface, field_set]  (unique replacement)
 *   - 'by_patient'  → patient_id                          (per-chart listing)
 *   - 'by_created'  → created_at                          (LRU eviction scan)
 */

'use client';

const DB_NAME = 'even-chart-offline';
const DB_VERSION = 1;
const STORE = 'chart_drafts';
const MAX_PER_PATIENT = 200;

export type Draft = {
  id?: number;
  patient_id: string;
  surface: string;       // 'vitals' | 'emar' | 'note' | 'problem' | ...
  field_set: string;     // e.g. 'record-vitals' or the observation code
  payload: unknown;      // arbitrary JSON-serializable body
  created_at: number;
  updated_at: number;
  attempts: number;
  last_error?: string;
};

function openChartDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('by_squash', ['patient_id', 'surface', 'field_set'], { unique: false });
        store.createIndex('by_patient', 'patient_id', { unique: false });
        store.createIndex('by_created', 'created_at', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
}

function tx(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE);
}

/**
 * Enqueue a draft. If a draft with the same (patient_id, surface, field_set)
 * already exists, it's replaced (LWW). Returns the new row's id.
 */
export async function enqueueDraft(input: Omit<Draft, 'id' | 'created_at' | 'updated_at' | 'attempts'>): Promise<number> {
  const db = await openChartDb();
  try {
    const now = Date.now();
    const squashKey: [string, string, string] = [input.patient_id, input.surface, input.field_set];

    // Find any existing row with the same squash key — LWW.
    const existing = await new Promise<Draft | null>((resolve, reject) => {
      const store = tx(db, 'readonly');
      const idx = store.index('by_squash');
      const req = idx.get(squashKey);
      req.onsuccess = () => resolve((req.result as Draft) || null);
      req.onerror = () => reject(req.error);
    });

    return await new Promise<number>((resolve, reject) => {
      const store = tx(db, 'readwrite');
      if (existing?.id !== undefined) {
        store.delete(existing.id);
      }
      const row: Draft = {
        patient_id: input.patient_id,
        surface: input.surface,
        field_set: input.field_set,
        payload: input.payload,
        created_at: existing?.created_at ?? now,
        updated_at: now,
        attempts: 0,
      };
      const req = store.add(row);
      req.onsuccess = () => resolve(req.result as number);
      req.onerror = () => reject(req.error);
    }).then(async (id) => {
      await enforceLru(db, input.patient_id);
      return id;
    });
  } finally {
    db.close();
  }
}

/**
 * Keeps at most MAX_PER_PATIENT rows for this patient; drops oldest.
 */
async function enforceLru(db: IDBDatabase, patient_id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const store = tx(db, 'readwrite');
    const idx = store.index('by_patient');
    const req = idx.getAllKeys(IDBKeyRange.only(patient_id));
    req.onsuccess = () => {
      const keys = (req.result || []) as number[];
      if (keys.length <= MAX_PER_PATIENT) {
        resolve();
        return;
      }
      // Fetch the full rows so we can sort by created_at and drop the oldest.
      const getAll = idx.getAll(IDBKeyRange.only(patient_id));
      getAll.onsuccess = () => {
        const rows = (getAll.result || []) as Draft[];
        rows.sort((a, b) => a.created_at - b.created_at);
        const toDrop = rows.slice(0, rows.length - MAX_PER_PATIENT);
        for (const r of toDrop) if (r.id !== undefined) store.delete(r.id);
        resolve();
      };
      getAll.onerror = () => reject(getAll.error);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function listDrafts(patient_id?: string): Promise<Draft[]> {
  const db = await openChartDb();
  try {
    return await new Promise<Draft[]>((resolve, reject) => {
      const store = tx(db, 'readonly');
      const req = patient_id
        ? store.index('by_patient').getAll(IDBKeyRange.only(patient_id))
        : store.getAll();
      req.onsuccess = () => resolve(((req.result as Draft[]) || []).sort((a, b) => a.created_at - b.created_at));
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function countDrafts(patient_id?: string): Promise<number> {
  const db = await openChartDb();
  try {
    return await new Promise<number>((resolve, reject) => {
      const store = tx(db, 'readonly');
      const req = patient_id
        ? store.index('by_patient').count(IDBKeyRange.only(patient_id))
        : store.count();
      req.onsuccess = () => resolve(req.result as number);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function removeDraft(id: number): Promise<void> {
  const db = await openChartDb();
  try {
    return await new Promise<void>((resolve, reject) => {
      const store = tx(db, 'readwrite');
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function markAttempt(id: number, error?: string): Promise<void> {
  const db = await openChartDb();
  try {
    return await new Promise<void>((resolve, reject) => {
      const store = tx(db, 'readwrite');
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const row = getReq.result as Draft | undefined;
        if (!row) {
          resolve();
          return;
        }
        row.attempts = (row.attempts || 0) + 1;
        row.last_error = error;
        row.updated_at = Date.now();
        const putReq = store.put(row);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  } finally {
    db.close();
  }
}

export async function clearDraftsForPatient(patient_id: string): Promise<void> {
  const db = await openChartDb();
  try {
    return await new Promise<void>((resolve, reject) => {
      const store = tx(db, 'readwrite');
      const idx = store.index('by_patient');
      const req = idx.getAllKeys(IDBKeyRange.only(patient_id));
      req.onsuccess = () => {
        const keys = (req.result || []) as number[];
        for (const k of keys) store.delete(k);
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/**
 * Replay each queued draft through the provided handler. If the handler
 * resolves truthy the row is deleted; if it throws or resolves falsy the
 * row is retained and attempt-counter incremented.
 *
 * Returns { attempted, succeeded, remaining }.
 */
export async function replayDrafts(
  patient_id: string,
  handler: (d: Draft) => Promise<boolean>,
): Promise<{ attempted: number; succeeded: number; remaining: number }> {
  const drafts = await listDrafts(patient_id);
  let succeeded = 0;
  for (const d of drafts) {
    try {
      const ok = await handler(d);
      if (ok && d.id !== undefined) {
        await removeDraft(d.id);
        succeeded++;
      } else if (d.id !== undefined) {
        await markAttempt(d.id, 'handler returned false');
      }
    } catch (err: any) {
      if (d.id !== undefined) {
        await markAttempt(d.id, err?.message || String(err));
      }
    }
  }
  const remaining = await countDrafts(patient_id);
  return { attempted: drafts.length, succeeded, remaining };
}
