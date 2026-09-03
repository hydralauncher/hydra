import type { EmulationSavePlatform } from "@types";

export interface RestoreModalCopyKeys {
  title: string;
  description: string;
  confirm: string;
}

export const getRestoreModalCopyKeys = (
  platform: EmulationSavePlatform
): RestoreModalCopyKeys => {
  if (platform === "ps1" || platform === "ps2") {
    return {
      title: "cloud_restore_title",
      description: "cloud_restore_description",
      confirm: "cloud_restore_confirm",
    };
  }

  if (platform === "wii") {
    return {
      title: "cloud_restore_wii_title",
      description: "cloud_restore_wii_description",
      confirm: "cloud_restore_wii_confirm",
    };
  }

  return {
    title: "cloud_restore_emulator_title",
    description: "cloud_restore_emulator_description",
    confirm: "cloud_restore_emulator_confirm",
  };
};
