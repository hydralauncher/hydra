import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type {
  CloudSaveCustomPath,
  CloudSaveCustomPathPlatform,
  CloudSavePathContext,
  GameShop,
} from "@types";
import { getWinePrefixUserProfile } from "../wine-prefix.js";

export const CLOUD_SAVE_CUSTOM_PATH_PREFIX = "<custom>";
export const CLOUD_SAVE_CUSTOM_ABSOLUTE_PATH_MARKER = "<absolute>";

const PLATFORM_MARKERS: Record<CloudSaveCustomPathPlatform, string> = {
  windows: "<windows>",
  linux: "<linux>",
  mac: "<mac>",
};

type PortablePathToken =
  | "<home>"
  | "<base>"
  | "<root>"
  | "<storeUserId>"
  | "<winAppData>"
  | "<winLocalAppData>"
  | "<winDocuments>"
  | "<xdgData>"
  | "<xdgConfig>";

export interface CloudSaveCustomPathContext {
  platform: CloudSaveCustomPathPlatform;
  homeDir: string;
  documentsDir?: string;
  appDataDir?: string;
  localAppDataDir?: string;
  xdgDataDir?: string;
  xdgConfigDir?: string;
  windowsCompatibility?: boolean;
  winePrefixPath?: string;
  wineUserProfilePath?: string;
  installDir?: string;
  storeRoot?: string;
  storeUserIds?: string[];
  preferredStoreUserId?: string;
}

const trimTrailingForwardSeparators = (value: string) => {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end -= 1;
  return value.slice(0, end);
};

const installDirectory = (executablePath?: string) => {
  if (!executablePath) return undefined;
  const normalized = trimTrailingForwardSeparators(
    executablePath.replaceAll("\\", "/")
  );
  const marker = "/steamapps/common/";
  const markerIndex = normalized.toLocaleLowerCase("en-US").indexOf(marker);
  if (markerIndex >= 0) {
    const gameStart = markerIndex + marker.length;
    const nextSeparator = normalized.indexOf("/", gameStart);
    return normalized.slice(
      0,
      nextSeparator < 0 ? normalized.length : nextSeparator
    );
  }
  const separator = normalized.lastIndexOf("/");
  return separator > 0 ? normalized.slice(0, separator) : undefined;
};

const derivedStoreRoot = (executablePath?: string) => {
  if (!executablePath) return undefined;
  const normalized = executablePath.replaceAll("\\", "/");
  const marker = "/steamapps/common/";
  const markerIndex = normalized.toLocaleLowerCase("en-US").indexOf(marker);
  return markerIndex >= 0 ? normalized.slice(0, markerIndex) : undefined;
};

const storeUserIdsFromContext = (
  context: Pick<CloudSavePathContext, "storeUserContext">
) => {
  const ids: string[] = [];
  const accounts = [
    ...(context.storeUserContext.active
      ? [context.storeUserContext.active]
      : []),
    ...context.storeUserContext.known,
  ];
  for (const account of accounts) {
    for (const id of [account.steamId64, account.accountId32]) {
      if (id && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
};

const currentPlatform = (): CloudSaveCustomPathPlatform => {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "mac";
  return "linux";
};

export const getCurrentCloudSaveCustomPathPlatform = currentPlatform;

export const getCurrentCloudSaveCustomPathContext =
  (): CloudSaveCustomPathContext => {
    const platform = currentPlatform();
    const homeDir =
      platform === "windows" ? process.env.USERPROFILE || homedir() : homedir();

    if (platform === "windows") {
      const appDataDir =
        process.env.APPDATA || path.win32.join(homeDir, "AppData", "Roaming");
      return {
        platform,
        homeDir,
        documentsDir: path.win32.join(homeDir, "Documents"),
        appDataDir,
        localAppDataDir:
          process.env.LOCALAPPDATA ||
          path.win32.join(path.win32.dirname(appDataDir), "Local"),
      };
    }

    if (platform === "mac") {
      const appDataDir = path.posix.join(
        homeDir,
        "Library",
        "Application Support"
      );
      return {
        platform,
        homeDir,
        appDataDir,
        xdgDataDir: appDataDir,
        xdgConfigDir: path.posix.join(homeDir, "Library", "Preferences"),
      };
    }

    return {
      platform,
      homeDir,
      appDataDir:
        process.env.XDG_CONFIG_HOME || path.posix.join(homeDir, ".config"),
      xdgDataDir:
        process.env.XDG_DATA_HOME ||
        path.posix.join(homeDir, ".local", "share"),
      xdgConfigDir:
        process.env.XDG_CONFIG_HOME || path.posix.join(homeDir, ".config"),
    };
  };

export const cloudSaveCustomPathContextFromPathContext = (
  context: Pick<
    CloudSavePathContext,
    | "platform"
    | "homeDir"
    | "documentsDir"
    | "appDataDir"
    | "executablePath"
    | "winePrefixPath"
    | "steamPath"
    | "objectId"
    | "storeUserContext"
  >
): CloudSaveCustomPathContext => {
  const windowsCompatibility =
    context.platform === "linux" &&
    context.executablePath?.toLowerCase().endsWith(".exe") === true;
  const winePrefixPath = windowsCompatibility
    ? context.winePrefixPath
    : undefined;
  const wineUserProfilePath = winePrefixPath
    ? getWinePrefixUserProfile(winePrefixPath)?.path
    : undefined;
  const common = {
    installDir: installDirectory(context.executablePath),
    storeRoot: derivedStoreRoot(context.executablePath) ?? context.steamPath,
    storeUserIds: storeUserIdsFromContext(context),
  };

  if (context.platform === "windows") {
    return {
      ...context,
      ...common,
      localAppDataDir:
        process.env.LOCALAPPDATA ||
        (context.appDataDir
          ? path.win32.join(path.win32.dirname(context.appDataDir), "Local")
          : path.win32.join(context.homeDir, "AppData", "Local")),
    };
  }
  if (context.platform === "mac") {
    return {
      ...context,
      ...common,
      xdgDataDir:
        context.appDataDir ||
        path.posix.join(context.homeDir, "Library", "Application Support"),
      xdgConfigDir: path.posix.join(context.homeDir, "Library", "Preferences"),
    };
  }
  return {
    ...context,
    ...common,
    xdgDataDir: path.posix.join(context.homeDir, ".local", "share"),
    xdgConfigDir:
      context.appDataDir || path.posix.join(context.homeDir, ".config"),
    windowsCompatibility,
    winePrefixPath,
    wineUserProfilePath,
  };
};

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
  return trimTrailingForwardSeparators(value);
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

const portableTokenRoots = (
  context: CloudSaveCustomPathContext
): Array<[PortablePathToken, string]> => {
  const roots: Array<[PortablePathToken, string | undefined]> =
    context.platform === "windows"
      ? [
          ["<winAppData>", context.appDataDir],
          ["<winLocalAppData>", context.localAppDataDir],
          ["<winDocuments>", context.documentsDir],
          ["<base>", context.installDir],
          ["<root>", context.storeRoot],
          ["<home>", context.homeDir],
        ]
      : [
          ["<xdgData>", context.xdgDataDir],
          ["<xdgConfig>", context.xdgConfigDir],
          ["<base>", context.installDir],
          ["<root>", context.storeRoot],
          ["<home>", context.homeDir],
        ];

  return roots
    .filter((entry): entry is [PortablePathToken, string] => Boolean(entry[1]))
    .map(([token, root]): [PortablePathToken, string] => [
      token,
      normalizeAbsolutePath(root, context.platform),
    ])
    .sort((left, right) => right[1].length - left[1].length);
};

const allowedPortableTokens = (
  platform: CloudSaveCustomPathPlatform
): PortablePathToken[] =>
  platform === "windows"
    ? [
        "<winAppData>",
        "<winLocalAppData>",
        "<winDocuments>",
        "<base>",
        "<root>",
        "<home>",
      ]
    : ["<xdgData>", "<xdgConfig>", "<base>", "<root>", "<home>"];

const splitPortablePath = (
  value: string,
  platform: CloudSaveCustomPathPlatform
) => {
  const token = allowedPortableTokens(platform).find((candidate) =>
    value.startsWith(candidate)
  );
  if (!token) return null;

  const suffix = value.slice(token.length);
  if (suffix && !suffix.startsWith("/")) {
    throw new Error("cloud_save_custom_path_invalid");
  }
  return { token, suffix };
};

const assertSafeRelativeSegments = (
  relativePath: string,
  platform: CloudSaveCustomPathPlatform
) => {
  if (!relativePath) return;
  const segments = relativePath.replace(/^\/+/, "").split("/");
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        (segment.includes("<") && segment !== "<storeUserId>") ||
        (segment.includes(">") && segment !== "<storeUserId>") ||
        (platform === "windows" && segment.includes(":"))
    )
  ) {
    throw new Error("cloud_save_custom_path_invalid");
  }
};

const assertPortablePath = (
  portablePath: string,
  platform: CloudSaveCustomPathPlatform
) => {
  const parsed = splitPortablePath(portablePath, platform);
  if (!parsed) throw new Error("cloud_save_custom_path_invalid");
  if (
    portablePath.includes("\\") ||
    portablePath.includes("\0") ||
    [...portablePath].some((character) => character.codePointAt(0)! <= 31) ||
    /[*?[\]{}]/u.test(portablePath)
  ) {
    throw new Error("cloud_save_custom_path_invalid");
  }
  assertSafeRelativeSegments(parsed.suffix, platform);
  return parsed;
};

const assertSafeSegments = (
  absolutePath: string,
  platform: CloudSaveCustomPathPlatform
) => {
  if (
    absolutePath.includes("\0") ||
    [...absolutePath].some((character) => character.codePointAt(0)! <= 31) ||
    absolutePath.includes("<") ||
    absolutePath.includes(">") ||
    /[*?[\]{}]/u.test(absolutePath)
  ) {
    throw new Error("cloud_save_custom_path_invalid");
  }

  const pathWithoutRoot =
    platform === "windows" ? absolutePath.slice(3) : absolutePath.slice(1);
  assertSafeRelativeSegments(pathWithoutRoot, platform);
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
    candidateKey.startsWith(`${trimTrailingForwardSeparators(rootKey)}/`)
  );
};

const portablePathFromAbsolute = (
  absolutePath: string,
  context: CloudSaveCustomPathContext
) => {
  for (const [token, root] of portableTokenRoots(context)) {
    if (!isSameOrChildPath(absolutePath, root, context.platform)) continue;
    const suffix = absolutePath.slice(root.length);
    const portable = `${token}${suffix}`;
    const storeUserIds = new Set(context.storeUserIds ?? []);
    const segments = portable.split("/");
    const storeUserIndex = segments.findIndex((segment) =>
      storeUserIds.has(segment)
    );
    if (storeUserIndex >= 0) segments[storeUserIndex] = "<storeUserId>";
    return segments.join("/");
  }
  return absolutePath;
};

export const getLegacyCloudSaveCustomPathPathHint = (rawPath: string) => {
  if (!rawPath.startsWith(CLOUD_SAVE_CUSTOM_PATH_PREFIX)) return null;

  const encoded = rawPath.slice(CLOUD_SAVE_CUSTOM_PATH_PREFIX.length);
  const platformEntry = (
    Object.entries(PLATFORM_MARKERS) as Array<
      [CloudSaveCustomPathPlatform, string]
    >
  ).find(([, marker]) => encoded.startsWith(marker));
  if (!platformEntry) return null;

  const [platform, marker] = platformEntry;
  const encodedPath = encoded.slice(marker.length);
  if (!encodedPath || encodedPath.startsWith("<")) return null;

  try {
    const normalizedPath = normalizeAbsolutePath(encodedPath, platform);
    assertAbsolutePath(normalizedPath, platform);
    return `${CLOUD_SAVE_CUSTOM_PATH_PREFIX}${marker}${normalizedPath}` ===
      rawPath
      ? normalizedPath
      : null;
  } catch {
    return null;
  }
};

export const isLegacyCloudSaveCustomPathRawPath = (rawPath: string) =>
  getLegacyCloudSaveCustomPathPathHint(rawPath) !== null;

const portableWindowsProfilePath = (profilePath: string) => {
  const suffix = profilePath.startsWith("/") ? profilePath : `/${profilePath}`;
  if (/^\/AppData\/Roaming(?:\/|$)/i.test(suffix)) {
    return suffix.replace(/^\/AppData\/Roaming/i, "<winAppData>");
  }
  if (/^\/Application Data(?:\/|$)/i.test(suffix)) {
    return suffix.replace(/^\/Application Data/i, "<winAppData>");
  }
  if (/^\/AppData\/Local(?:\/|$)/i.test(suffix)) {
    return suffix.replace(/^\/AppData\/Local/i, "<winLocalAppData>");
  }
  if (/^\/Local Settings\/Application Data(?:\/|$)/i.test(suffix)) {
    return suffix.replace(
      /^\/Local Settings\/Application Data/i,
      "<winLocalAppData>"
    );
  }
  if (/^\/(?:Documents|My Documents)(?:\/|$)/i.test(suffix)) {
    return suffix.replace(/^\/(?:Documents|My Documents)/i, "<winDocuments>");
  }
  return `<home>${suffix === "/" ? "" : suffix}`;
};

const portableWindowsPathFromWineAbsolute = (
  absolutePath: string,
  context: CloudSaveCustomPathContext
) => {
  if (
    context.platform !== "linux" ||
    !context.windowsCompatibility ||
    !context.wineUserProfilePath
  ) {
    return null;
  }

  const profilePath = normalizeAbsolutePath(
    context.wineUserProfilePath,
    "linux"
  );
  if (!isSameOrChildPath(absolutePath, profilePath, "linux")) return null;
  const relative = absolutePath.slice(profilePath.length).replace(/^\/+/, "");
  return portableWindowsProfilePath(relative);
};

const selectedStoreUserId = (
  absolutePath: string,
  context: CloudSaveCustomPathContext
) => {
  const segments = new Set(absolutePath.split("/"));
  return context.storeUserIds?.find((id) => segments.has(id));
};

const resolveNativePortablePath = (
  portablePath: string,
  context: CloudSaveCustomPathContext
) => {
  const parsed = splitPortablePath(portablePath, context.platform);
  if (!parsed) return portablePath;

  assertPortablePath(portablePath, context.platform);

  const root = portableTokenRoots(context).find(
    ([token]) => token === parsed.token
  )?.[1];
  if (!root) throw new Error("cloud_save_custom_path_token_unavailable");
  const storeUserId = context.preferredStoreUserId ?? context.storeUserIds?.[0];
  if (parsed.suffix.includes("<storeUserId>") && !storeUserId) {
    throw new Error("cloud_save_custom_path_store_user_unavailable");
  }
  return normalizeAbsolutePath(
    `${root}${parsed.suffix}`.replaceAll(
      "<storeUserId>",
      storeUserId ?? "<storeUserId>"
    ),
    context.platform
  );
};

const resolveWindowsPortablePathInWine = (
  portablePath: string,
  context: CloudSaveCustomPathContext
) => {
  if (context.platform !== "linux" || !context.windowsCompatibility) {
    throw new Error("cloud_save_custom_path_foreign_platform");
  }
  if (!context.winePrefixPath) {
    throw new Error("cloud_save_custom_path_wine_prefix_unavailable");
  }
  if (!context.wineUserProfilePath) {
    throw new Error("cloud_save_custom_path_wine_profile_unavailable");
  }

  if (!splitPortablePath(portablePath, "windows")) {
    throw new Error("cloud_save_custom_path_non_portable");
  }
  const parsed = assertPortablePath(portablePath, "windows");
  const wineHome = normalizeAbsolutePath(context.wineUserProfilePath, "linux");
  const roots: Record<PortablePathToken, string | undefined> = {
    "<home>": wineHome,
    "<base>": context.installDir,
    "<root>": context.storeRoot,
    "<storeUserId>": undefined,
    "<winAppData>": path.posix.join(wineHome, "AppData", "Roaming"),
    "<winLocalAppData>": path.posix.join(wineHome, "AppData", "Local"),
    "<winDocuments>": path.posix.join(wineHome, "Documents"),
    "<xdgData>": undefined,
    "<xdgConfig>": undefined,
  };
  const root = roots[parsed.token];
  if (!root) throw new Error("cloud_save_custom_path_token_unavailable");
  const storeUserId = context.preferredStoreUserId ?? context.storeUserIds?.[0];
  if (parsed.suffix.includes("<storeUserId>") && !storeUserId) {
    throw new Error("cloud_save_custom_path_store_user_unavailable");
  }
  return normalizeAbsolutePath(
    `${root}${parsed.suffix}`.replaceAll(
      "<storeUserId>",
      storeUserId ?? "<storeUserId>"
    ),
    "linux"
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
  platform: CloudSaveCustomPathPlatform,
  context?: CloudSaveCustomPathContext
) => {
  const isKnownGameLocation =
    (context?.installDir &&
      isSameOrChildPath(absolutePath, context.installDir, platform)) ||
    (context?.storeRoot &&
      pathKey(absolutePath, platform) !==
        pathKey(context.storeRoot, platform) &&
      isSameOrChildPath(absolutePath, context.storeRoot, platform));
  if (isKnownGameLocation) return;
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

const getCustomPathPlatform = (encoded: string) =>
  (
    Object.entries(PLATFORM_MARKERS) as Array<
      [CloudSaveCustomPathPlatform, string]
    >
  ).find(([, marker]) => encoded.startsWith(marker))?.[0];

const getInvalidCustomPathError = (rawPath: string) => {
  if (isLegacyCloudSaveCustomPathRawPath(rawPath)) {
    return "cloud_save_custom_path_legacy";
  }
  return "cloud_save_custom_path_invalid";
};

const parseEncodedCustomPath = (
  rawPath: string,
  encodedPath: string,
  platform: CloudSaveCustomPathPlatform
) => {
  const explicitAbsolutePath = encodedPath.startsWith(
    CLOUD_SAVE_CUSTOM_ABSOLUTE_PATH_MARKER
  )
    ? encodedPath.slice(CLOUD_SAVE_CUSTOM_ABSOLUTE_PATH_MARKER.length)
    : null;
  const portable =
    explicitAbsolutePath === null
      ? splitPortablePath(encodedPath, platform)
      : null;
  if (!portable && explicitAbsolutePath === null) {
    throw new Error(getInvalidCustomPathError(rawPath));
  }

  const normalizedPath =
    explicitAbsolutePath === null
      ? null
      : normalizeAbsolutePath(explicitAbsolutePath, platform);
  if (portable) {
    const normalizedEncodedPath = `${portable.token}${trimTrailingSeparators(
      portable.suffix,
      platform
    )}`;
    assertPortablePath(normalizedEncodedPath, platform);
    return { normalizedEncodedPath, normalizedPath, portable: true };
  }

  assertAbsolutePath(normalizedPath!, platform);
  return {
    normalizedEncodedPath: `${CLOUD_SAVE_CUSTOM_ABSOLUTE_PATH_MARKER}${normalizedPath}`,
    normalizedPath,
    portable: false,
  };
};

const resolveDecodedCustomPath = (
  platform: CloudSaveCustomPathPlatform,
  normalizedEncodedPath: string,
  normalizedPath: string | null,
  portable: boolean,
  context: CloudSaveCustomPathContext
) => {
  if (platform === context.platform) {
    return portable
      ? resolveNativePortablePath(normalizedEncodedPath, context)
      : normalizedPath!;
  }
  if (
    platform !== "windows" ||
    context.platform !== "linux" ||
    !context.windowsCompatibility
  ) {
    throw new Error("cloud_save_custom_path_foreign_platform");
  }
  if (!portable) {
    throw new Error("cloud_save_custom_path_non_portable");
  }
  return resolveWindowsPortablePathInWine(normalizedEncodedPath, context);
};

export const decodeCloudSaveCustomPath = (
  rawPath: string,
  context = getCurrentCloudSaveCustomPathContext()
): CloudSaveCustomPath => {
  if (!rawPath.startsWith(CLOUD_SAVE_CUSTOM_PATH_PREFIX)) {
    throw new Error("cloud_save_custom_path_invalid_prefix");
  }

  const encoded = rawPath.slice(CLOUD_SAVE_CUSTOM_PATH_PREFIX.length);
  const platform = getCustomPathPlatform(encoded);
  if (!platform) throw new Error("cloud_save_custom_path_invalid_platform");
  const marker = PLATFORM_MARKERS[platform];
  const encodedPath = encoded.slice(marker.length);
  const { normalizedEncodedPath, normalizedPath, portable } =
    parseEncodedCustomPath(rawPath, encodedPath, platform);
  const decodedPath = resolveDecodedCustomPath(
    platform,
    normalizedEncodedPath,
    normalizedPath,
    portable,
    context
  );
  assertAbsolutePath(decodedPath, context.platform);
  assertNotProtected(decodedPath, context.platform, context);

  const canonicalRawPath = `${CLOUD_SAVE_CUSTOM_PATH_PREFIX}${marker}${normalizedEncodedPath}`;
  if (canonicalRawPath !== rawPath) {
    throw new Error("cloud_save_custom_path_not_canonical");
  }

  const storeUserId = normalizedEncodedPath.includes("<storeUserId>")
    ? (context.preferredStoreUserId ?? context.storeUserIds?.[0])
    : undefined;
  return {
    rawPath,
    path: decodedPath,
    platform,
    ...(storeUserId ? { storeUserId } : {}),
  };
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
  context = getCurrentCloudSaveCustomPathContext()
): CloudSaveCustomPath => {
  const platform = context.platform;
  const normalizedPath = normalizeAbsolutePath(absolutePath, platform);
  assertAbsolutePath(normalizedPath, platform);
  assertNotProtected(normalizedPath, platform, context);
  const portableWinePath = portableWindowsPathFromWineAbsolute(
    normalizedPath,
    context
  );
  const insideActiveWinePrefix =
    context.platform === "linux" &&
    context.windowsCompatibility &&
    context.winePrefixPath &&
    isSameOrChildPath(normalizedPath, context.winePrefixPath, "linux");
  const portableWindowsHostPath =
    context.platform === "linux" &&
    context.windowsCompatibility &&
    ((context.installDir &&
      isSameOrChildPath(normalizedPath, context.installDir, "linux")) ||
      (context.storeRoot &&
        isSameOrChildPath(normalizedPath, context.storeRoot, "linux")))
      ? portablePathFromAbsolute(normalizedPath, context)
      : null;
  if (
    insideActiveWinePrefix &&
    !portableWinePath &&
    !portableWindowsHostPath?.startsWith("<base>") &&
    !portableWindowsHostPath?.startsWith("<root>")
  ) {
    throw new Error(
      context.wineUserProfilePath
        ? "cloud_save_custom_path_non_portable"
        : "cloud_save_custom_path_wine_profile_unavailable"
    );
  }
  if (
    portableWinePath ||
    portableWindowsHostPath?.startsWith("<base>") ||
    portableWindowsHostPath?.startsWith("<root>")
  ) {
    const portablePath =
      portableWinePath ?? (portableWindowsHostPath as string);
    const rawPath = `${CLOUD_SAVE_CUSTOM_PATH_PREFIX}${PLATFORM_MARKERS.windows}${portablePath}`;
    const storeUserId = selectedStoreUserId(normalizedPath, context);
    const decoded = decodeCloudSaveCustomPath(rawPath, {
      ...context,
      preferredStoreUserId: storeUserId,
    });
    return {
      ...decoded,
      path: normalizedPath,
      ...(storeUserId ? { storeUserId } : {}),
    };
  }
  const portablePath = portablePathFromAbsolute(normalizedPath, context);
  const encodedPath = portablePath.startsWith("<")
    ? portablePath
    : `${CLOUD_SAVE_CUSTOM_ABSOLUTE_PATH_MARKER}${portablePath}`;
  const storeUserId = selectedStoreUserId(normalizedPath, context);
  const decoded = decodeCloudSaveCustomPath(
    `${CLOUD_SAVE_CUSTOM_PATH_PREFIX}${PLATFORM_MARKERS[platform]}${encodedPath}`,
    { ...context, preferredStoreUserId: storeUserId }
  );
  return {
    ...decoded,
    ...(storeUserId ? { storeUserId } : {}),
  };
};

export const bindCloudSaveCustomPathToLocalPath = (
  rawPath: string,
  localPath: string,
  context = getCurrentCloudSaveCustomPathContext()
) => {
  if (!rawPath.startsWith(CLOUD_SAVE_CUSTOM_PATH_PREFIX)) {
    throw new Error("cloud_save_custom_path_invalid_prefix");
  }
  const normalizedPath = normalizeAbsolutePath(localPath, context.platform);
  const localBinding = encodeCloudSaveCustomPath(normalizedPath, context);
  return {
    rawPath,
    path: normalizedPath,
    platform: localBinding.platform,
    ...(localBinding.storeUserId
      ? { storeUserId: localBinding.storeUserId }
      : {}),
  };
};

const findExistingCustomPathAncestor = async (
  customPath: string,
  platform: CloudSaveCustomPathPlatform
) => {
  const pathApi = platform === "windows" ? path.win32 : path.posix;
  let existing = customPath;
  for (;;) {
    try {
      await fs.lstat(existing);
      return existing;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = pathApi.dirname(existing);
      if (parent === existing) {
        throw new Error("cloud_save_custom_path_parent_unavailable");
      }
      existing = parent;
    }
  }
};

const getCanonicalAllowedWineRoots = async (
  customPath: CloudSaveCustomPath,
  context: CloudSaveCustomPathContext
) => {
  if (
    context.platform !== "linux" ||
    customPath.platform !== "windows" ||
    !context.windowsCompatibility
  ) {
    return [];
  }

  const roots = [context.homeDir, context.winePrefixPath].filter(
    (root): root is string => Boolean(root)
  );
  return Promise.all(roots.map((root) => fs.realpath(root).catch(() => root)));
};

const assertNoSymlinkAncestor = async (
  customPath: CloudSaveCustomPath,
  context = getCurrentCloudSaveCustomPathContext()
) => {
  const filesystemPlatform = context.platform;
  const existing = await findExistingCustomPathAncestor(
    customPath.path,
    filesystemPlatform
  );

  const canonicalExisting = normalizeAbsolutePath(
    await fs.realpath(existing),
    filesystemPlatform
  );
  if (
    pathKey(canonicalExisting, filesystemPlatform) !==
    pathKey(existing, filesystemPlatform)
  ) {
    const canonicalAllowedRoots = await getCanonicalAllowedWineRoots(
      customPath,
      context
    );
    if (
      !canonicalAllowedRoots.some((root) =>
        isSameOrChildPath(canonicalExisting, root, "linux")
      )
    ) {
      throw new Error("cloud_save_custom_path_symlink_ancestor");
    }
  }
  await fs.access(existing, fsConstants.W_OK);
};

export const validateBoundCloudSaveCustomPathForRestore = async (
  rawPath: string,
  localPath: string,
  context = getCurrentCloudSaveCustomPathContext()
) => {
  const customPath = bindCloudSaveCustomPathToLocalPath(
    rawPath,
    localPath,
    context
  );
  await assertNoSymlinkAncestor(customPath, context);
  return customPath;
};

export const canonicalizeSelectedCloudSaveCustomPath = async (
  selectedPath: string,
  context = getCurrentCloudSaveCustomPathContext()
) => {
  const stats = await fs.stat(selectedPath);
  if (!stats.isDirectory()) {
    throw new Error("cloud_save_custom_path_not_directory");
  }

  const normalizedSelectedPath = normalizeAbsolutePath(
    path.resolve(selectedPath),
    context.platform
  );
  const sourcePath = portableWindowsPathFromWineAbsolute(
    normalizedSelectedPath,
    context
  )
    ? normalizedSelectedPath
    : await fs.realpath(selectedPath);
  const customPath = encodeCloudSaveCustomPath(sourcePath, context);
  await assertNoSymlinkAncestor(customPath, context);
  return customPath;
};

export const validateCloudSaveCustomPathForRestore = async (
  rawPath: string,
  platform = currentPlatform(),
  context = getCurrentCloudSaveCustomPathContext()
) => {
  if (context.platform !== platform) {
    throw new Error("cloud_save_custom_path_invalid_context");
  }
  let customPath: CloudSaveCustomPath;
  try {
    customPath = decodeCloudSaveCustomPath(rawPath, context);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "cloud_save_custom_path_foreign_platform"
    ) {
      return null;
    }
    throw error;
  }
  await assertNoSymlinkAncestor(customPath, context);
  return customPath;
};
