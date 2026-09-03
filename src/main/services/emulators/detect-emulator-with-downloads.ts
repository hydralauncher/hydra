import path from "node:path";

import { getDownloadsPath } from "../../events/helpers/get-downloads-path.js";
import { SystemPath } from "../system-path.js";
import {
  detectEmulator,
  type DetectableBinary,
  type DetectionResult,
} from "./detect-emulator.js";

export const detectEmulatorWithDownloads = async (
  binary: DetectableBinary,
  options?: { resolveVersion?: boolean }
): Promise<DetectionResult | null> => {
  const configuredDownloads = await getDownloadsPath().catch(() => null);
  const defaultDownloads = SystemPath.getPath("downloads");
  const downloadDirectories = Array.from(
    new Set(
      [configuredDownloads, defaultDownloads]
        .filter((directory): directory is string => Boolean(directory))
        .map((directory) => path.normalize(directory))
    )
  );

  return detectEmulator(binary, {
    resolveVersion: options?.resolveVersion,
    downloadDirectories,
  });
};
