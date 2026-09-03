const DB_NAME = 'voiceout-record';
const STORE = 'drafts';
const KEY = 'current';

export type RecordDraft = {
  caption: string;
  durationMs: number;
  durationCap: number;
  audio: ArrayBuffer;
  audioMime: string;
  images: Array<{ name: string; type: string; buffer: ArrayBuffer }>;
  savedAt: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB'));
  });
}

export async function saveRecordDraft(draft: RecordDraft): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(draft, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('save draft'));
  });
  db.close();
}

export async function loadRecordDraft(): Promise<RecordDraft | null> {
  const db = await openDb();
  const draft = await new Promise<RecordDraft | null>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve((req.result as RecordDraft | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error('load draft'));
  });
  db.close();
  if (!draft) return null;
  // Drop drafts older than 24h.
  if (Date.now() - draft.savedAt > 24 * 60 * 60 * 1000) {
    await clearRecordDraft();
    return null;
  }
  return draft;
}

export async function clearRecordDraft(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('clear draft'));
  });
  db.close();
}
