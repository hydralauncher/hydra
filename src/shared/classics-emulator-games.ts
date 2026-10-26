import type { EmulatorSystem } from "@types";
import { platformToRetroArchPlatform } from "./retroarch-platform.js";
import { platformToSystem } from "./platform-to-system.js";

export type ClassicsEmulatorTarget =
  | { kind: "emulator"; system: EmulatorSystem }
  | { kind: "retroarch" };

export const isClassicsGameForEmulator = (
  game: { shop: string; platform?: string | null; isDeleted?: boolean },
  target: ClassicsEmulatorTarget
) => {
  if (game.shop !== "launchbox" || game.isDeleted) return false;
  if (target.kind === "retroarch")
    return platformToRetroArchPlatform(game.platform) !== null;
  return platformToSystem(game.platform) === target.system;
};
