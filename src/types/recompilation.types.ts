export type RecompilationPortId = "2ship2harkinian" | "zelda64recomp";

export type RecompilationOs = "windows" | "linux" | "macos";

export interface RecompilationReleaseAsset {
  name: string;
  /** Label shown in the release files list, e.g. "Linux x64". */
  osLabel: string;
  /** Label used in the Install caption, e.g. "Linux x64 zip". */
  fileLabel: string;
  size: number;
  downloadCount: number;
  url: string;
  /** Host this file is installed on. Files without a target are never picked. */
  installTarget?: {
    platform: "win32" | "linux" | "darwin";
    /** Allowed `process.arch` values. Omitted means any architecture. */
    arch?: string[];
  };
}

export interface RecompilationRelease {
  version: string;
  /** Release codename, e.g. "Battler Bravo". */
  codename: string | null;
  name: string;
  tag: string;
  publishedAt: string;
  url: string;
  assets: RecompilationReleaseAsset[];
}

export interface RecompilationPort {
  id: RecompilationPortId;
  name: string;
  developer: string;
  /** One-line description from the PC port catalog. */
  blurb: string;
  /** Catalog tags shown as labels: Widescreen, High FPS, Mods, Gyro. */
  featureLabels: string[];
  /** GitHub "owner/name". */
  repository: string;
  defaultBranch: string;
  license: string | null;
  /** Download count summed over every release on GitHub. */
  totalDownloads: number;
  supportedOs: RecompilationOs[];
  release: RecompilationRelease;
}

export type RecompilationInstallPhase =
  | "downloading"
  | "extracting"
  | "done"
  | "error";

export interface RecompilationInstallProgress {
  portId: RecompilationPortId;
  phase: RecompilationInstallPhase;
  loaded?: number;
  total?: number;
  reason?: string;
}

export interface RecompilationInstallState {
  installed: boolean;
  isInstalling: boolean;
  version: string | null;
  /** Release file Install takes on this PC, or null when none fits. */
  assetName: string | null;
  installPath: string | null;
}

export interface RecompilationInstallResult {
  ok: boolean;
  path?: string;
  reason?: string;
}
