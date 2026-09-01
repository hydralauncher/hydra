import type { ResolvedInstallOption } from "@types";

export type InstallOs = "win32" | "linux" | "darwin";
export type InstallArch = "x64" | "arm64";

export const DOLPHIN_DOWNLOADS_PAGE = "https://dolphin-emu.org/download/";

const DOLPHIN_TAG_PATTERN = /^(\d{4})([a-z]?)$/i;

export const pickLatestDolphinReleaseTag = (
  tags: readonly string[]
): string | null => {
  const releases = tags
    .map((tag) => {
      const match = DOLPHIN_TAG_PATTERN.exec(tag);
      if (!match) return null;

      return {
        tag,
        release: Number(match[1]),
        hotfix: match[2] ? (match[2].toLowerCase().codePointAt(0) ?? 0) : 0,
      };
    })
    .filter((release): release is NonNullable<typeof release> =>
      Boolean(release)
    )
    .sort(
      (left, right) =>
        right.release - left.release || right.hotfix - left.hotfix
    );

  return releases[0]?.tag ?? null;
};

export const buildDolphinInstallOption = (
  version: string,
  os: InstallOs,
  arch: InstallArch
): ResolvedInstallOption | null => {
  const releasePage = `${DOLPHIN_DOWNLOADS_PAGE}release/${version}/`;
  const releaseRoot = `https://dl.dolphin-emu.org/releases/${version}`;

  if (os === "darwin") {
    const fileName = `dolphin-${version}-universal.dmg`;
    return {
      id: "dolphin-install",
      binary: "dolphin",
      kind: "macos-dmg",
      channel: "release",
      downloadUrl: `${releaseRoot}/${fileName}`,
      fileName,
      version,
      htmlUrl: releasePage,
      linkUrl: null,
      linkKind: null,
    };
  }

  if (os === "win32") {
    const platform = arch === "arm64" ? "arm64" : "x64";
    const fileName = `dolphin-${version}-${platform}.7z`;
    return {
      id: "dolphin-install",
      binary: "dolphin",
      kind: "portable-archive",
      channel: "release",
      downloadUrl: `${releaseRoot}/${fileName}`,
      fileName,
      version,
      htmlUrl: releasePage,
      linkUrl: null,
      linkKind: null,
    };
  }

  return null;
};
