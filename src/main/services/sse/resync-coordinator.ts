interface Waiter {
  signal: AbortSignal;
  resolve: () => void;
  reject: (error: unknown) => void;
}

export class ResyncCoordinator<Scope extends string> {
  private readonly pendingScopes = new Set<Scope>();
  private pendingWaiters: Waiter[] = [];
  private pendingJitter = true;
  private scheduled = false;
  private running = false;

  constructor(
    private readonly run: (
      scopes: ReadonlySet<Scope>,
      signal: AbortSignal,
      jitter: boolean
    ) => Promise<void>
  ) {}

  request(scopes: readonly Scope[], signal: AbortSignal, jitter = false) {
    if (signal.aborted) return Promise.resolve();

    for (const scope of scopes) this.pendingScopes.add(scope);
    this.pendingJitter &&= jitter;

    const promise = new Promise<void>((resolve, reject) => {
      this.pendingWaiters.push({ signal, resolve, reject });
    });

    if (!this.scheduled) {
      this.scheduled = true;
      queueMicrotask(() => void this.drain());
    }

    return promise;
  }

  private async drain() {
    this.scheduled = false;
    if (this.running) return;
    this.running = true;

    try {
      while (this.pendingScopes.size > 0) {
        const scopes = new Set(this.pendingScopes);
        const waiters = this.pendingWaiters;
        const jitter = this.pendingJitter;
        this.pendingScopes.clear();
        this.pendingWaiters = [];
        this.pendingJitter = true;

        const activeWaiters = waiters.filter(({ signal }) => !signal.aborted);
        if (activeWaiters.length > 0) {
          const controller = new AbortController();
          const checkAborted = () => {
            if (activeWaiters.every(({ signal }) => signal.aborted)) {
              controller.abort();
            }
          };
          for (const waiter of activeWaiters) {
            waiter.signal.addEventListener("abort", checkAborted, {
              once: true,
            });
          }

          let error: unknown;
          let failed = false;
          try {
            await this.run(scopes, controller.signal, jitter);
          } catch (runError) {
            failed = true;
            error = runError;
          } finally {
            for (const waiter of activeWaiters) {
              waiter.signal.removeEventListener("abort", checkAborted);
            }
          }

          for (const waiter of waiters) {
            if (failed) waiter.reject(error);
            else waiter.resolve();
          }
        } else {
          for (const waiter of waiters) waiter.resolve();
        }
      }
    } finally {
      this.running = false;
      if (this.pendingScopes.size > 0 && !this.scheduled) {
        this.scheduled = true;
        queueMicrotask(() => void this.drain());
      }
    }
  }
}
