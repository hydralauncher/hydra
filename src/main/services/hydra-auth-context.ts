export interface HydraApiAuthContext {
  environment: string;
  userId: string;
  generation: number;
}

export function waitForHydraAuthRefresh<T>(
  refresh: Promise<T>,
  options: { signal?: AbortSignal; timeout?: number }
): Promise<T> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(
        Object.assign(new Error("Hydra auth request cancelled"), {
          code: "ERR_CANCELED",
        })
      );
    };
    if (options.signal?.aborted) {
      // Keep observing a shared refresh even when this caller has cancelled.
      void refresh.catch(() => {});
      abort();
      return;
    }
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.timeout !== undefined) {
      timer = setTimeout(() => {
        cleanup();
        reject(
          Object.assign(new Error("Hydra auth request timed out"), {
            code: "ETIMEDOUT",
          })
        );
      }, options.timeout);
    }
    refresh.then(
      (result) => {
        cleanup();
        resolve(result);
      },
      (error) => {
        cleanup();
        reject(error);
      }
    );
  });
}

/** Tracks account changes, rather than access-token refreshes. */
export class HydraAuthContextTracker {
  private current: HydraApiAuthContext | null = null;
  private epoch = 0;
  private listeners = new Set<() => void>();

  get generation() {
    return this.epoch;
  }

  getContext(): HydraApiAuthContext | null {
    return this.current ? { ...this.current } : null;
  }

  isCurrent(context: HydraApiAuthContext) {
    return (
      this.current?.generation === context.generation &&
      this.current.userId === context.userId &&
      this.current.environment === context.environment
    );
  }

  invalidate() {
    this.epoch += 1;
    this.current = null;
    this.notify();
    return this.epoch;
  }

  activate(environment: string, userId: string | null, generation: number) {
    if (generation !== this.epoch) return false;
    this.current = userId ? { environment, userId, generation } : null;
    this.notify();
    return true;
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const listener of this.listeners) {
      // Optional integration listeners must never interrupt Hydra auth.
      try {
        listener();
      } catch {
        // The integration handles its own failures without exposing secrets.
      }
    }
  }
}
