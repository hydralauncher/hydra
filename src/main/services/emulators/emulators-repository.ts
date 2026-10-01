import { emulatorsSublevel } from "@main/level";
import { EMULATOR_SYSTEMS } from "@shared";
import type { EmulatorConfig, EmulatorConfigMap, EmulatorSystem } from "@types";
import { KNOWN_BINARIES, systemsForBinary } from "./known-binaries";

const emptyConfig = (system: EmulatorSystem): EmulatorConfig => ({
  system,
  binary: KNOWN_BINARIES[system].binary,
  executablePath: null,
  detectedVersion: null,
  detectedAt: null,
  biosPath: null,
  romFolders: [],
  lastScanAt: null,
  totalFiles: 0,
  totalSizeBytes: 0,
});

export const getEmulatorConfig = async (
  system: EmulatorSystem
): Promise<EmulatorConfig> => {
  const existing = await emulatorsSublevel.get(system);
  const config = existing ?? emptyConfig(system);

  if (config.executablePath) return config;

  for (const sibling of systemsForBinary(config.binary)) {
    if (sibling === system) continue;
    const siblingConfig = await emulatorsSublevel.get(sibling);
    if (!siblingConfig?.executablePath) continue;
    return {
      ...config,
      executablePath: siblingConfig.executablePath,
      detectedVersion: siblingConfig.detectedVersion,
      detectedAt: siblingConfig.detectedAt,
    };
  }

  return config;
};

export const getAllEmulatorConfigs = async (): Promise<EmulatorConfigMap> => {
  const entries = await Promise.all(
    EMULATOR_SYSTEMS.map(async (s) => [s, await getEmulatorConfig(s)] as const)
  );
  return Object.fromEntries(entries) as EmulatorConfigMap;
};

export const setEmulatorConfig = async (
  config: EmulatorConfig
): Promise<EmulatorConfig> => {
  await emulatorsSublevel.put(config.system, config);

  for (const sibling of systemsForBinary(config.binary)) {
    if (sibling === config.system) continue;
    const siblingConfig =
      (await emulatorsSublevel.get(sibling)) ?? emptyConfig(sibling);
    await emulatorsSublevel.put(sibling, {
      ...siblingConfig,
      executablePath: config.executablePath,
      detectedVersion: config.detectedVersion,
      detectedAt: config.detectedAt,
    });
  }

  return config;
};

export const updateEmulatorConfig = async (
  system: EmulatorSystem,
  patch: (current: EmulatorConfig) => EmulatorConfig
): Promise<EmulatorConfig> => {
  const current = await getEmulatorConfig(system);
  const next = patch(current);
  return setEmulatorConfig(next);
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
  for (const system of EMULATOR_SYSTEMS) {
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
