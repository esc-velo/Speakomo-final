export type StoredSpeechMeta = {
  sessionId: string;
  idempotencyKey: string;
  cueMode: "research_grounded" | "generic";
  startedAtEpochMs: number;
  endedAtEpochMs: number | null;
  actualDurationMs: number | null;
  stoppedReason: "early_stop" | "auto_stop" | "interrupted" | null;
  audioMime: string | null;
  audioBytes: number | null;
  uploadStatus: "local_only" | "upload_not_connected" | "uploading" | "uploaded" | "failed";
  serverSyncStatus: "not_connected" | "synced" | "failed";
};

const DB_NAME = "speakomo-recovery";
const STORE_META = "speech-meta";
const STORE_BLOB = "speech-blob";
const DB_VERSION = 2;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("research-drafts")) database.createObjectStore("research-drafts", { keyPath: "id" });
      if (!database.objectStoreNames.contains(STORE_META)) database.createObjectStore(STORE_META, { keyPath: "sessionId" });
      if (!database.objectStoreNames.contains(STORE_BLOB)) database.createObjectStore(STORE_BLOB, { keyPath: "sessionId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveSpeechMeta(meta: StoredSpeechMeta) {
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_META, "readwrite");
    transaction.objectStore(STORE_META).put(meta);
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
  });
}

export async function loadSpeechMeta(sessionId: string): Promise<StoredSpeechMeta | null> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE_META, "readonly").objectStore(STORE_META).get(sessionId);
    request.onsuccess = () => { database.close(); resolve((request.result as StoredSpeechMeta | undefined) ?? null); };
    request.onerror = () => { database.close(); reject(request.error); };
  });
}

export async function saveSpeechBlob(sessionId: string, blob: Blob) {
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_BLOB, "readwrite");
    transaction.objectStore(STORE_BLOB).put({ sessionId, blob, size: blob.size, type: blob.type, savedAtEpochMs: Date.now() });
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
  });
}

export async function loadSpeechBlob(sessionId: string): Promise<Blob | null> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE_BLOB, "readonly").objectStore(STORE_BLOB).get(sessionId);
    request.onsuccess = () => {
      database.close();
      const record = request.result as { blob?: Blob } | undefined;
      resolve(record?.blob ?? null);
    };
    request.onerror = () => { database.close(); reject(request.error); };
  });
}

export async function deleteSpeech(sessionId: string) {
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction([STORE_META, STORE_BLOB], "readwrite");
    transaction.objectStore(STORE_META).delete(sessionId);
    transaction.objectStore(STORE_BLOB).delete(sessionId);
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
  });
}
