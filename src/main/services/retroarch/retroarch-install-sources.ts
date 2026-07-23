import axios from "axios";

import type { RetroArchCoreName, RetroArchInstallOption } from "@types";

import { logger } from "../logger";
import { RETROARCH_CORES } from "./retroarch-cores";

const BUILDBOT_BASE = "https://buildbot.libretro.com";
const BUILDBOT_TIMEOUT_MS = 15_000;

const buildbotPlatformPath = (
  os: NodeJS.Platform,
  arch: string
): string | null => {
  if (os === "win32") return arch === "arm64" ? null : "windows/x86_64";
  if (os === "linux") return arch === "arm64" ? null : "linux/x86_64";
  if (os === "darwin") {
    return arch === "arm64" ? "apple/osx/arm64" : "apple/osx/x86_64";
  }
  return null;
};

const coreLibraryExtension = (os: NodeJS.Platform): string => {
  if (os === "win32") return "dll";
  if (os === "darwin") return "dylib";
  return "so";
};

export const coreLibraryFileName = (
  core: RetroArchCoreName,
  os: NodeJS.Platform = process.platform
): string =>
  `${RETROARCH_CORES[core].buildbotName}_libretro.${coreLibraryExtension(os)}`;

export const buildCoreDownloadUrl = (
  core: RetroArchCoreName,
  os: NodeJS.Platform = process.platform,
  arch: string = process.arch
): string | null => {
  const platformPath = buildbotPlatformPath(os, arch);
  if (!platformPath) return null;
  return `${BUILDBOT_BASE}/nightly/${platformPath}/latest/${coreLibraryFileName(core, os)}.zip`;
};

const fetchLatestStableVersion = async (): Promise<string | null> => {
  try {
    const { data } = await axios.get<string>(`${BUILDBOT_BASE}/stable/`, {
      timeout: BUILDBOT_TIMEOUT_MS,
      responseType: "text",
      headers: { "User-Agent": "HydraLauncher" },
    });

    const versions = Array.from(
      String(data).matchAll(/href="(?:\/stable\/)?(\d+\.\d+(?:\.\d+)?)\/"/g)
    ).map((match) => match[1]);

    if (versions.length === 0) return null;

    const toParts = (version: string): number[] =>
      version.split(".").map((part) => Number.parseInt(part, 10));

    versions.sort((a, b) => {
      const pa = toParts(a);
      const pb = toParts(b);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (diff !== 0) return diff;
      }
      return 0;
    });

    return versions[versions.length - 1];
  } catch (error) {
    logger.error("Failed to fetch latest RetroArch stable version", error);
    return null;
  }
};

export const resolveRetroArchInstallOptions = async (
  os: NodeJS.Platform = process.platform,
  arch: string = process.arch
): Promise<RetroArchInstallOption[]> => {
  if (os === "win32") {
    if (arch === "arm64") return [];

    const stableVersion = await fetchLatestStableVersion();
    const downloadUrl = stableVersion
      ? `${BUILDBOT_BASE}/stable/${stableVersion}/windows/x86_64/RetroArch.7z`
      : `${BUILDBOT_BASE}/nightly/windows/x86_64/RetroArch.7z`;

    return [
      {
        id: "retroarch-windows-archive",
        kind: "windows-archive",
        downloadUrl,
        fileName: "RetroArch.7z",
        version: stableVersion,
        linkUrl: null,
        linkKind: null,
      },
    ];
  }

  if (os === "linux") {
    const options: RetroArchInstallOption[] = [];

    if (arch !== "arm64") {
      const stableVersion = await fetchLatestStableVersion();
      const downloadUrl = stableVersion
        ? `${BUILDBOT_BASE}/stable/${stableVersion}/linux/x86_64/RetroArch.7z`
        : `${BUILDBOT_BASE}/nightly/linux/x86_64/RetroArch.7z`;

      options.push({
        id: "retroarch-linux-appimage",
        kind: "linux-appimage",
        downloadUrl,
        fileName: "RetroArch.7z",
        version: stableVersion,
        linkUrl: null,
        linkKind: null,
      });
    }

    options.push(
      {
        id: "retroarch-flatpak",
        kind: "link",
        downloadUrl: null,
        fileName: null,
        version: null,
        linkUrl: "https://flathub.org/apps/org.libretro.RetroArch",
        linkKind: "flatpak",
      },
      {
        id: "retroarch-aur",
        kind: "link",
        downloadUrl: null,
        fileName: null,
        version: null,
        linkUrl: "https://aur.archlinux.org/packages/retroarch",
        linkKind: "aur",
      }
    );

    return options;
  }

  return [];
};
