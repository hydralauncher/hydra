import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import type {
  CloudSaveCustomPath,
  CloudSaveCustomPathPlatform,
  GameShop,
} from "@types";

export const CLOUD_SAVE_CUSTOM_PATH_PREFIX = "<custom>";

const PLATFORM_MARKERS: Record<CloudSaveCustomPathPlatform, string> = {
  windows: "<windows>",
  linux: "<linux>",
  mac: "<mac>",
};

const currentPlatform = (): CloudSaveCustomPathPlatform => {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "mac";
  return "linux";
};

export const getCurrentCloudSaveCustomPathPlatform = currentPlatform;

export const cloudSaveCustomPathStorageKey = (
  userId: string,
  shop: GameShop,
  objectId: string
) => JSON.stringify([userId, shop, objectId]);

const trimTrailingSeparators = (
  value: string,
  platform: CloudSaveCustomPathPlatform
) => {
  if (platform === "windows" && /^[A-Z]:\/$/i.test(value)) return value;
  if (platform !== "windows" && value === "/") return value;
  return value.replace(/\/+$/, "");
};

const normalizeAbsolutePath = (
  value: string,
  platform: CloudSaveCustomPathPlatform
) => {
  let normalized = value.normalize("NFC").replaceAll("\\", "/");
  normalized = trimTrailingSeparators(normalized, platform);
  if (platform === "windows") {
    normalized = normalized.replace(/^[a-z]:/, (drive) => drive.toUpperCase());
  }
  return normalized;
};

const assertSafeSegments = (
  absolutePath: string,
  platform: CloudSaveCustomPathPlatform
) => {
  if (
    absolutePath.includes("\0") ||
    [...absolutePath].some((character) => character.charCodeAt(0) <= 31) ||
    absolutePath.includes("<") ||
    absolutePath.includes(">") ||
    /[*?[\]{}]/u.test(absolutePath)
  ) {
    throw new Error("cloud_save_custom_path_invalid");
  }

  const pathWithoutRoot =
    platform === "windows" ? absolutePath.slice(3) : absolutePath.slice(1);
  const segments = pathWithoutRoot.split("/");
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        (platform === "windows" && segment.includes(":"))
    )
  ) {
    throw new Error("cloud_save_custom_path_invalid");
  }
};

const assertAbsolutePath = (
  absolutePath: string,
  platform: CloudSaveCustomPathPlatform
) => {
  if (platform === "windows") {
    if (
      !/^[A-Z]:\/.+/u.test(absolutePath) ||
      absolutePath.startsWith("//") ||
      absolutePath.startsWith("\\\\") ||
      absolutePath.startsWith("//?/")
    ) {
      throw new Error("cloud_save_custom_path_must_be_local_absolute");
    }
  } else if (!absolutePath.startsWith("/") || absolutePath.startsWith("//")) {
    throw new Error("cloud_save_custom_path_must_be_local_absolute");
  }

  assertSafeSegments(absolutePath, platform);
};

const pathKey = (value: string, platform: CloudSaveCustomPathPlatform) => {
  const normalized = normalizeAbsolutePath(value, platform);
  return platform === "linux" ? normalized : normalized.toLowerCase();
};

const isSameOrChildPath = (
  candidate: string,
  root: string,
  platform: CloudSaveCustomPathPlatform
) => {
  const candidateKey = pathKey(candidate, platform);
  const rootKey = pathKey(root, platform);
  return (
    candidateKey === rootKey ||
    candidateKey.startsWith(`${rootKey.replace(/\/+$/, "")}/`)
  );
};

const protectedRoots = (
  platform: CloudSaveCustomPathPlatform,
  absolutePath: string
): string[] => {
  if (platform === "windows") {
    const drive = absolutePath.slice(0, 2);
    return [
      `${drive}/Windows`,
      `${drive}/Program Files`,
      `${drive}/Program Files (x86)`,
      `${drive}/ProgramData`,
      process.env.SystemRoot,
      process.env.WINDIR,
      process.env.ProgramFiles,
      process.env["ProgramFiles(x86)"],
      process.env.ProgramData,
    ]
      .filter((value): value is string => Boolean(value))
      .map((value) => normalizeAbsolutePath(value, platform));
  }

  const unixRoots = [
    "/bin",
    "/boot",
    "/dev",
    "/etc",
    "/lib",
    "/lib64",
    "/proc",
    "/root",
    "/run",
    "/sbin",
    "/sys",
    "/usr",
  ];
  if (platform === "mac") {
    unixRoots.push("/Applications", "/Library", "/System", "/private");
  }
  return unixRoots;
};

const assertNotProtected = (
  absolutePath: string,
  platform: CloudSaveCustomPathPlatform
) => {
  const isFilesystemRoot =
    platform === "windows"
      ? /^[A-Z]:\/$/u.test(absolutePath)
      : absolutePath === "/";
  if (
    isFilesystemRoot ||
    protectedRoots(platform, absolutePath).some((root) =>
      isSameOrChildPath(absolutePath, root, platform)
    )
  ) {
    throw new Error("cloud_save_custom_path_protected");
  }
};

export const decodeCloudSaveCustomPath = (
  rawPath: string
): CloudSaveCustomPath => {
  if (!rawPath.startsWith(CLOUD_SAVE_CUSTOM_PATH_PREFIX)) {
    throw new Error("cloud_save_custom_path_invalid_prefix");
  }

  const encoded = rawPath.slice(CLOUD_SAVE_CUSTOM_PATH_PREFIX.length);
  const platform = (
    Object.entries(PLATFORM_MARKERS) as Array<
      [CloudSaveCustomPathPlatform, string]
    >
  ).find(([, marker]) => encoded.startsWith(marker))?.[0];
  if (!platform) throw new Error("cloud_save_custom_path_invalid_platform");

  const marker = PLATFORM_MARKERS[platform];
  const decodedPath = normalizeAbsolutePath(
    encoded.slice(marker.length),
    platform
  );
  assertAbsolutePath(decodedPath, platform);
  assertNotProtected(decodedPath, platform);

  const canonicalRawPath = `${CLOUD_SAVE_CUSTOM_PATH_PREFIX}${marker}${decodedPath}`;
  if (canonicalRawPath !== rawPath) {
    throw new Error("cloud_save_custom_path_not_canonical");
  }

  return { rawPath, path: decodedPath, platform };
};

export const tryDecodeCloudSaveCustomPath = (rawPath: string) => {
  try {
    return decodeCloudSaveCustomPath(rawPath);
  } catch {
    return null;
  }
};

export const encodeCloudSaveCustomPath = (
  absolutePath: string,
  platform = currentPlatform()
): CloudSaveCustomPath => {
  const normalizedPath = normalizeAbsolutePath(absolutePath, platform);
  assertAbsolutePath(normalizedPath, platform);
  assertNotProtected(normalizedPath, platform);
  return decodeCloudSaveCustomPath(
    `${CLOUD_SAVE_CUSTOM_PATH_PREFIX}${PLATFORM_MARKERS[platform]}${normalizedPath}`
  );
};

const assertNoSymlinkAncestor = async (customPath: CloudSaveCustomPath) => {
  const pathApi = customPath.platform === "windows" ? path.win32 : path.posix;
  let existing = customPath.path;

  for (;;) {
    try {
      await fs.lstat(existing);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = pathApi.dirname(existing);
      if (parent === existing) {
        throw new Error("cloud_save_custom_path_parent_unavailable");
      }
      existing = parent;
    }
  }

  const canonicalExisting = normalizeAbsolutePath(
    await fs.realpath(existing),
    customPath.platform
  );
  if (
    pathKey(canonicalExisting, customPath.platform) !==
    pathKey(existing, customPath.platform)
  ) {
    throw new Error("cloud_save_custom_path_symlink_ancestor");
  }
  await fs.access(existing, fsConstants.W_OK);
};

export const canonicalizeSelectedCloudSaveCustomPath = async (
  selectedPath: string
) => {
  const stats = await fs.stat(selectedPath);
  if (!stats.isDirectory()) {
    throw new Error("cloud_save_custom_path_not_directory");
  }

  const customPath = encodeCloudSaveCustomPath(
    await fs.realpath(selectedPath),
    currentPlatform()
  );
  await assertNoSymlinkAncestor(customPath);
  return customPath;
};

export const validateCloudSaveCustomPathForRestore = async (
  rawPath: string,
  platform = currentPlatform()
) => {
  const customPath = decodeCloudSaveCustomPath(rawPath);
  if (customPath.platform !== platform) return null;
  await assertNoSymlinkAncestor(customPath);
  return customPath;
};
