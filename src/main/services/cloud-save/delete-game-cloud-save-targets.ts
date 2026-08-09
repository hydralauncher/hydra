import path from "node:path";

import type {
  CloudSaveCustomPathBindings,
  CloudSavePathContext,
  LocalGameSnapshotSourceFile,
} from "@types";

import { isCloudSavePathWithinRoot } from "./installation-owned-custom-paths.js";

export const getDeletableGameCloudSaveSourceFiles = (
  sourceFiles: LocalGameSnapshotSourceFile[],
  customPathBindings: CloudSaveCustomPathBindings,
  platform: CloudSavePathContext["platform"]
) => {
  const customRawPaths = new Set(
    [...customPathBindings.ready, ...customPathBindings.unresolved].map(
      ({ rawPath }) => rawPath
    )
  );
  const pathApi = platform === "windows" ? path.win32 : path.posix;
  const customRoots = [
    ...customPathBindings.ready.map(({ path: customPath }) => customPath),
    ...customPathBindings.unresolved.flatMap(({ pathHint }) =>
      pathHint && pathApi.isAbsolute(pathHint) ? [pathHint] : []
    ),
  ];

  return sourceFiles.filter(
    (file) =>
      !customRawPaths.has(file.rawPath) &&
      !customRoots.some((root) =>
        isCloudSavePathWithinRoot(file.absolutePath, root, platform)
      )
  );
};
