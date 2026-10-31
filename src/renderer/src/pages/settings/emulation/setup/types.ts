import type { EmulatorSystem } from "@types";

export type StepKind =
  | "find_emulator"
  | "firmware"
  | "bios"
  | "rom_folder"
  | "scanning"
  | "done";

export interface PendingFolder {
  path: string;
  scanSubfolders: boolean;
  previewCount: number | null;
  previewRequestId: number;
}

export const stepListForSystem = (system: EmulatorSystem): StepKind[] => {
  if (system === "ps3") {
    return ["find_emulator", "firmware", "rom_folder", "scanning", "done"];
  }
  if (system === "psp" || system === "dolphin") {
    return ["find_emulator", "rom_folder", "scanning", "done"];
  }
  return ["find_emulator", "bios", "rom_folder", "scanning", "done"];
};
