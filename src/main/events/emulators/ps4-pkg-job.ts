import type {
  GameShop,
  Ps4PkgFailure,
  Ps4PkgJobEvent,
  Ps4PkgJobMode,
  Ps4PkgResult,
} from "@types";
import { gamesSublevel, levelKeys } from "@main/level";
import { logger, WindowManager } from "@main/services";
import { Ps4PkgError } from "@main/services/ps4-pkg";

export const PS4_PKG_FAILURE_REASONS: Record<string, Ps4PkgFailure> = {
  missing_base_game: "no_game_folder",
  other_game: "other_game",
  not_newer: "not_newer",
  no_space: "no_space",
  keys_unavailable: "keys_unavailable",
  cancelled: "cancelled",
};

const PROGRESS_EVENT_INTERVAL_MS = 200;

let running: { objectId: string; controller: AbortController } | null = null;

export const toPs4PkgFailure = (error: unknown): Ps4PkgFailure => {
  const code = error instanceof Ps4PkgError ? error.code : "failed";
  return PS4_PKG_FAILURE_REASONS[code] ?? "failed";
};

const sendJob = (event: Ps4PkgJobEvent) =>
  WindowManager.sendToAppWindows("on-ps4-pkg-job", event);

/** "0109" → "01.09". */
export const formatPs4Version = (version: string | null | undefined) => {
  const digits = version?.replace(/\D/g, "");
  if (!digits) return null;
  return digits.length > 2
    ? `${digits.slice(0, -2)}.${digits.slice(-2)}`
    : digits;
};

export const isPs4PkgJobRunning = () => running !== null;

/** The game files are being written, so the game must not start. */
export const isPs4PkgJobRunningFor = (objectId: string) =>
  running?.objectId === objectId;

/** Runs one PKG job at a time and tells every window how it goes. */
export const runPs4PkgJob = async (
  shop: GameShop,
  objectId: string,
  mode: Ps4PkgJobMode,
  versions: { version?: string | null; currentVersion?: string | null },
  work: (
    signal: AbortSignal,
    onProgress: (fraction: number) => void
  ) => Promise<{ version: string | null }>
): Promise<Ps4PkgResult> => {
  if (running) return { ok: false, reason: "busy" };

  const controller = new AbortController();
  running = { objectId, controller };
  const game = await gamesSublevel
    .get(levelKeys.game(shop, objectId))
    .catch(() => undefined);
  const base = { shop, objectId, mode, title: game?.title ?? "", ...versions };

  let lastSent = 0;
  const onProgress = (progress: number) => {
    const now = Date.now();
    if (
      progress > 0 &&
      progress < 1 &&
      now - lastSent < PROGRESS_EVENT_INTERVAL_MS
    ) {
      return;
    }
    lastSent = now;
    sendJob({ ...base, phase: "progress", progress });
  };

  try {
    sendJob({ ...base, phase: "start", progress: 0 });
    const { version } = await work(controller.signal, onProgress);
    WindowManager.sendToAppWindows("on-library-batch-complete");
    sendJob({ ...base, phase: "done", progress: 1, version });
    return { ok: true, version };
  } catch (error) {
    const reason = toPs4PkgFailure(error);
    if (reason !== "cancelled") logger.error("PS4 PKG job failed", error);
    sendJob({
      ...base,
      phase: reason === "cancelled" ? "cancelled" : "error",
      progress: 0,
      reason,
    });
    return { ok: false, reason };
  } finally {
    running = null;
  }
};

export const cancelPs4PkgJob = () => running?.controller.abort();
