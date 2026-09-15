export type StoredResearchImage = { id: string; name: string; type: string; size: number; blob: Blob };
export type ResearchDraft = { id: string; topic: string; text: string; images: StoredResearchImage[]; savedAt: string };
const DB_NAME = "speakomo-recovery";
const STORE_NAME = "research-drafts";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveResearchDraft(draft: ResearchDraft) { const database = await openDatabase(); return new Promise<void>((resolve, reject) => { const transaction = database.transaction(STORE_NAME, "readwrite"); transaction.objectStore(STORE_NAME).put(draft); transaction.oncomplete = () => { database.close(); resolve(); }; transaction.onerror = () => { database.close(); reject(transaction.error); }; }); }
export async function loadResearchDraft(id: string): Promise<ResearchDraft | null> { const database = await openDatabase(); return new Promise((resolve, reject) => { const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(id); request.onsuccess = () => { database.close(); resolve((request.result as ResearchDraft | undefined) ?? null); }; request.onerror = () => { database.close(); reject(request.error); }; }); }
export async function deleteResearchDraft(id: string) { const database = await openDatabase(); return new Promise<void>((resolve, reject) => { const transaction = database.transaction(STORE_NAME, "readwrite"); transaction.objectStore(STORE_NAME).delete(id); transaction.oncomplete = () => { database.close(); resolve(); }; transaction.onerror = () => { database.close(); reject(transaction.error); }; }); }