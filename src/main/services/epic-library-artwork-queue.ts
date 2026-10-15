import type { LibraryGame } from "@types";

export const EPIC_LIBRARY_ARTWORK_RETRY_MS = 5 * 60 * 1000;
export const EPIC_LIBRARY_ARTWORK_INTERVAL_MS = 6 * 1000;
const MAX_PENDING_GAMES = 128;
const MAX_RECENT_GAMES = 512;

/** Resolve public artwork serially without delaying the library response. */
export class EpicLibraryArtworkQueue {
  private readonly pending = new Map<string, LibraryGame>();
  private readonly attemptedAt = new Map<string, number>();
  private running = false;

  constructor(
    private readonly refresh: (game: LibraryGame) => Promise<boolean>,
    private readonly changed: () => void,
    private readonly now = Date.now,
    private readonly pause = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms))
  ) {}

  schedule(games: LibraryGame[]) {
    for (const [key, attempted] of this.attemptedAt) {
      if (this.now() - attempted >= EPIC_LIBRARY_ARTWORK_RETRY_MS)
        this.attemptedAt.delete(key);
    }
    for (const game of games) {
      if (game.shop !== "epic" || game.catalogueGame?.shop === "steam")
        continue;
      const key = game.id;
      const attempted = this.attemptedAt.get(key);
      if (
        (attempted !== undefined &&
          this.now() - attempted < EPIC_LIBRARY_ARTWORK_RETRY_MS) ||
        this.pending.has(key) ||
        this.pending.size >= MAX_PENDING_GAMES ||
        this.attemptedAt.size + this.pending.size >= MAX_RECENT_GAMES
      )
        continue;
      this.pending.set(key, game);
    }
    if (!this.running) void this.drain();
  }

  private async drain() {
    this.running = true;
    try {
      while (this.pending.size) {
        const [key, game] = this.pending.entries().next().value!;
        this.pending.delete(key);
        this.attemptedAt.set(key, this.now());
        try {
          if (await this.refresh(game)) this.changed();
        } catch {
          // The normal library remains usable offline; retry on a later read.
        }
        if (this.pending.size)
          await this.pause(EPIC_LIBRARY_ARTWORK_INTERVAL_MS);
      }
    } finally {
      this.running = false;
    }
  }
}
