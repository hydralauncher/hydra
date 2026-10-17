import path from "node:path";
import type { EpicInstallation } from "../../../types/epic-managed.types";
import { isRecord } from "./auth-protocol.js";

export class EpicSaveFailure extends Error {
  constructor(
    public readonly code: import("../../../types/epic-managed.types").EpicSaveError
  ) {
    super(code);
    this.name = "EpicSaveFailure";
  }
}

export interface EpicSaveMetadata {
  folder: string | null;
  include: string[];
  exclude: string[];
}

export function parseEpicSaveMetadata(
  input: unknown,
  platform: "Windows" | "Mac"
): EpicSaveMetadata {
  const game =
    isRecord(input) && isRecord(input.metadata) ? input.metadata : input;
  const attrs =
    isRecord(game) && isRecord(game.customAttributes)
      ? game.customAttributes
      : {};
  const value = (key: string) => {
    const attr = attrs[key];
    return isRecord(attr) && typeof attr.value === "string" ? attr.value : null;
  };
  return {
    folder: value(
      platform === "Mac" ? "CloudSaveFolder_MAC" : "CloudSaveFolder"
    ),
    include: value("CloudIncludeList")?.split(",").filter(Boolean) ?? [],
    exclude: value("CloudExcludeList")?.split(",").filter(Boolean) ?? [],
  };
}

// Matches Legendary 0.21.1 SaveGameHelper: directory prefix, suffix, then fnmatch.
export function matchesEpicSaveFilter(
  filename: string,
  pattern: string,
  windows = process.platform === "win32"
) {
  if (windows) {
    filename = filename.toLowerCase();
    pattern = pattern.toLowerCase();
  }
  if (
    (pattern.endsWith("/") && filename.startsWith(pattern)) ||
    filename.endsWith(pattern)
  )
    return true;
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const character = pattern[i];
    if (character === "*") source += ".*";
    else if (character === "?") source += ".";
    else if (character === "[") {
      const end = pattern.indexOf("]", i + 1);
      if (end > i + 1) {
        const body = pattern.slice(i + 1, end);
        source += `[${body.startsWith("!") ? `^${body.slice(1)}` : body.replace(/^\^/, "\\^")}]`;
        i = end;
      } else source += "\\[";
    } else source += character.replace(/[\\^$+?.()|{}]/g, "\\$&");
  }
  try {
    return new RegExp(`^${source}$`, "u").test(filename);
  } catch {
    return false;
  }
}

export const isEpicSaveFile = (filename: string, metadata: EpicSaveMetadata) =>
  (!metadata.include.length ||
    metadata.include.some((pattern) =>
      matchesEpicSaveFilter(filename, pattern)
    )) &&
  !metadata.exclude.some((pattern) => matchesEpicSaveFilter(filename, pattern));

export function resolveEpicSavePath(
  folder: string | null,
  variables: Record<string, string>,
  paths: typeof path = path
): string | null {
  if (!folder) return null;
  const replaced = folder.replace(
    /\{[^}]+\}/g,
    (token) => variables[token.toLowerCase()] || token
  );
  if (/[{}%\0]/.test(replaced) || !paths.isAbsolute(replaced)) return null;
  const resolved = paths.resolve(replaced);
  if (resolved === paths.parse(resolved).root) return null;
  return resolved;
}

const manifestPattern = /^\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}\.manifest$/;
export interface EpicRemoteSaveManifest {
  name: string;
  lastModified: string;
}

export function isEpicRemoteSaveTimestamp(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value)
  )
    return false;
  const date = new Date(value);
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 19) === value.slice(0, 19)
  );
}

export const sameEpicRemoteSaveManifest = (
  left: EpicRemoteSaveManifest | null,
  right: EpicRemoteSaveManifest | null
) => left?.name === right?.name && left?.lastModified === right?.lastModified;

export function parseEpicRemoteManifest(
  input: unknown,
  artifactId: string,
  accountId: string
): EpicRemoteSaveManifest | null {
  if (!isRecord(input) || !isRecord(input.files))
    throw new EpicSaveFailure("save-sync-failed");
  const prefix = `savesync/${accountId}/${artifactId}/manifests/`;
  let selected: EpicRemoteSaveManifest | null = null;
  let latest = "";
  for (const [filename, metadata] of Object.entries(input.files)) {
    const name = filename.slice(prefix.length);
    if (
      !filename.startsWith(prefix) ||
      !manifestPattern.test(name) ||
      !isRecord(metadata) ||
      !isEpicRemoteSaveTimestamp(metadata.lastModified)
    )
      throw new EpicSaveFailure("save-sync-failed");
    // Legendary sorts by remote lastModified, retaining response order for ties.
    // Preserve Python datetime's microsecond precision rather than truncating to JS milliseconds.
    const [seconds, fraction = ""] = metadata.lastModified
      .slice(0, -1)
      .split(".");
    const timestamp = `${seconds}.${fraction.padEnd(6, "0")}Z`;
    if (timestamp >= latest) {
      latest = timestamp;
      selected = { name, lastModified: metadata.lastModified };
    }
  }
  return selected;
}

export function assertEpicSaveCommandSucceeded(
  result: { stdout: string; stderr: string },
  transfer?: "upload" | "download"
) {
  const text = `${result.stdout}\n${result.stderr}`;
  if (
    /\b(?:ERROR|FATAL|CRITICAL):|Traceback|may be incomplete|may be corrupted|No chunks were available|unprocessed variables|Unable to lock install/i.test(
      text
    )
  )
    throw new EpicSaveFailure("save-sync-failed");
  if (transfer === "upload" && !text.includes("Finished uploading savegame."))
    throw new EpicSaveFailure("save-verification-failed");
  if (
    transfer === "download" &&
    !text.includes("Successfully completed savegame download.")
  )
    throw new EpicSaveFailure("save-verification-failed");
}

export function decideEpicSaveSync(
  anchor: EpicInstallation["saveAnchor"],
  localDigest: string,
  localFiles: number,
  remote: EpicRemoteSaveManifest | null,
  pending: boolean
) {
  const remoteManifest = remote?.name ?? null;
  if (!anchor) {
    if (localFiles && remoteManifest) return "conflict" as const;
    return remoteManifest
      ? ("download" as const)
      : localFiles
        ? ("upload" as const)
        : ("same" as const);
  }
  const localChanged = localDigest !== anchor.localDigest;
  const remoteChanged =
    remoteManifest !== anchor.remoteManifest ||
    (remote?.lastModified ?? null) !== (anchor.remoteModifiedAt ?? null);
  if ((localChanged || pending) && remoteChanged) return "conflict" as const;
  if (remoteChanged)
    return remoteManifest
      ? ("download" as const)
      : localFiles
        ? ("conflict" as const)
        : ("same" as const);
  return localChanged && localFiles ? ("upload" as const) : ("same" as const);
}
