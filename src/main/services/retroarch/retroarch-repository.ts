import { retroarchSublevel } from "@main/level";
import type {
  RetroArchConfig,
  RetroArchCore,
  RetroArchCoreName,
  RetroArchPlatform,
} from "@types";
import { RETROARCH_CORE_NAMES, RETROARCH_PLATFORMS } from "./retroarch-cores";

const CONFIG_KEY = "config";

const emptyCore = (name: RetroArchCoreName): RetroArchCore => ({
  name,
  installed: false,
  version: null,
  path: null,
  installedAt: null,
});

const emptyCores = (): Record<RetroArchCoreName, RetroArchCore> =>
  Object.fromEntries(
    RETROARCH_CORE_NAMES.map((name) => [name, emptyCore(name)])
  ) as Record<RetroArchCoreName, RetroArchCore>;

const emptyCounts = (): Record<RetroArchPlatform, number> =>
  Object.fromEntries(
    RETROARCH_PLATFORMS.map((platform) => [platform, 0])
  ) as Record<RetroArchPlatform, number>;

const emptyConfig = (): RetroArchConfig => ({
  executablePath: null,
  detectedVersion: null,
  detectedAt: null,
  cores: emptyCores(),
  romFolders: [],
  perPlatformCounts: emptyCounts(),
  totalFiles: 0,
  totalSizeBytes: 0,
  lastScanAt: null,
});

export const getRetroArchConfig = async (): Promise<RetroArchConfig> => {
  const existing = await retroarchSublevel.get(CONFIG_KEY);
  if (!existing) return emptyConfig();
  return {
    ...emptyConfig(),
    ...existing,
    cores: { ...emptyCores(), ...existing.cores },
    perPlatformCounts: {
      ...emptyCounts(),
      ...existing.perPlatformCounts,
    },
  };
};

export const setRetroArchConfig = async (
  config: RetroArchConfig
): Promise<RetroArchConfig> => {
  await retroarchSublevel.put(CONFIG_KEY, config);
  return config;
};

export const updateRetroArchConfig = async (
  patch: (current: RetroArchConfig) => RetroArchConfig
): Promise<RetroArchConfig> => {
  const current = await getRetroArchConfig();
  const next = patch(current);
  await retroarchSublevel.put(CONFIG_KEY, next);
  return next;
};

export const recomputeRetroArchTotals = (
  config: RetroArchConfig
): RetroArchConfig => {
  const totalFiles = config.romFolders.reduce((s, f) => s + f.fileCount, 0);
  const totalSizeBytes = config.romFolders.reduce((s, f) => s + f.sizeBytes, 0);
  const lastScanAt = config.romFolders.reduce<number | null>((acc, f) => {
    if (f.lastScanAt === null) return acc;
    return acc === null || f.lastScanAt > acc ? f.lastScanAt : acc;
  }, null);
  return { ...config, totalFiles, totalSizeBytes, lastScanAt };
};

export const resetRetroArchScanData = async (): Promise<void> => {
  const existing = await retroarchSublevel.get(CONFIG_KEY);
  if (!existing) return;
  await retroarchSublevel.put(CONFIG_KEY, {
    ...existing,
    romFolders: (existing.romFolders ?? []).map((folder) => ({
      ...folder,
      fileCount: 0,
      sizeBytes: 0,
      lastScanAt: null,
    })),
    perPlatformCounts: emptyCounts(),
    totalFiles: 0,
    totalSizeBytes: 0,
    lastScanAt: null,
  });
};
