import type {
  RecompilationPort,
  RecompilationPortId,
  RecompilationReleaseAsset,
} from "@types";

/*
 * Prototype data for the Classics "Recompilations" design. Everything here is
 * hardcoded from the GitHub releases API (fetched 2026-11-01) and, for the
 * blurbs and feature labels, the PC port catalog used by the approved design.
 * Nothing is fetched at runtime. Only The Legend of Zelda: Majora's Mask (Nintendo 64)
 * has native PC ports in this prototype.
 */

const githubAsset = (
  repository: string,
  tag: string,
  asset: Omit<RecompilationReleaseAsset, "url">
): RecompilationReleaseAsset => ({
  ...asset,
  url: `https://github.com/${repository}/releases/download/${tag}/${asset.name}`,
});

const TWO_SHIP_REPOSITORY = "2ship2harkinian/2ship2harkinian";
const ZELDA64_RECOMP_REPOSITORY = "Zelda64Recomp/Zelda64Recomp";

export const RECOMPILATION_PORTS: Record<
  RecompilationPortId,
  RecompilationPort
> = {
  "2ship2harkinian": {
    id: "2ship2harkinian",
    name: "2 Ship 2 Harkinian",
    developer: "HarbourMasters",
    blurb:
      "Majora's Mask as a native PC game, with high resolutions, widescreen and enhancements.",
    featureLabels: ["Mods"],
    repository: TWO_SHIP_REPOSITORY,
    defaultBranch: "develop",
    license: "CC0-1.0",
    totalDownloads: 727_711,
    supportedOs: ["windows", "linux", "macos"],
    release: {
      version: "5.0.1",
      codename: "Battler Bravo",
      name: "Battler Bravo 5.0.1",
      tag: "5.0.1",
      publishedAt: "2026-08-25T17:54:43Z",
      url: `https://github.com/${TWO_SHIP_REPOSITORY}/releases/tag/5.0.1`,
      assets: [
        githubAsset(TWO_SHIP_REPOSITORY, "5.0.1", {
          name: "2Ship-Battler-Bravo-Win64.zip",
          osLabel: "Windows",
          fileLabel: "Windows zip",
          size: 44_976_935,
          downloadCount: 48_926,
          installTarget: { platform: "win32" },
        }),
        githubAsset(TWO_SHIP_REPOSITORY, "5.0.1", {
          name: "2Ship-Battler-Bravo-Linux.zip",
          osLabel: "Linux",
          fileLabel: "Linux zip",
          size: 16_262_941,
          downloadCount: 11_136,
          installTarget: { platform: "linux", arch: ["x64"] },
        }),
        githubAsset(TWO_SHIP_REPOSITORY, "5.0.1", {
          name: "2Ship-Battler-Bravo-Mac.zip",
          osLabel: "macOS",
          fileLabel: "macOS zip",
          size: 26_742_222,
          downloadCount: 3_022,
          installTarget: { platform: "darwin" },
        }),
      ],
    },
  },
  zelda64recomp: {
    id: "zelda64recomp",
    name: "Zelda 64: Recompiled",
    developer: "Zelda64Recomp",
    blurb:
      "Majora's Mask as a native PC game: widescreen, high frame rates, mods and modern controls.",
    featureLabels: ["Widescreen", "High FPS", "Mods", "Gyro"],
    repository: ZELDA64_RECOMP_REPOSITORY,
    defaultBranch: "dev",
    license: "GPL-3.0",
    totalDownloads: 382_632,
    supportedOs: ["windows", "linux", "macos"],
    release: {
      version: "1.2.2",
      codename: null,
      name: "v1.2.2",
      tag: "v1.2.2",
      publishedAt: "2025-08-27T00:58:35Z",
      url: `https://github.com/${ZELDA64_RECOMP_REPOSITORY}/releases/tag/v1.2.2`,
      assets: [
        githubAsset(ZELDA64_RECOMP_REPOSITORY, "v1.2.2", {
          name: "Zelda64Recompiled-v1.2.2-Windows.zip",
          osLabel: "Windows",
          fileLabel: "Windows zip",
          size: 28_940_501,
          downloadCount: 88_450,
          installTarget: { platform: "win32" },
        }),
        // x64 Linux takes the plain zip, never the ARM64 one.
        githubAsset(ZELDA64_RECOMP_REPOSITORY, "v1.2.2", {
          name: "Zelda64Recompiled-v1.2.2-Linux-X64.zip",
          osLabel: "Linux x64",
          fileLabel: "Linux x64 zip",
          size: 18_638_525,
          downloadCount: 18_389,
          installTarget: { platform: "linux", arch: ["x64"] },
        }),
        githubAsset(ZELDA64_RECOMP_REPOSITORY, "v1.2.2", {
          name: "Zelda64Recompiled-v1.2.2-Linux-Flatpak-X64.zip",
          osLabel: "Linux x64 Flatpak",
          fileLabel: "Linux x64 Flatpak zip",
          size: 13_024_507,
          downloadCount: 10_400,
        }),
        githubAsset(ZELDA64_RECOMP_REPOSITORY, "v1.2.2", {
          name: "Zelda64Recompiled-v1.2.2-Linux-ARM64.zip",
          osLabel: "Linux ARM64",
          fileLabel: "Linux ARM64 zip",
          size: 19_228_944,
          downloadCount: 4_686,
          installTarget: { platform: "linux", arch: ["arm64"] },
        }),
        githubAsset(ZELDA64_RECOMP_REPOSITORY, "v1.2.2", {
          name: "Zelda64Recompiled-v1.2.2-macOS.zip",
          osLabel: "macOS",
          fileLabel: "macOS zip",
          size: 32_315_959,
          downloadCount: 4_665,
          installTarget: { platform: "darwin" },
        }),
      ],
    },
  },
};

export interface RecompilationGameRef {
  shop?: string | null;
  title?: string | null;
  platform?: string | null;
}

const normalizeRecompilationText = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['‘’`´]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** The only Classics game with native PC ports in this prototype. */
const RECOMPILATION_GAMES: {
  platforms: string[];
  titles: string[];
  portIds: RecompilationPortId[];
}[] = [
  {
    platforms: ["nintendo 64", "n64"],
    titles: [
      "the legend of zelda majoras mask",
      "legend of zelda majoras mask",
      "zelda majoras mask",
    ],
    portIds: ["2ship2harkinian", "zelda64recomp"],
  },
];

/**
 * Native PC ports for a Classics (LaunchBox) game, most downloaded first.
 * Matches on the normalized title plus the LaunchBox platform name.
 */
export const getRecompilationPortsForGame = (
  game: RecompilationGameRef
): RecompilationPort[] => {
  if (game.shop !== "launchbox" || !game.title || !game.platform) return [];

  const title = normalizeRecompilationText(game.title);
  const platform = normalizeRecompilationText(game.platform);

  const match = RECOMPILATION_GAMES.find(
    (entry) =>
      entry.platforms.includes(platform) && entry.titles.includes(title)
  );

  if (!match) return [];

  return match.portIds
    .map((id) => RECOMPILATION_PORTS[id])
    .sort((a, b) => b.totalDownloads - a.totalDownloads);
};

export const hasRecompilation = (game: RecompilationGameRef) =>
  getRecompilationPortsForGame(game).length > 0;

export const isRecompilationPortId = (
  value: unknown
): value is RecompilationPortId =>
  typeof value === "string" &&
  Object.prototype.hasOwnProperty.call(RECOMPILATION_PORTS, value);

/** The release file Install takes on the given host, or null when none fits. */
export const pickRecompilationAsset = (
  port: RecompilationPort,
  platform: string,
  arch: string
): RecompilationReleaseAsset | null =>
  port.release.assets.find(
    (asset) =>
      asset.installTarget?.platform === platform &&
      (!asset.installTarget.arch || asset.installTarget.arch.includes(arch))
  ) ?? null;
