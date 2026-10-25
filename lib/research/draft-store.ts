export type StoredResearchImage = { id: string; name: string; type: string; size: number; blob: Blob };
export type ResearchDraft = { id: string; topic: string; text: string; images: StoredResearchImage[]; savedAt: string };
const DB_NAME = "speakomo-recovery";
const DB_VERSION = 2;
const STORE_NAME = "research-drafts";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: "id" });
      // Keep in sync with audio-store.ts so either module can perform the upgrade
      if (!database.objectStoreNames.contains("speech-meta")) database.createObjectStore("speech-meta", { keyPath: "sessionId" });
      if (!database.objectStoreNames.contains("speech-blob")) database.createObjectStore("speech-blob", { keyPath: "sessionId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveResearchDraft(draft: ResearchDraft) { const database = await openDatabase(); return new Promise<void>((resolve, reject) => { const transaction = database.transaction(STORE_NAME, "readwrite"); transaction.objectStore(STORE_NAME).put(draft); transaction.oncomplete = () => { database.close(); resolve(); }; transaction.onerror = () => { database.close(); reject(transaction.error); }; }); }
export async function loadResearchDraft(id: string): Promise<ResearchDraft | null> { const database = await openDatabase(); return new Promise((resolve, reject) => { const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(id); request.onsuccess = () => { database.close(); resolve((request.result as ResearchDraft | undefined) ?? null); }; request.onerror = () => { database.close(); reject(request.error); }; }); }
export async function deleteResearchDraft(id: string) { const database = await openDatabase(); return new Promise<void>((resolve, reject) => { const transaction = database.transaction(STORE_NAME, "readwrite"); transaction.objectStore(STORE_NAME).delete(id); transaction.oncomplete = () => { database.close(); resolve(); }; transaction.onerror = () => { database.close(); reject(transaction.error); }; }); }