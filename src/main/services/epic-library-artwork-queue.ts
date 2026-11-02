import type { LibraryGame } from "@types";

export const EPIC_LIBRARY_ARTWORK_RETRY_MS = 5 * 60 * 1000;
export const EPIC_LIBRARY_ARTWORK_INTERVAL_MS = 6 * 1000;
const MAX_PENDING_GAMES = 128;

/** Resolve public artwork serially without delaying the library response. */
export class EpicLibraryArtworkQueue {
  private readonly pending = new Map<string, LibraryGame>();
  private readonly attemptedAt = new Map<string, number>();
  private readonly scheduled = new Set<string>();
  private library: LibraryGame[] = [];
  private cursor = 0;
  private running = false;

  constructor(
    private readonly refresh: (game: LibraryGame) => Promise<boolean>,
    private readonly changed: () => void,
    private readonly now = Date.now,
    private readonly pause = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms))
  ) {}

  schedule(games: LibraryGame[]) {
    // Collection reads may be partial or empty. Keep unvisited work until the
    // active pass finishes, while allowing newer records to update its entries.
    this.library = this.running
      ? [
          ...new Map(
            [...this.library, ...games].map((game) => [game.id, game])
          ).values(),
        ]
      : games;
    // Expire by time only: a partial read must not reset cooldowns it omits.
    for (const [key, attempted] of this.attemptedAt) {
      if (this.now() - attempted >= EPIC_LIBRARY_ARTWORK_RETRY_MS)
        this.attemptedAt.delete(key);
    }
    this.cursor = 0;
    for (const game of games) {
      if (this.pending.has(game.id)) this.pending.set(game.id, game);
    }
    this.fillPending();
    if (!this.running) void this.drain();
  }

  private fillPending() {
    while (
      this.cursor < this.library.length &&
      this.pending.size < MAX_PENDING_GAMES
    ) {
      const game = this.library[this.cursor++];
      if (game.shop !== "epic" || game.catalogueGame?.shop === "steam")
        continue;
      const key = game.id;
      if (this.scheduled.has(key)) continue;
      this.scheduled.add(key);
      const attempted = this.attemptedAt.get(key);
      if (
        attempted !== undefined &&
        this.now() - attempted < EPIC_LIBRARY_ARTWORK_RETRY_MS
      )
        continue;
      this.pending.set(key, game);
    }
  }

  private async drain() {
    this.running = true;
    try {
      while (this.pending.size) {
        const [key, game] = this.pending.entries().next().value!;
        this.pending.delete(key);
        try {
          if (await this.refresh(game)) this.changed();
        } catch {
          // The normal library remains usable offline; retry on a later read.
        }
        this.attemptedAt.set(key, this.now());
        this.fillPending();
        if (this.pending.size)
          await this.pause(EPIC_LIBRARY_ARTWORK_INTERVAL_MS);
      }
    } finally {
      this.running = false;
      this.library = [];
      this.cursor = 0;
      this.scheduled.clear();
    }
  }
}
