import type {
  ScreenshotTelemetryEvent,
  ScreenshotTelemetryEventType,
} from "@types";

import { isRejectedGroupedSouvenirRequest } from "../achievements/grouped-souvenir-retry-policy";
import { HydraApi } from "../hydra-api";
import { logger } from "../logger";

const FLUSH_INTERVAL_MS = 5 * 60_000;
const MAX_EVENTS_PER_REQUEST = 50;
const MAX_PENDING_KEYS = 200;

const counters = new Map<string, ScreenshotTelemetryEvent>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing: Promise<void> | null = null;

const getPlatform = (): ScreenshotTelemetryEvent["platform"] | null => {
  if (process.platform === "win32") return "win32";
  if (process.platform === "linux") return "linux";
  return null;
};

const MAX_LABEL_LENGTH = 48;
const MAX_EVENT_COUNT = 1000;

export const normalizeTelemetryLabel = (value: string | undefined) => {
  if (!value) return undefined;

  const normalized = value
    .toLowerCase()
    .replaceAll("/", ".")
    .replaceAll(/[^a-z0-9_.-]/g, "_")
    .replace(/^[^a-z0-9]+/, "")
    .slice(0, MAX_LABEL_LENGTH);

  return normalized || undefined;
};

const getCounterKey = (event: Omit<ScreenshotTelemetryEvent, "count">) =>
  [event.type, event.outcome, event.reason ?? "", event.platform].join("|");

const scheduleFlush = () => {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void ScreenshotTelemetry.flush();
  }, FLUSH_INTERVAL_MS);
  flushTimer.unref?.();
};

const addToCounter = (key: string, event: ScreenshotTelemetryEvent) => {
  const current = counters.get(key);
  if (current) {
    current.count = Math.min(MAX_EVENT_COUNT, current.count + event.count);
    return;
  }
  if (counters.size < MAX_PENDING_KEYS) counters.set(key, { ...event });
};

const requeueCounters = (entries: [string, ScreenshotTelemetryEvent][]) => {
  for (const [key, event] of entries) addToCounter(key, event);
};

const trySendBatch = async (
  events: ScreenshotTelemetryEvent[]
): Promise<"sent" | "dropped" | "retry"> => {
  try {
    await HydraApi.post("/screenshots/telemetry", { events });
    return "sent";
  } catch (error) {
    logger.warn("Failed to send screenshot telemetry", error);
    return isRejectedGroupedSouvenirRequest(error) ? "dropped" : "retry";
  }
};

export class ScreenshotTelemetry {
  public static record(
    type: ScreenshotTelemetryEventType,
    outcome: string,
    reason?: string
  ) {
    const platform = getPlatform();
    if (!platform) return;

    const normalizedOutcome = normalizeTelemetryLabel(outcome);
    if (!normalizedOutcome) return;

    const normalizedReason = normalizeTelemetryLabel(reason);
    const event = {
      type,
      outcome: normalizedOutcome,
      ...(normalizedReason ? { reason: normalizedReason } : {}),
      platform,
    };
    addToCounter(getCounterKey(event), { ...event, count: 1 });
    scheduleFlush();
  }

  public static flush() {
    flushing ??= this.flushPending().finally(() => {
      flushing = null;
    });
    return flushing;
  }

  private static async flushPending() {
    if (!counters.size) return;
    if (!HydraApi.isLoggedIn()) {
      scheduleFlush();
      return;
    }

    const pending = [...counters.entries()];
    counters.clear();

    for (
      let index = 0;
      index < pending.length;
      index += MAX_EVENTS_PER_REQUEST
    ) {
      const batch = pending.slice(index, index + MAX_EVENTS_PER_REQUEST);
      const sent = await trySendBatch(batch.map(([, event]) => event));
      if (sent === "retry") {
        requeueCounters(pending.slice(index));
        scheduleFlush();
        return;
      }
    }
  }
}
