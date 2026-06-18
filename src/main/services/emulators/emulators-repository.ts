import { emulatorsSublevel } from "@main/level";
import type { EmulatorConfig, EmulatorConfigMap, EmulatorSystem } from "@types";
import { KNOWN_BINARIES } from "./known-binaries";

const SYSTEMS: EmulatorSystem[] = ["ps1", "ps2", "ps3"];

const emptyConfig = (system: EmulatorSystem): EmulatorConfig => ({
  system,
  binary: KNOWN_BINARIES[system].binary,
  executablePath: null,
  detectedVersion: null,
  detectedAt: null,
  romFolders: [],
  lastScanAt: null,
  totalFiles: 0,
  totalSizeBytes: 0,
});

export const getEmulatorConfig = async (
  system: EmulatorSystem
): Promise<EmulatorConfig> => {
  const existing = await emulatorsSublevel.get(system);
  return existing ?? emptyConfig(system);
};

export const getAllEmulatorConfigs = async (): Promise<EmulatorConfigMap> => {
  const entries = await Promise.all(
    SYSTEMS.map(async (s) => [s, await getEmulatorConfig(s)] as const)
  );
  return Object.fromEntries(entries) as EmulatorConfigMap;
};

export const setEmulatorConfig = async (
  config: EmulatorConfig
): Promise<EmulatorConfig> => {
  await emulatorsSublevel.put(config.system, config);
  return config;
};

export const updateEmulatorConfig = async (
  system: EmulatorSystem,
  patch: (current: EmulatorConfig) => EmulatorConfig
): Promise<EmulatorConfig> => {
  const current = await getEmulatorConfig(system);
  const next = patch(current);
  await emulatorsSublevel.put(system, next);
  return next;
};

export const recomputeTotals = (config: EmulatorConfig): EmulatorConfig => {
  const totalFiles = config.romFolders.reduce((s, f) => s + f.fileCount, 0);
  const totalSizeBytes = config.romFolders.reduce((s, f) => s + f.sizeBytes, 0);
  const lastScanAt = config.romFolders.reduce<number | null>((acc, f) => {
    if (f.lastScanAt === null) return acc;
    return acc === null || f.lastScanAt > acc ? f.lastScanAt : acc;
  }, null);
  return { ...config, totalFiles, totalSizeBytes, lastScanAt };
};

export const resetEmulatorScanData = async (): Promise<void> => {
  for (const system of SYSTEMS) {
    const existing = await emulatorsSublevel.get(system);
    if (!existing) continue;
    await emulatorsSublevel.put(system, {
      ...existing,
      romFolders: existing.romFolders.map((folder) => ({
        ...folder,
        fileCount: 0,
        sizeBytes: 0,
        lastScanAt: null,
      })),
      totalFiles: 0,
      totalSizeBytes: 0,
      lastScanAt: null,
    });
  }
};
