import type { SimClient } from './client';

export const DB_NAME = 'genesis';
export const STORE_NAME = 'saves';
export const AUTOSAVE_NAME = '__autosave';
export const AUTOSAVE_INTERVAL_MS = 60000;

interface SaveRecord {
  name: string;
  json: string;
  savedAt: number;
  bytes: number;
}

function defaultFactory(): IDBFactory {
  return globalThis.indexedDB;
}

// Forced reconciliation (brief deviation, documented in task-44-report.md):
// the brief's literal `savedAt: Date.now()` collides when two saveRun calls
// land in the same millisecond (routine in fast synchronous test code, e.g.
// the 'list returns every saved run, sorted by savedAt descending' case),
// and Array.sort is stable — equal savedAt values then keep insertion order
// instead of the documented "most recent first," failing that test as
// written. A monotonic counter guarantees strictly increasing savedAt values
// (still wall-clock-anchored) across calls within this module's lifetime.
let lastSavedAt = 0;
function nextSavedAt(): number {
  const now = Date.now();
  lastSavedAt = now > lastSavedAt ? now : lastSavedAt + 1;
  return lastSavedAt;
}

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, 1);
    request.onupgradeneeded = (): void => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'name' });
      }
    };
    request.onsuccess = (): void => resolve(request.result);
    request.onerror = (): void => reject(request.error ?? new Error('storage.ts: failed to open genesis db'));
  });
}

/** Contract signature verbatim plus an injectable trailing IDBFactory (defaults to globalThis.indexedDB). */
export function saveRun(name: string, json: string, factory: IDBFactory = defaultFactory()): Promise<void> {
  return openDb(factory).then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const record: SaveRecord = { name, json, savedAt: nextSavedAt(), bytes: json.length };
        const request = store.put(record);
        request.onsuccess = (): void => resolve();
        request.onerror = (): void => reject(request.error ?? new Error('storage.ts: saveRun failed'));
      }),
  );
}

/** Contract signature verbatim plus an injectable trailing IDBFactory. */
export function loadRun(name: string, factory: IDBFactory = defaultFactory()): Promise<string | null> {
  return openDb(factory).then(
    (db) =>
      new Promise<string | null>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(name);
        request.onsuccess = (): void => {
          const record = request.result as SaveRecord | undefined;
          resolve(record !== undefined ? record.json : null);
        };
        request.onerror = (): void => reject(request.error ?? new Error('storage.ts: loadRun failed'));
      }),
  );
}

/** Contract signature verbatim plus an injectable trailing IDBFactory. Sorted by savedAt descending. */
export function listRuns(
  factory: IDBFactory = defaultFactory(),
): Promise<{ name: string; savedAt: number; bytes: number }[]> {
  return openDb(factory).then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.getAll();
        request.onsuccess = (): void => {
          const records = (request.result as SaveRecord[]).slice();
          records.sort((a, b) => b.savedAt - a.savedAt);
          resolve(records.map((r) => ({ name: r.name, savedAt: r.savedAt, bytes: r.bytes })));
        };
        request.onerror = (): void => reject(request.error ?? new Error('storage.ts: listRuns failed'));
      }),
  );
}

/** Contract signature verbatim plus an injectable trailing IDBFactory. */
export function deleteRun(name: string, factory: IDBFactory = defaultFactory()): Promise<void> {
  return openDb(factory).then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.delete(name);
        request.onsuccess = (): void => resolve();
        request.onerror = (): void => reject(request.error ?? new Error('storage.ts: deleteRun failed'));
      }),
  );
}

/**
 * Complete in-memory fake IDBFactory covering exactly the IndexedDB surface
 * storage.ts itself calls: open (with onupgradeneeded/onsuccess/onerror),
 * IDBDatabase.transaction, IDBObjectStore.put/get/getAll/delete, and
 * IDBRequest.onsuccess/onerror. Not a general-purpose polyfill.
 */
export function makeInMemoryIDBFactory(): IDBFactory {
  const stores = new Map<string, Map<string, unknown>>();
  let created = false;

  function makeRequest<T>(work: () => T): IDBRequest<T> {
    const req = {
      result: undefined as unknown as T,
      error: null as DOMException | null,
      onsuccess: null as (() => void) | null,
      onerror: null as (() => void) | null,
    };
    queueMicrotask(() => {
      try {
        req.result = work();
        req.onsuccess?.();
      } catch (err) {
        req.error = err as DOMException;
        req.onerror?.();
      }
    });
    return req as unknown as IDBRequest<T>;
  }

  function makeObjectStore(storeName: string): IDBObjectStore {
    const table = stores.get(storeName) as Map<string, unknown>;
    return {
      put: (value: unknown) => makeRequest(() => {
        table.set((value as { name: string }).name, value);
        return undefined as unknown;
      }),
      get: (key: string) => makeRequest(() => table.get(key)),
      getAll: () => makeRequest(() => Array.from(table.values())),
      delete: (key: string) => makeRequest(() => {
        table.delete(key);
        return undefined as unknown;
      }),
    } as unknown as IDBObjectStore;
  }

  function makeDb(): IDBDatabase {
    return {
      objectStoreNames: {
        contains: (name: string) => stores.has(name),
      },
      createObjectStore: (name: string) => {
        stores.set(name, new Map());
        return makeObjectStore(name);
      },
      transaction: (name: string) => ({
        objectStore: () => makeObjectStore(name),
      }),
    } as unknown as IDBDatabase;
  }

  const factory: Partial<IDBFactory> = {
    open: (_name: string, _version?: number) => {
      const req = {
        result: undefined as unknown as IDBDatabase,
        error: null as DOMException | null,
        onupgradeneeded: null as (() => void) | null,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
      };
      queueMicrotask(() => {
        const db = makeDb();
        req.result = db;
        if (!created) {
          created = true;
          req.onupgradeneeded?.();
        }
        req.onsuccess?.();
      });
      return req as unknown as IDBOpenDBRequest;
    },
  };

  return factory as IDBFactory;
}

export interface AutosaveHandle {
  stop(): void;
}

/**
 * Additive (contract only names the 60s autosave interval). Sends a
 * 'serialize' request every AUTOSAVE_INTERVAL_MS and writes the result to
 * AUTOSAVE_NAME. `active` guards the subscription (SimClient's onSerialized
 * is append-only/never-unsubscribed) so stop() can cheaply disable writes
 * without needing an unsubscribe API on SimClient.
 */
export function startAutosave(client: SimClient, factory: IDBFactory = defaultFactory()): AutosaveHandle {
  let active = true;

  client.onSerialized((json) => {
    if (!active) return;
    void saveRun(AUTOSAVE_NAME, json, factory);
  });

  const interval = setInterval(() => {
    if (!active) return;
    client.send({ type: 'serialize' });
  }, AUTOSAVE_INTERVAL_MS);

  return {
    stop(): void {
      active = false;
      clearInterval(interval);
    },
  };
}
