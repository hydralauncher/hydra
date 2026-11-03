export type RecompilationTestedLevel =
  | "platinum"
  | "gold"
  | "silver"
  | "bronze"
  | "untested";

export type RecompilationTestedFeatureKey =
  | "launch"
  | "playtime"
  | "cloudSaves"
  | "achievements"
  | "controllerBigPicture";

export type RecompilationTestedFeatureStatus =
  | "works"
  | "unsupported"
  | "testing";

export interface RecompilationTested {
  level: RecompilationTestedLevel;
  testedVersion: string | null;
  isLatestTested: boolean;
  features: {
    key: RecompilationTestedFeatureKey;
    status: RecompilationTestedFeatureStatus;
  }[];
}

/** GET /games/launchbox/:objectId/recompilations */
export interface RecompilationSummary {
  slug: string;
  name: string;
  author: string;
  iconUrl: string | null;
  version: string;
  tested: RecompilationTested;
}

export type RecompilationOs = "windows" | "linux" | "macos";

/** GET /games/launchbox/:objectId/recompilations/:slug */
export interface RecompilationDetails extends RecompilationSummary {
  repository: {
    fullName: string;
    url: string;
    defaultBranch: string;
  };
  versionName: string;
  releasedAt: string;
  releaseUrl: string;
  downloadCount: number;
  stars: number;
  license: string | null;
  systems: RecompilationOs[];
  romRequirement: string | null;
  assetCount: number;
  reviewCount: number;
  averageScore: number | null;
  lastSyncedAt: string;
  game: {
    shop: "launchbox";
    objectId: string;
    title: string;
    platform: string | null;
    iconUrl: string | null;
    coverImageUrl: string | null;
    libraryImageUrl: string | null;
    libraryHeroImageUrl: string | null;
    logoImageUrl: string | null;
  };
}

/** GET /games/launchbox/:objectId/recompilations/:slug/readme */
export interface RecompilationReadme {
  repository: string;
  defaultBranch: string;
  markdown: string;
  sha: string;
  lastSyncedAt: string;
}

export interface RecompilationReleaseAsset {
  name: string;
  size: number;
  downloadCount: number;
  url: string;
  sha256: string | null;
  os: RecompilationOs;
  arch: string | null;
  /** The one file Hydra installs on that OS. */
  isInstallTarget: boolean;
}

export interface RecompilationRelease {
  tag: string;
  version: string;
  name: string;
  notesMarkdown: string | null;
  publishedAt: string;
  url: string;
  isLatest: boolean;
  assets: RecompilationReleaseAsset[];
}

/** GET /games/launchbox/:objectId/recompilations/:slug/releases */
export interface RecompilationReleases {
  releases: RecompilationRelease[];
}

export interface RecompilationRef {
  objectId: string;
  slug: string;
}

export type RecompilationInstallPhase =
  | "downloading"
  | "extracting"
  | "done"
  | "error";

export interface RecompilationInstallProgress {
  slug: string;
  phase: RecompilationInstallPhase;
  loaded?: number;
  total?: number;
  reason?: string;
}

export interface RecompilationInstallState {
  installed: boolean;
  isInstalling: boolean;
  /** Installed version, or null when not installed. */
  version: string | null;
  installPath: string | null;
  executablePath: string | null;
  /** True when Hydra knows where this port keeps its saves. */
  hasCloudSaves: boolean;
}

/**
 * How Hydra hands the game's ROM to a port, from recompilation-meta.json.
 * `{rom}` is the ROM path and `{romName}` its file name.
 */
export interface RecompilationRomMeta {
  path?: {
    /** Arguments passed when the port is launched. */
    arg?: string[];
    /** Environment variables set when the port is launched. */
    env?: Record<string, string>;
    /** A tool from the port folder, run once before the first launch. */
    installer?: string[];
  };
  /** Only needed on the first launch (the port keeps what it extracted). */
  once?: boolean;
  /** Where the port reads the ROM from, per OS. Hydra copies it there. */
  copyTo?: Partial<Record<"win32" | "linux" | "darwin", string>>;
  /**
   * Files the port writes once it has imported the game data, per OS. Any of
   * them on disk means the port starts without the ROM.
   */
  imported?: Partial<Record<"win32" | "linux" | "darwin", string[]>>;
  /** Byte order the port needs (N64 ROMs); Hydra converts other orders. */
  format?: "z64";
  /** File extensions the port reads, lower case with the dot. */
  extensions: string[];
}

export type RecompilationRomSource = "library" | "file";

export interface RecompilationRomState {
  /** False for ports Hydra cannot hand a ROM to (no install modal). */
  handlesRom: boolean;
  source: RecompilationRomSource | null;
  /** The ROM Hydra will use, when it exists on disk. */
  romPath: string | null;
  /** The base game's ROM in the library, when it exists on disk. */
  libraryRomPath: string | null;
  /**
   * The port already has what it needs from the ROM (imported data or the
   * copy Hydra made), so it starts even if the ROM file is gone.
   */
  isReady: boolean;
  /** Extensions the file picker accepts, without the dot. */
  extensions: string[];
}

export interface RecompilationActionResult {
  ok: boolean;
  reason?: string;
}
