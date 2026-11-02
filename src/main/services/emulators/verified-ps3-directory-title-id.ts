import { promises as fs } from "node:fs";
import path from "node:path";

import { parseParamSfo } from "./param-sfo.js";

export const readVerifiedPs3DirectoryTitleId = async (
  primaryPath: string,
  isDirectory: boolean
): Promise<string | null> => {
  const candidates = isDirectory
    ? [
        path.join(primaryPath, "PARAM.SFO"),
        path.join(primaryPath, "PS3_GAME", "PARAM.SFO"),
      ]
    : path.basename(primaryPath).toLowerCase() === "eboot.bin"
      ? [
          path.join(primaryPath, "..", "PARAM.SFO"),
          path.join(primaryPath, "..", "..", "PARAM.SFO"),
        ]
      : [];
  for (const candidate of candidates) {
    const data = await fs.readFile(candidate).catch(() => null);
    const id = data ? parseParamSfo(data) : null;
    if (id) return id;
  }
  return null;
};
