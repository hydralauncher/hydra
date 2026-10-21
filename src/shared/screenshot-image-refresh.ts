export const SCREENSHOT_IMAGE_REFRESH_COOLDOWN_MS = 30_000;

interface ScreenshotImageRefresherOptions {
  cooldownMs?: number;
  now?: () => number;
}

export function createScreenshotImageRefresher({
  cooldownMs = SCREENSHOT_IMAGE_REFRESH_COOLDOWN_MS,
  now = Date.now,
}: ScreenshotImageRefresherOptions = {}) {
  const inFlight = new Map<string, Promise<void>>();
  const lastStartedAt = new Map<string, number>();

  const isCoolingDown = (screenshotId: string) => {
    const startedAt = lastStartedAt.get(screenshotId);
    return startedAt !== undefined && now() - startedAt < cooldownMs;
  };

  const run = (
    screenshotId: string,
    refresh: () => Promise<void>
  ): Promise<void> => {
    const pending = inFlight.get(screenshotId);
    if (pending !== undefined) return pending;
    if (isCoolingDown(screenshotId)) return Promise.resolve();

    lastStartedAt.set(screenshotId, now());
    const request = refresh().finally(() => {
      inFlight.delete(screenshotId);
    });
    inFlight.set(screenshotId, request);
    return request;
  };

  return { run };
}

export type ScreenshotImageRefresher = ReturnType<
  typeof createScreenshotImageRefresher
>;
