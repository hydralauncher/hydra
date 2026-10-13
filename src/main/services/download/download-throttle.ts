const THROTTLE_CHECK_INTERVAL_MS = 100;

/** One byte budget, shared by every transfer belonging to a download. */
export class DownloadThrottle {
  private limit: number | null = null;
  private windowStart = Date.now();
  private transferredBytes = 0;

  setLimit(limit: number | null): void {
    this.limit =
      typeof limit === "number" && Number.isFinite(limit) && limit > 0
        ? Math.floor(limit)
        : null;
    this.reset();
  }

  reset(): void {
    this.windowStart = Date.now();
    this.transferredBytes = 0;
  }

  async wait(bytes: number, signal?: AbortSignal): Promise<void> {
    await new Promise<void>((resolve) => {
      const check = () => {
        if (signal?.aborted || !this.limit) {
          resolve();
          return;
        }
        const required = ((this.transferredBytes + bytes) * 1000) / this.limit;
        const elapsed = Date.now() - this.windowStart;
        if (elapsed >= required) {
          this.transferredBytes += bytes;
          resolve();
          return;
        }
        setTimeout(
          check,
          Math.min(THROTTLE_CHECK_INTERVAL_MS, Math.max(1, required - elapsed))
        );
      };
      check();
    });
  }
}
