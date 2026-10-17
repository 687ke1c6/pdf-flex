// The app's IndexedDB database, shared by the signature library and drafts.
// Each version's upgrade only adds what it introduced, so older data survives.
import type { Draft } from "../drafts/draftStore";
import { migrateDraft, migrateFileKey } from "../drafts/migrate";

const DB_NAME = "pdf-flex";
const DB_VERSION = 3;

/** Object stores, keyed by `id`. */
export type StoreName = "signatures" | "drafts" | "draftFiles";

let dbPromise: Promise<IDBDatabase> | undefined;

function db(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = request.result;
      // Version 1: the signature library.
      if (e.oldVersion < 1) db.createObjectStore("signatures", { keyPath: "id" });
      // Version 2: drafts, with each draft's PDF in its own store so autosaving never rewrites it.
      if (e.oldVersion < 2) {
        db.createObjectStore("drafts", { keyPath: "id" });
        db.createObjectStore("draftFiles", { keyPath: "id" });
      }
      // Version 3: drafts have their own ids and record every PDF they use; each PDF is stored as "<draft id>:<hash>".
      if (e.oldVersion >= 2 && e.oldVersion < 3) migrateDrafts(request.transaction!);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    // Another tab still has the old version open; it lets go when it sees this one (below).
    request.onblocked = () => console.warn("Waiting for another pdf-flex tab to release the database");
  }).then((db) => {
    // A newer version opened in another tab: let it upgrade, and reconnect next time.
    db.onversionchange = () => {
      db.close();
      dbPromise = undefined;
    };
    return db;
  });
  dbPromise = opening;
  return opening;
}

/** Version 3's upgrade, inside the upgrade transaction (so it's all or nothing). */
function migrateDrafts(tx: IDBTransaction) {
  tx.objectStore("drafts").openCursor().onsuccess = (e) => {
    const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
    if (!cursor) return;
    cursor.update(migrateDraft(cursor.value as Draft));
    cursor.continue();
  };
  const files = tx.objectStore("draftFiles");
  files.openCursor().onsuccess = (e) => {
    const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
    if (!cursor) return;
    const key = migrateFileKey(String(cursor.key));
    if (key) {
      files.put({ ...cursor.value, id: key });
      cursor.delete();
    }
    cursor.continue();
  };
}

/** Runs one request in its own transaction and resolves when the transaction commits. */
export async function run<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const tx = (await db()).transaction(store, mode);
  const request = op(tx.objectStore(store));
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = tx.onabort = () => reject(tx.error ?? request.error);
  });
}

/** Runs several writes across stores in one transaction: all of them happen, or none. */
export async function runAll(stores: StoreName[], ops: (tx: IDBTransaction) => void): Promise<void> {
  const tx = (await db()).transaction(stores, "readwrite");
  ops(tx);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

/** A document's identity: the SHA-256 of its bytes, in hex. The same file always gets the same id. */
export async function documentId(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
