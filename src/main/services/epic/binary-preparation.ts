import fs from "node:fs";
import type { EpicConnectionState } from "../../../types/epic-integration.types";
import { EpicIntegrationError, isRecord } from "./auth-protocol.js";

type FileInfo = { isFile(): boolean };

const binaryFailure = (error: unknown) =>
  isRecord(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")
    ? "legendary-missing"
    : "legendary-unavailable";

export function getEpicBinaryAvailability(
  binaryPath: string | null,
  inspect: (path: string) => FileInfo = fs.statSync
): EpicConnectionState["availability"] {
  if (!binaryPath) return { available: false, reason: "legendary-missing" };
  try {
    return inspect(binaryPath).isFile()
      ? { available: true }
      : { available: false, reason: "legendary-missing" };
  } catch (error) {
    return { available: false, reason: binaryFailure(error) };
  }
}

export async function checkEpicBinary(
  binaryPath: string | null,
  {
    cleanup,
    inspect = fs.promises.stat,
  }: {
    cleanup?: () => Promise<void>;
    inspect?: (path: string) => Promise<FileInfo>;
  } = {}
): Promise<string> {
  if (cleanup) {
    try {
      await cleanup();
    } catch {
      throw new EpicIntegrationError("cleanup-failed");
    }
  }
  if (!binaryPath) throw new EpicIntegrationError("legendary-missing");
  let info: FileInfo;
  try {
    info = await inspect(binaryPath);
  } catch (error) {
    throw new EpicIntegrationError(binaryFailure(error));
  }
  if (!info.isFile()) throw new EpicIntegrationError("legendary-missing");
  return binaryPath;
}
