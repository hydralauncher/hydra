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

export interface RecompilationSummary {
  slug: string;
  name: string;
  author: string;
  iconUrl: string | null;
  version: string;
  tested: RecompilationTested;
}

export type RecompilationOs = "windows" | "linux" | "macos";

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

export interface RecompilationReadme {
  repository: string;
  defaultBranch: string;
  markdown: string;
  // Language the markdown was translated to, or null for the original.
  translatedTo: string | null;
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
  isPreparing?: boolean;
  version: string | null;
  installPath: string | null;
  installParentPath: string;
  executablePath: string | null;
  hasCloudSaves: boolean;
}

export interface RecompilationRomMeta {
  path?: {
    arg?: string[];
    env?: Record<string, string>;
    /** The first item names a program in the release, or `{exe}` for the port itself. */
    installer?: string[];
    /** One path, or one per system for ports that keep the file in different places. */
    config?: {
      file: string | Partial<Record<"win32" | "linux", string>>;
      key: string[];
    };
    settings?: Array<{
      file: string | Partial<Record<"win32" | "linux", string>>;
      values: Record<string, string>;
      seedFrom?: string;
    }>;
    online?: {
      enabledEnv: string;
      nameEnv: string;
      nameConfig: {
        file: string | Partial<Record<"win32" | "linux", string>>;
        keys: string[];
      };
      reservedNames: string[];
    };
  };
  once?: boolean;
  /** Runs the installer again after every port update, for ports that rebuild the game per version. */
  prepareOnUpdate?: boolean;
  copyTo?: Partial<Record<"win32" | "linux", string>>;
  imported?: Partial<Record<"win32" | "linux", string[]>>;
  format?: "z64";
  sha1?: string[];
  /** The game is a folder (a PS4 dump) holding these files, not a single ROM file. */
  folder?: string[];
  /** PS4 game IDs (TITLE_ID in sce_sys/param.sfo) the port runs; a folder of another game is refused. */
  titleIds?: string[];
  /** PS4 game versions (APP_VER in sce_sys/param.sfo) the port runs; others get a warning. */
  appVersions?: string[];
  requireAppVersion?: boolean;
  extensions: string[];
}

export type RecompilationRomSource = "library" | "file";

export interface RecompilationRomState {
  handlesRom: boolean;
  source: RecompilationRomSource | null;
  romPath: string | null;
  libraryRomPath: string | null;
  isReady: boolean;
  needsPreparation: boolean;
  isFolder: boolean;
  extensions: string[];
}

export interface RecompilationPrepareStep {
  step?: number;
  steps?: number;
  title?: string;
  percent?: number;
}

export interface RecompilationPrepareProgress extends RecompilationPrepareStep {
  slug: string;
  phase: "running" | "done" | "error";
}

export interface RecompilationActionResult {
  ok: boolean;
  reason?: string;
  warning?: string;
  requiredVersion?: string;
  isUpdate?: boolean;
  /** Set when an update finished and the port started preparing again. */
  preparing?: boolean;
  /** The game folder a picked file resolves to, for the folder ports. */
  path?: string;
}
