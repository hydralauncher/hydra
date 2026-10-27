import type { Download } from "@types";

interface DownloadStore {
  get(key: string): Promise<Download | undefined>;
  put(key: string, download: Download): Promise<unknown> | unknown;
}

type DownloadPatch =
  | Partial<Download>
  | ((download: Download) => Partial<Download> | undefined);

/** Serialize read/modify/write operations for each download independently. */
export const createDownloadRecordUpdater = (store: DownloadStore) => {
  const pending = new Map<string, Promise<void>>();
  return async (key: string, patch: DownloadPatch) => {
    let updated: Download | undefined;
    const operation = (pending.get(key) ?? Promise.resolve()).then(async () => {
      const current = await store.get(key);
      if (!current) return;
      const changes = typeof patch === "function" ? patch(current) : patch;
      if (!changes) return;
      updated = { ...current, ...changes };
      await store.put(key, updated);
    });
    const tail = operation.then(
      () => undefined,
      () => undefined
    );
    pending.set(key, tail);
    try {
      await operation;
      return updated;
    } finally {
      if (pending.get(key) === tail) pending.delete(key);
    }
  };
};
