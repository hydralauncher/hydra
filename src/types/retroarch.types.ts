import type { RomFolder } from "./emulator.types";

export type RetroArchPlatform = "nes" | "snes" | "n64" | "gb" | "gbc" | "gba";

export type RetroArchCoreName =
  | "fceumm"
  | "snes9x"
  | "mupen64plus_next"
  | "gambatte"
  | "mgba";

export interface RetroArchCore {
  name: RetroArchCoreName;
  installed: boolean;
  version: string | null;
  path: string | null;
  installedAt: number | null;
}

export interface RetroArchConfig {
  executablePath: string | null;
  detectedVersion: string | null;
  detectedAt: number | null;
  cores: Record<RetroArchCoreName, RetroArchCore>;
  romFolders: RomFolder[];
  perPlatformCounts: Record<RetroArchPlatform, number>;
  totalFiles: number;
  totalSizeBytes: number;
  lastScanAt: number | null;
}

export interface RetroArchExecutablePreview {
  executablePath: string;
  detectedVersion: string | null;
}

export type RetroArchCoreInstallPhase =
  | "downloading"
  | "extracting"
  | "done"
  | "error";

export interface RetroArchCoreInstallProgress {
  core: RetroArchCoreName;
  phase: RetroArchCoreInstallPhase;
  loaded?: number;
  total?: number;
  reason?: string;
  path?: string;
}

export interface RetroArchCoreInstallResult {
  ok: boolean;
  core: RetroArchCoreName;
  path?: string;
  reason?: string;
}

export type RetroArchInstallKind =
  | "windows-archive"
  | "linux-appimage"
  | "link";

export type RetroArchInstallLinkKind = "flatpak" | "aur" | "release_page";

export interface RetroArchInstallOption {
  id: string;
  kind: RetroArchInstallKind;
  downloadUrl: string | null;
  fileName: string | null;
  version: string | null;
  linkUrl: string | null;
  linkKind: RetroArchInstallLinkKind | null;
}

export interface RetroArchInstallProgress {
  optionId: string;
  phase: "downloading" | "extracting" | "done" | "error";
  loaded?: number;
  total?: number;
  reason?: string;
  path?: string;
}

export interface RetroArchInstallResult {
  ok: boolean;
  path?: string;
  reason?: string;
}
