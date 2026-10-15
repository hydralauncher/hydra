const THROTTLE_CHECK_INTERVAL_MS = 100;

/** One byte budget, shared by every transfer belonging to a download. */
export class DownloadThrottle {
  private limit: number | null = null;
  private updatedAt = Date.now();
  private availableBytes = 0;

  setLimit(limit: number | null): void {
    this.limit =
      typeof limit === "number" && Number.isFinite(limit) && limit >= 1
        ? Math.floor(limit)
        : null;
    this.reset();
  }

  reset(): void {
    this.updatedAt = Date.now();
    this.availableBytes = 0;
  }

  async wait(bytes: number, signal?: AbortSignal): Promise<void> {
    let remaining = bytes;
    await new Promise<void>((resolve) => {
      const check = () => {
        if (signal?.aborted || !this.limit) {
          resolve();
          return;
        }
        const now = Date.now();
        const elapsed = Math.max(0, now - this.updatedAt);
        // Keep at most one second of idle credit across all workers.
        this.availableBytes = Math.min(
          this.limit,
          this.availableBytes + (elapsed * this.limit) / 1000
        );
        this.updatedAt = now;
        const consumed = Math.min(remaining, this.availableBytes);
        remaining -= consumed;
        this.availableBytes -= consumed;
        if (remaining <= 0) {
          resolve();
          return;
        }
        setTimeout(
          check,
          Math.min(
            THROTTLE_CHECK_INTERVAL_MS,
            Math.max(1, (remaining * 1000) / this.limit)
          )
        );
      };
      check();
    });
  }
}
