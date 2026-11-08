const DB_NAME = "church-radar";
const STORE = "cache";
const memory = new Map<string, { value: unknown; storedAt: number }>();

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDatabase(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") {
        resolve(null);
        return;
      }
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

export interface CacheEntry<T> {
  value: T;
  storedAt: number;
}

export async function cacheGet<T>(key: string): Promise<CacheEntry<T> | null> {
  const local = memory.get(key);
  if (local) return local as CacheEntry<T>;

  const db = await openDatabase();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).get(key);
      request.onsuccess = () => {
        const entry = request.result as CacheEntry<T> | undefined;
        if (!entry) {
          resolve(null);
          return;
        }
        memory.set(key, entry as { value: unknown; storedAt: number });
        resolve(entry);
      };
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function cacheSet(key: string, value: unknown): Promise<void> {
  const entry = { value, storedAt: Date.now() };
  memory.set(key, entry);

  const db = await openDatabase();
  if (!db) return;

  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(entry, key);
  } catch {
    /* cache is best effort */
  }
}
