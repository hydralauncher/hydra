import { watch, type FSWatcher } from "node:fs";

const TROPHY_DEBOUNCE_DELAY_MS = 180;
const TROPHY_MAX_READ_RETRIES = 5;
const TROPHY_RETRY_BASE_DELAY_MS = 100;
const TROPHY_RETRY_BACKOFF_MULTIPLIER = 2;

/** Directory watching survives RPCS3 replacing TROPUSR.DAT. Retries are bounded and event-driven. */
export class TrophyWatcher {
  private watchers: FSWatcher[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private dirty = false;
  private closed = false;
  private retries = 0;

  constructor(
    private readonly refresh: () => Promise<void>,
    private readonly onError: (error: unknown) => void = () => {}
  ) {}

  setDirectories(
    directories: string[],
    relevantNames: ReadonlyMap<string, ReadonlySet<string>> = new Map()
  ) {
    for (const watcher of this.watchers) watcher.close();
    this.watchers = [];
    if (this.closed) return;
    for (const directory of new Set(directories)) {
      try {
        const names = relevantNames.get(directory);
        const watcher = watch(
          directory,
          { persistent: false },
          (_event, filename) => {
            if (
              !filename ||
              !names ||
              names.has(filename.toString().toLowerCase())
            )
              this.trigger();
          }
        );
        watcher.on("error", (error) => {
          this.onError(error);
          this.trigger();
        });
        this.watchers.push(watcher);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          this.onError(error);
      }
    }
  }

  trigger() {
    if (this.closed) return;
    this.dirty = true;
    this.retries = 0;
    this.schedule(TROPHY_DEBOUNCE_DELAY_MS);
  }

  private schedule(delay: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, delay);
    this.timer.unref?.();
  }

  private async run() {
    if (this.closed || this.running) return;
    this.running = true;
    this.dirty = false;
    try {
      await this.refresh();
      this.retries = 0;
    } catch (error) {
      this.onError(error);
      if (++this.retries <= TROPHY_MAX_READ_RETRIES)
        this.schedule(
          TROPHY_RETRY_BASE_DELAY_MS *
            TROPHY_RETRY_BACKOFF_MULTIPLIER ** this.retries
        );
    } finally {
      this.running = false;
      if (this.dirty && !this.closed) this.schedule(TROPHY_DEBOUNCE_DELAY_MS);
    }
  }

  close() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const watcher of this.watchers) watcher.close();
    this.watchers = [];
  }
}
