import type { EmulatorSystem } from "@types";

export type EmulatorTab =
  | "emulator"
  | "rom-folders"
  | "memory-cards"
  | "saves"
  | "library";

const EMULATOR_TABS: EmulatorTab[] = [
  "emulator",
  "rom-folders",
  "memory-cards",
  "saves",
  "library",
];

export const supportsMemoryCards = (system: EmulatorSystem): boolean =>
  system === "ps1" || system === "ps2";

export const supportsEmulatorSaves = (system: EmulatorSystem): boolean =>
  system === "psp" || system === "dolphin";

export const availableEmulatorTabs = (system: EmulatorSystem): EmulatorTab[] =>
  EMULATOR_TABS.filter((tab) => {
    if (tab === "memory-cards") return supportsMemoryCards(system);
    if (tab === "saves") return supportsEmulatorSaves(system);
    return true;
  });
