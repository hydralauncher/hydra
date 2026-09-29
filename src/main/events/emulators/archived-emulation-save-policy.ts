import type {
  EmulationCloudSave,
  EmulationSaveEmulator,
  EmulationSavePlatform,
} from "@types";

const archiveEmulatorByPlatform: Record<
  EmulationSavePlatform,
  EmulationSaveEmulator
> = {
  ps1: "duckstation",
  ps2: "pcsx2",
  psp: "ppsspp",
  gamecube: "dolphin",
  wii: "dolphin",
};

export const getArchivedEmulationSaveEmulator = (
  platform: EmulationSavePlatform
): EmulationSaveEmulator => {
  if (
    !Object.prototype.hasOwnProperty.call(archiveEmulatorByPlatform, platform)
  ) {
    throw new Error("invalid_emulation_save_platform");
  }
  return archiveEmulatorByPlatform[platform];
};

export const isArchivedEmulationSaveForGame = (
  save: EmulationCloudSave,
  platform: EmulationSavePlatform,
  objectId: string
) =>
  save.shop === "launchbox" &&
  save.objectId === objectId &&
  save.platform === platform;

export const isArchivedEmulationSaveForExport = (
  save: EmulationCloudSave,
  platform: EmulationSavePlatform,
  emulator: EmulationSaveEmulator,
  objectId: string | null
): boolean =>
  save.platform === platform &&
  save.emulator === emulator &&
  (!objectId || isArchivedEmulationSaveForGame(save, platform, objectId));

type ArchivedEmulationSaveLister = (
  platform: EmulationSavePlatform,
  emulator: EmulationSaveEmulator,
  objectId?: string | null
) => Promise<EmulationCloudSave[]>;

export const loadArchivedEmulationSaves = async (
  platform: EmulationSavePlatform,
  objectId: string | null,
  listRemote: ArchivedEmulationSaveLister
): Promise<EmulationCloudSave[]> => {
  const emulator = getArchivedEmulationSaveEmulator(platform);
  const saves = await listRemote(platform, emulator, objectId);
  return saves.filter((save) =>
    isArchivedEmulationSaveForExport(save, platform, emulator, objectId)
  );
};

export const sanitizeArchivedEmulationFileName = (value: string): string => {
  const basename = value.split(/[\\/]/).pop() ?? "";
  const cleaned = [...basename]
    .map((character) => (character.charCodeAt(0) < 32 ? "_" : character))
    .join("")
    .trim()
    .replaceAll(/[<>:"/\\|?*]/g, "_")
    .replace(/[. ]+$/g, "");
  const safeName = cleaned || "emulation-save";
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(safeName)
    ? `_${safeName}`
    : safeName;
};
