import { watch } from "node:fs";
import path from "node:path";

const TROPHY_DEBOUNCE_DELAY_MS = 180;
const TROPHY_MAX_READ_RETRIES = 5;
const TROPHY_RETRY_BASE_DELAY_MS = 100;
const TROPHY_RETRY_BACKOFF_MULTIPLIER = 2;

type WatchDirectory = (
  directory: string,
  changed: (filename: string | null) => void,
  failed: (error: unknown) => void
) => { close(): void };

interface Subscription {
  active: boolean;
  names: ReadonlySet<string> | undefined;
  changed: () => void;
  failed: (error: unknown) => void;
  close: () => void;
}

const watchDirectory: WatchDirectory = (directory, changed, failed) => {
  const watcher = watch(directory, { persistent: false }, (_event, filename) =>
    changed(filename?.toString().toLowerCase() ?? null)
  );
  watcher.on("error", failed);
  return watcher;
};

/** One OS watch per directory, with independent filters and refresh budgets per game. */
export class TrophyWatchRegistry {
  private readonly directories = new Map<
    string,
    { watcher: { close(): void }; subscribers: Set<Subscription> }
  >();

  constructor(private readonly createWatch: WatchDirectory = watchDirectory) {}

  subscribe(
    directory: string,
    names: ReadonlySet<string> | undefined,
    changed: () => void,
    failed: (error: unknown) => void
  ): Subscription {
    let entry = this.directories.get(directory);
    if (!entry) {
      const subscribers = new Set<Subscription>();
      const watcher = this.createWatch(
        directory,
        (filename) => {
          for (const subscriber of subscribers) {
            if (
              !filename ||
              !subscriber.names ||
              subscriber.names.has(filename)
            )
              subscriber.changed();
          }
        },
        (error) => {
          if (!subscribers.size) return;
          this.directories.delete(directory);
          watcher.close();
          for (const subscriber of subscribers) {
            subscriber.active = false;
            subscriber.failed(error);
          }
          subscribers.clear();
        }
      );
      entry = { watcher, subscribers };
      this.directories.set(directory, entry);
    }
    const subscription: Subscription = {
      active: true,
      names,
      changed,
      failed,
      close: () => {
        if (!subscription.active) return;
        subscription.active = false;
        entry.subscribers.delete(subscription);
        if (!entry.subscribers.size) {
          this.directories.delete(directory);
          entry.watcher.close();
        }
      },
    };
    entry.subscribers.add(subscription);
    return subscription;
  }
}

const sharedRegistry = new TrophyWatchRegistry();

/** Directory watching survives RPCS3 replacing TROPUSR.DAT. Retries are bounded and event-driven. */
export class TrophyWatcher {
  private readonly watchers = new Map<string, Subscription>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private dirty = false;
  private closed = false;
  private retries = 0;

  constructor(
    private readonly refresh: () => Promise<void>,
    private readonly onError: (error: unknown) => void = () => {},
    private readonly registry = sharedRegistry
  ) {}

  setDirectories(
    directories: string[],
    relevantNames: ReadonlyMap<string, ReadonlySet<string>> = new Map()
  ) {
    if (this.closed) return;
    const requested = new Map(
      directories.map((directory) => [
        path.resolve(directory),
        relevantNames.get(directory),
      ])
    );
    for (const [directory, subscription] of this.watchers) {
      if (!requested.has(directory) || !subscription.active) {
        subscription.close();
        this.watchers.delete(directory);
      }
    }
    for (const [directory, names] of requested) {
      const existing = this.watchers.get(directory);
      if (existing) {
        existing.names = names;
        continue;
      }
      try {
        const subscription = this.registry.subscribe(
          directory,
          names,
          () => this.trigger(),
          (error) => {
            this.onError(error);
            this.trigger();
          }
        );
        this.watchers.set(directory, subscription);
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
    for (const subscription of this.watchers.values()) subscription.close();
    this.watchers.clear();
  }
}
