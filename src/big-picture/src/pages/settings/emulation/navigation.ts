import type { EmulatorSystem } from "@types";
import { DISC_CLOUD_SAVE_EMULATOR_SYSTEMS } from "../../../../../shared/cloud-save-emulator-provider.js";

export const isRetroArchEmulationDeepLink = (search: string): boolean => {
  const params = new URLSearchParams(search);
  return (
    params.get("tab") === "emulation" && params.get("system") === "retroarch"
  );
};

export const getEmulatorDetailDeepLinkSystem = (
  search: string
): EmulatorSystem | null => {
  const params = new URLSearchParams(search);
  if (params.get("tab") !== "emulation") return null;
  const system = params.get("system");
  return (
    DISC_CLOUD_SAVE_EMULATOR_SYSTEMS.find(
      (candidate) => candidate === system
    ) ?? null
  );
};
