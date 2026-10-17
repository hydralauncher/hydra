import { createHash } from "node:crypto";
import path from "node:path";
import type { EpicLocalOwner } from "../../../types/epic-managed.types";
import { EPIC_LINUX_MAX_LINE_BYTES } from "./linux-runtime-constants.js";

export const epicLinuxDigest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export const epicLinuxPrefixKey = (owner: EpicLocalOwner, artifactId: string) =>
  epicLinuxDigest([
    owner.environment,
    owner.userId,
    owner.epicAccountId,
    artifactId,
    "Windows",
  ]);

const ansiPattern = new RegExp(
  String.raw`${String.fromCodePoint(27)}\[[0-9;]*[A-Za-z]`,
  "g"
);

/** Only used with unauthenticated bootstrap. Never forwards diagnostic lines. */
export class EpicLinuxProtonPathDecoder {
  private pending = "";
  private selected: string | null = null;
  push(chunk: string) {
    const lines = (this.pending + chunk).split(/[\r\n]/);
    this.pending = lines.pop() ?? "";
    if (Buffer.byteLength(this.pending) > EPIC_LINUX_MAX_LINE_BYTES)
      throw new Error("invalid-response");
    for (const line of lines) this.line(line);
  }
  finish() {
    this.line(this.pending);
    this.pending = "";
    return this.selected;
  }
  private line(value: string) {
    const clean = value.replace(ansiPattern, "").trim();
    // UMU 1.4.4 uses a decorated DEBUG prefix. The final environment assignment
    // is the protocol; earlier token selections and command dumps are ignored.
    const match = /(?:^|\s)PROTONPATH=(\/[^\0\r\n]*)$/.exec(clean);
    if (match && path.posix.isAbsolute(match[1])) this.selected = match[1];
  }
}

export function parseEpicPrerequisiteResult(value: unknown, nonce: string) {
  if (
    !value ||
    typeof value !== "object" ||
    !("schemaVersion" in value) ||
    value.schemaVersion !== 1 ||
    !("nonce" in value) ||
    value.nonce !== nonce ||
    !("exitCode" in value) ||
    !Number.isInteger(value.exitCode) ||
    Number(value.exitCode) < 0 ||
    Number(value.exitCode) > 0xffff_ffff
  )
    throw new Error("prerequisites-required");
  return Number(value.exitCode);
}

export function parseEpicLinuxMappedPath(output: string, windows: boolean) {
  const lines = output.replace(/\r/g, "").split("\n").filter(Boolean);
  if (lines.length !== 1 || lines[0].includes("\0"))
    throw new Error("invalid-path");
  const mapped = lines[0];
  if (
    windows ? !/^[A-Za-z]:[\\/]/.test(mapped) : !path.posix.isAbsolute(mapped)
  )
    throw new Error("invalid-path");
  return mapped;
}

export function epicLinuxPrerequisiteIdentity(
  version: string,
  executableHash: string,
  args: string[],
  prefixGeneration: string,
  protonFingerprint: string
) {
  return epicLinuxDigest({
    version,
    executableHash,
    args,
    prefixGeneration,
    protonFingerprint,
  });
}
