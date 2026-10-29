import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { logger } from "./logger";

const execFileAsync = promisify(execFile);

const PROBE_TIMEOUT_MS = 2_000;
const UNAVAILABLE_VERDICT_TTL_MS = 60_000;
const PORTAL_DESTINATION = "org.freedesktop.portal.Desktop";
const PORTAL_OBJECT_PATH = "/org/freedesktop/portal/desktop";
const SCREENCAST_INTERFACE = "org.freedesktop.portal.ScreenCast";

const SCREENCAST_PROBES: [string, string[]][] = [
  [
    "gdbus",
    [
      "call",
      "--session",
      "--dest",
      PORTAL_DESTINATION,
      "--object-path",
      PORTAL_OBJECT_PATH,
      "--method",
      "org.freedesktop.DBus.Properties.Get",
      SCREENCAST_INTERFACE,
      "version",
    ],
  ],
  [
    "busctl",
    [
      "--user",
      "get-property",
      PORTAL_DESTINATION,
      PORTAL_OBJECT_PATH,
      SCREENCAST_INTERFACE,
      "version",
    ],
  ],
];

const isMissingCommand = (error: unknown) =>
  error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT";

const isTimedOutProbe = (error: unknown) =>
  error instanceof Error && (error as { killed?: boolean }).killed === true;

let unavailableUntil = 0;

export const isScreenCastPortalAvailable = async (): Promise<
  boolean | null
> => {
  if (Date.now() < unavailableUntil) return false;

  for (const [command, args] of SCREENCAST_PROBES) {
    try {
      await execFileAsync(command, args, { timeout: PROBE_TIMEOUT_MS });
      return true;
    } catch (error) {
      if (isMissingCommand(error)) continue;
      if (isTimedOutProbe(error)) {
        logger.warn("The ScreenCast portal did not answer in time", {
          command,
          timeoutMs: PROBE_TIMEOUT_MS,
        });
        return null;
      }
      logger.warn("The ScreenCast portal is not available", {
        command,
        error: error instanceof Error ? error.message : String(error),
      });
      unavailableUntil = Date.now() + UNAVAILABLE_VERDICT_TTL_MS;
      return false;
    }
  }
  return null;
};
