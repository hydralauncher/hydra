import type { LocalScreenshot, ProfileScreenshot } from "@types";

export type MyScreenshotsEntry =
  | { kind: "local"; time: number; screenshot: LocalScreenshot }
  | { kind: "uploaded"; time: number; screenshot: ProfileScreenshot };

export const getMyScreenshotsEntryKey = (entry: MyScreenshotsEntry) =>
  entry.kind === "local"
    ? `local:${entry.screenshot.clientId}`
    : `uploaded:${entry.screenshot.id}`;
