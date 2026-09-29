import { promises as fs } from "node:fs";
import path from "node:path";

import type {
  DeleteLocalSaveTarget,
  LocalGameSnapshotSourceFile,
} from "@types";

import {
  canonicalizeDolphinGci,
  isDolphinRawCardPath,
} from "./dolphin-raw-card.js";
import { validateDolphinGciRestoreFile } from "./dolphin-save-provider.js";
import { isPlaystationCardRawPath } from "./playstation-card-restore.js";
import { sha256 } from "./playstation-save-common.js";

const dolphinGciPath = /^<emulator>\/dolphin-gci\/[AB]\/[A-Z0-9]{6}$/;

export const buildNativeDeleteTargets = async (
  sourceFiles: LocalGameSnapshotSourceFile[]
): Promise<DeleteLocalSaveTarget[]> => {
  const targets: DeleteLocalSaveTarget[] = [];
  for (const file of sourceFiles) {
    // Exports from image cards live outside the restore root. The card
    // transaction removes physical entries; stale exports are not rescanned.
    if (
      isPlaystationCardRawPath(file.rawPath) ||
      isDolphinRawCardPath(file.rawPath)
    )
      continue;

    let targetPath = file.absolutePath;
    let expectedHash = file.hash;
    let expectedSizeBytes = file.sizeBytes;
    if (dolphinGciPath.test(file.rawPath)) {
      if (!/^[^/\\]+\.gci$/i.test(file.relativePath)) {
        throw new Error("cloud_save_dolphin_gci_delete_identity_invalid");
      }
      const root = file.localBindings.concretePath;
      const rootStat = await fs.lstat(root).catch(() => null);
      targetPath = path.join(root, file.relativePath);
      const [cacheStat, physicalStat] = await Promise.all([
        fs.lstat(file.absolutePath).catch(() => null),
        fs.lstat(targetPath).catch(() => null),
      ]);
      if (
        !rootStat?.isDirectory() ||
        rootStat.isSymbolicLink() ||
        !cacheStat?.isFile() ||
        cacheStat.isSymbolicLink() ||
        !physicalStat?.isFile() ||
        physicalStat.isSymbolicLink()
      ) {
        throw new Error("cloud_save_dolphin_gci_delete_target_unavailable");
      }
      const [cache, physical] = await Promise.all([
        fs.readFile(file.absolutePath),
        fs.readFile(targetPath),
      ]);
      if (
        cache.length !== file.sizeBytes ||
        sha256(cache) !== file.hash ||
        !(await validateDolphinGciRestoreFile(file, targetPath)) ||
        !canonicalizeDolphinGci(physical).equals(cache)
      ) {
        throw new Error("cloud_save_dolphin_gci_delete_save_changed");
      }
      expectedHash = sha256(physical);
      expectedSizeBytes = physical.length;
    }
    targets.push({
      variantId: file.variantId,
      rawPath: file.rawPath,
      relativePath: file.relativePath,
      targetPath,
      restoreRootPath: file.localBindings.concretePath,
      expectedHash,
      expectedSizeBytes,
    });
  }
  return targets;
};
