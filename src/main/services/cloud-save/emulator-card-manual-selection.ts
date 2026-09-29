import path from "node:path";

import type { Game } from "@types";
import type { EmulatorCardProvider } from "./emulator-card-path-store.js";

const PS2_SLOTS = ["1", "2", "m1s1", "m1s2", "m1s3", "m2s1", "m2s2", "m2s3"];

export const manualCardSelectionFor = (
  game: Game | null | undefined,
  selectedPath: string,
  isDirectory: boolean
): { provider: EmulatorCardProvider; slots: string[] } | null => {
  if (!game || game.shop !== "launchbox") return null;
  const platform = game.platform?.toLowerCase() ?? "";
  const extension = path.extname(selectedPath).toLowerCase();
  if (
    /playstation\s*(?:1|one)|\bps1\b|\bpsx\b|^sony playstation$/.test(
      platform
    ) &&
    !isDirectory &&
    [".mcd", ".mcr", ".mc", ".gme", ".vgs", ".vmp"].includes(extension)
  ) {
    return {
      provider: "duckstation",
      slots: ["1", "2", "3", "4", "5", "6", "7", "8"],
    };
  }
  if (/playstation\s*2|\bps2\b/.test(platform) && extension === ".ps2") {
    return { provider: "pcsx2", slots: PS2_SLOTS };
  }
  if (
    /gamecube|\bwii\b/.test(platform) &&
    !isDirectory &&
    [".raw", ".gcp"].includes(extension)
  ) {
    return { provider: "dolphin", slots: ["A", "B"] };
  }
  return null;
};
