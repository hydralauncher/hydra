/** Serialize short read/modify/write operations. Network requests stay outside. */
export class LibraryWriteQueue {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(
    task: () => Promise<T>,
    current: () => boolean = () => true
  ): Promise<T> {
    const result = this.tail
      .catch(() => undefined)
      .then(async () => {
        if (!current()) throw new Error("library-context-changed");
        return task();
      });
    this.tail = result.catch(() => undefined);
    return result;
  }
  async drain() {
    await this.tail;
  }
}
export const libraryWriteQueue = new LibraryWriteQueue();
let hydraPlaytimeRevision = 0;
const hydraPlaytimeRevisions = new Map<string, number>();
export function markHydraPlaytimeChanged(key: string) {
  hydraPlaytimeRevisions.set(key, ++hydraPlaytimeRevision);
}
export const getHydraPlaytimeRevision = (key?: string) =>
  key === undefined
    ? hydraPlaytimeRevision
    : (hydraPlaytimeRevisions.get(key) ?? 0);
let epicConnectionRevision = 0;
let epicConnection: {
  environment: string;
  userId: string;
  generation: number;
  connectionId: string | null;
} | null = null;
export const getEpicLibraryConnectionRevision = () => epicConnectionRevision;
export function setEpicLibraryConnection(
  context: { environment: string; userId: string; generation: number },
  connectionId: string | null
) {
  const sameScope =
    epicConnection?.environment === context.environment &&
    epicConnection.userId === context.userId &&
    epicConnection.generation === context.generation;
  if (
    (epicConnection?.connectionId ?? null) !== connectionId ||
    (!sameScope && epicConnection?.connectionId)
  )
    epicConnectionRevision++;
  epicConnection = { ...context, connectionId };
}
const hydraClaims = new Map<string, number>();
export const hasPendingHydraClaim = (key: string) =>
  (hydraClaims.get(key) ?? 0) > 0;
export async function withHydraClaim<T>(
  key: string,
  task: () => Promise<T>
): Promise<T> {
  hydraClaims.set(key, (hydraClaims.get(key) ?? 0) + 1);
  try {
    return await task();
  } finally {
    const count = (hydraClaims.get(key) ?? 1) - 1;
    if (count) hydraClaims.set(key, count);
    else hydraClaims.delete(key);
  }
}
