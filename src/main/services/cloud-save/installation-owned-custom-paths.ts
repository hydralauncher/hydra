import fs from "node:fs";
import path from "node:path";

import type {
  CloudSaveCustomPathBindings,
  CloudSavePathContext,
  CloudSaveSyncTrigger,
} from "@types";

import { findGameRootFromExe } from "../../events/helpers/find-game-root.js";

const pathApiFor = (platform: CloudSavePathContext["platform"]) =>
  platform === "windows" ? path.win32 : path.posix;

const normalizeForComparison = (
  value: string,
  platform: CloudSavePathContext["platform"]
) => {
  const pathApi = pathApiFor(platform);
  const normalized = pathApi.normalize(value);
  return platform === "windows" ? normalized.toLowerCase() : normalized;
};

export const isCloudSavePathWithinRoot = (
  candidate: string,
  root: string,
  platform: CloudSavePathContext["platform"]
) => {
  const pathApi = pathApiFor(platform);
  const normalizedCandidate = normalizeForComparison(candidate, platform);
  const normalizedRoot = normalizeForComparison(root, platform);
  const relative = pathApi.relative(normalizedRoot, normalizedCandidate);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${pathApi.sep}`) &&
      !pathApi.isAbsolute(relative))
  );
};

const canonicalize = async (value: string) =>
  fs.promises.realpath(value).catch(() => path.resolve(value));

export const canDeleteInstallationOwnedCustomPathFiles = (
  trigger: CloudSaveSyncTrigger
) => trigger === "post-exit";

interface InstallationOwnedCustomPathDependencies {
  findGameRoot?: (executablePath: string) => Promise<string | null>;
  canonicalize?: (value: string) => Promise<string>;
}

export const getInstallationOwnedCustomPathRawPaths = async (
  bindings: CloudSaveCustomPathBindings,
  pathContext: CloudSavePathContext,
  dependencies: InstallationOwnedCustomPathDependencies = {}
) => {
  const resolveCanonicalPath = dependencies.canonicalize ?? canonicalize;
  const resolveGameRoot = dependencies.findGameRoot ?? findGameRootFromExe;
  const roots: string[] = [];
  if (pathContext.executablePath) {
    const gameRoot = await resolveGameRoot(pathContext.executablePath);
    roots.push(
      gameRoot ??
        pathApiFor(pathContext.platform).dirname(pathContext.executablePath)
    );
  }
  if (pathContext.winePrefixPath) roots.push(pathContext.winePrefixPath);
  if (roots.length === 0) return new Set<string>();

  const canonicalRoots = await Promise.all(roots.map(resolveCanonicalPath));
  const installationOwnedRawPaths = new Set<string>();
  for (const customPath of bindings.ready) {
    const canonicalPath = await resolveCanonicalPath(customPath.path);
    if (
      canonicalRoots.some((root) =>
        isCloudSavePathWithinRoot(canonicalPath, root, pathContext.platform)
      )
    ) {
      installationOwnedRawPaths.add(customPath.rawPath);
    }
  }

  return installationOwnedRawPaths;
};
