import axios from "axios";

import type {
  EmulatorBinary,
  EmulatorInstallChannel,
  EmulatorInstallKind,
  EmulatorInstallLinkKind,
  ResolvedInstallOption,
} from "@types";

import { logger } from "../logger";
import { isKnownEmulatorBinary } from "./known-binaries";

type InstallOs = "win32" | "linux";
type InstallArch = "x64" | "arm64";

type ReleaseChannel = "rolling" | "latest" | "release" | "prerelease";

interface GithubAssetSource {
  type: "github";
  id: string;
  binary: EmulatorBinary;
  repo: string;
  channel: ReleaseChannel;
  channelLabel: EmulatorInstallChannel | null;
  assetPattern: RegExp;
  kind: Exclude<EmulatorInstallKind, "link">;
}

interface LinkSource {
  type: "link";
  id: string;
  binary: EmulatorBinary;
  linkKind: Exclude<EmulatorInstallLinkKind, "release_page">;
  url: string;
}

type EmulatorSourceEntry = GithubAssetSource | LinkSource;

const duckstationEntries = (
  os: InstallOs,
  arch: InstallArch
): EmulatorSourceEntry[] => {
  if (os === "win32") {
    const assetPattern =
      arch === "arm64"
        ? /^duckstation-windows-arm64-installer\.exe$/i
        : /^duckstation-windows-x64-installer\.exe$/i;
    return [
      {
        type: "github",
        id: "duckstation-install",
        binary: "duckstation",
        repo: "stenzek/duckstation",
        channel: "rolling",
        channelLabel: null,
        assetPattern,
        kind: "windows-installer",
      },
    ];
  }

  const assetPattern =
    arch === "arm64"
      ? /^DuckStation-arm64\.AppImage$/i
      : /^DuckStation-x64\.AppImage$/i;
  return [
    {
      type: "github",
      id: "duckstation-install",
      binary: "duckstation",
      repo: "stenzek/duckstation",
      channel: "rolling",
      channelLabel: null,
      assetPattern,
      kind: "linux-appimage",
    },
    {
      type: "link",
      id: "duckstation-aur",
      binary: "duckstation",
      linkKind: "aur",
      url: "https://aur.archlinux.org/packages/duckstation-git",
    },
  ];
};

const pcsx2AssetPattern = (os: InstallOs, arch: InstallArch): RegExp => {
  if (os !== "win32") return /linux-appimage-x64-Qt\.AppImage$/i;
  if (arch === "arm64") return /windows-arm64-installer\.exe$/i;
  return /windows-x64-installer\.exe$/i;
};

const pcsx2Entries = (
  os: InstallOs,
  arch: InstallArch
): EmulatorSourceEntry[] => {
  const isWindows = os === "win32";
  const hasNativeBuild = isWindows || arch === "x64";

  const entries: EmulatorSourceEntry[] = [];

  if (hasNativeBuild) {
    const assetPattern = pcsx2AssetPattern(os, arch);
    const kind: Exclude<EmulatorInstallKind, "link"> = isWindows
      ? "windows-installer"
      : "linux-appimage";

    entries.push(
      {
        type: "github",
        id: "pcsx2-release",
        binary: "pcsx2",
        repo: "PCSX2/pcsx2",
        channel: "release",
        channelLabel: "release",
        assetPattern,
        kind,
      },
      {
        type: "github",
        id: "pcsx2-prerelease",
        binary: "pcsx2",
        repo: "PCSX2/pcsx2",
        channel: "prerelease",
        channelLabel: "prerelease",
        assetPattern,
        kind,
      }
    );
  }

  if (!isWindows) {
    entries.push(
      {
        type: "link",
        id: "pcsx2-aur",
        binary: "pcsx2",
        linkKind: "aur",
        url: "https://aur.archlinux.org/packages/pcsx2",
      },
      {
        type: "link",
        id: "pcsx2-flatpak",
        binary: "pcsx2",
        linkKind: "flatpak",
        url: "https://flathub.org/en/apps/net.pcsx2.PCSX2",
      }
    );
  }

  return entries;
};

const rpcs3Entries = (
  os: InstallOs,
  arch: InstallArch
): EmulatorSourceEntry[] => {
  if (os === "win32") {
    return [
      {
        type: "github",
        id: "rpcs3-install",
        binary: "rpcs3",
        repo: "RPCS3/rpcs3-binaries-win",
        channel: "latest",
        channelLabel: null,
        assetPattern: /_win64\.7z$/i,
        kind: "windows-archive",
      },
    ];
  }

  const entries: EmulatorSourceEntry[] = [];

  if (arch === "x64") {
    entries.push({
      type: "github",
      id: "rpcs3-install",
      binary: "rpcs3",
      repo: "RPCS3/rpcs3-binaries-linux",
      channel: "latest",
      channelLabel: null,
      assetPattern: /_linux64\.AppImage$/i,
      kind: "linux-appimage",
    });
  }

  entries.push(
    {
      type: "link",
      id: "rpcs3-aur",
      binary: "rpcs3",
      linkKind: "aur",
      url: "https://aur.archlinux.org/packages/rpcs3-git",
    },
    {
      type: "link",
      id: "rpcs3-flatpak",
      binary: "rpcs3",
      linkKind: "flatpak",
      url: "https://flathub.org/en/apps/net.rpcs3.RPCS3",
    }
  );

  return entries;
};

const githubEntries = (
  binary: EmulatorBinary,
  os: InstallOs,
  arch: InstallArch
): EmulatorSourceEntry[] => {
  if (binary === "duckstation") return duckstationEntries(os, arch);
  if (binary === "pcsx2") return pcsx2Entries(os, arch);
  if (binary === "rpcs3") return rpcs3Entries(os, arch);
  return [];
};

interface GithubAsset {
  name: string;
  browser_download_url: string;
}

interface GithubRelease {
  tag_name: string;
  html_url: string;
  prerelease: boolean;
  draft: boolean;
  assets: GithubAsset[];
}

const GITHUB_API = "https://api.github.com";
const GITHUB_API_TIMEOUT_MS = 15_000;
const GITHUB_RELEASES_PAGE_SIZE = 20;

const fetchRelease = async (
  repo: string,
  channel: ReleaseChannel
): Promise<GithubRelease | null> => {
  const config = {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "HydraLauncher",
    },
    timeout: GITHUB_API_TIMEOUT_MS,
  };

  try {
    if (channel === "rolling") {
      const { data } = await axios.get<GithubRelease>(
        `${GITHUB_API}/repos/${repo}/releases/tags/latest`,
        config
      );
      return data;
    }

    if (channel === "release" || channel === "latest") {
      const { data } = await axios.get<GithubRelease>(
        `${GITHUB_API}/repos/${repo}/releases/latest`,
        config
      );
      return data;
    }

    const { data } = await axios.get<GithubRelease[]>(
      `${GITHUB_API}/repos/${repo}/releases?per_page=${GITHUB_RELEASES_PAGE_SIZE}`,
      config
    );
    return data.find((release) => release.prerelease && !release.draft) ?? null;
  } catch (error) {
    logger.error(`Failed to fetch ${channel} release for ${repo}`, error);
    return null;
  }
};

const resolveGithubOption = async (
  entry: GithubAssetSource
): Promise<ResolvedInstallOption> => {
  const release = await fetchRelease(entry.repo, entry.channel);

  if (!release) {
    return {
      id: entry.id,
      binary: entry.binary,
      kind: "link",
      channel: entry.channelLabel,
      downloadUrl: null,
      fileName: null,
      version: null,
      htmlUrl: null,
      linkUrl: `https://github.com/${entry.repo}/releases`,
      linkKind: "release_page",
    };
  }

  const asset = release.assets.find((candidate) =>
    entry.assetPattern.test(candidate.name)
  );

  if (!asset) {
    return {
      id: entry.id,
      binary: entry.binary,
      kind: "link",
      channel: entry.channelLabel,
      downloadUrl: null,
      fileName: null,
      version: release.tag_name,
      htmlUrl: release.html_url,
      linkUrl: release.html_url,
      linkKind: "release_page",
    };
  }

  return {
    id: entry.id,
    binary: entry.binary,
    kind: entry.kind,
    channel: entry.channelLabel,
    downloadUrl: asset.browser_download_url,
    fileName: asset.name,
    version: release.tag_name,
    htmlUrl: release.html_url,
    linkUrl: null,
    linkKind: null,
  };
};

const normalizeArch = (arch: string): InstallArch =>
  arch === "arm64" ? "arm64" : "x64";

/**
 * Resolves the install options Hydra can offer for an emulator on the given
 * platform. GitHub-backed entries are resolved against the releases API so that
 * version-stamped filenames (PCSX2) and rolling tags (DuckStation) keep working
 * across new releases. Link-only entries (AUR/Flatpak) are returned as-is.
 */
export const resolveInstallOptions = async (
  binary: EmulatorBinary,
  os: NodeJS.Platform,
  arch: string
): Promise<ResolvedInstallOption[]> => {
  if (!isKnownEmulatorBinary(binary)) return [];
  if (os !== "win32" && os !== "linux") return [];

  const entries = githubEntries(binary, os, normalizeArch(arch));

  const resolved = await Promise.all(
    entries.map((entry) => {
      if (entry.type === "link") {
        return Promise.resolve<ResolvedInstallOption>({
          id: entry.id,
          binary: entry.binary,
          kind: "link",
          channel: null,
          downloadUrl: null,
          fileName: null,
          version: null,
          htmlUrl: null,
          linkUrl: entry.url,
          linkKind: entry.linkKind,
        });
      }
      return resolveGithubOption(entry);
    })
  );

  return resolved;
};
