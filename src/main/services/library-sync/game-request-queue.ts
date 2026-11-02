export const HYDRA_GAME_REQUEST_TIMEOUT_MS = 20_000;

/** Preserve the order of Hydra writes for games also touched by a batch. */
export class GameRequestQueue {
  private readonly tails = new Map<string, Promise<void>>();
  run<T>(
    keys: string[],
    task: () => Promise<T>,
    current: () => boolean
  ): Promise<T> {
    const unique = [...new Set(keys)];
    const result = Promise.all(unique.map((key) => this.tails.get(key))).then(
      async () => {
        if (!current()) throw new Error("library-context-changed");
        return task();
      }
    );
    const tail = result.then(
      () => undefined,
      () => undefined
    );
    for (const key of unique) this.tails.set(key, tail);
    void tail.then(() => {
      for (const key of unique)
        if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }
}
export const gameRequestQueue = new GameRequestQueue();
