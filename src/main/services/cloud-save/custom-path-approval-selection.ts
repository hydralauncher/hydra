import { promises as fs } from "node:fs";
import path from "node:path";

import {
  canonicalizeSelectedCloudSaveCustomPath,
  validateBoundCloudSaveCustomPathForRestore,
  type CloudSaveCustomPathContext,
} from "./custom-path.js";

export const resolveSelectedCustomPathApproval = async (
  rawPath: string,
  kind: "file" | "dir",
  relativePath: string | undefined,
  selectedPath: string,
  context: CloudSaveCustomPathContext
) => {
  const stat = await fs.stat(selectedPath);
  const selected = await canonicalizeSelectedCloudSaveCustomPath(
    selectedPath,
    context,
    stat.isFile() ? "file" : "dir"
  );
  if (kind === "dir") {
    if (selected.kind !== "dir") {
      throw new Error("cloud_save_custom_path_not_directory");
    }
    return selected;
  }

  const destination =
    selected.kind === "file"
      ? selected.path
      : path.join(selected.path, relativePath ?? "");
  return validateBoundCloudSaveCustomPathForRestore(
    rawPath,
    destination,
    context
  );
};
