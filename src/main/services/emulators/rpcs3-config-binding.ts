import type { EmulatorConfig } from "@types";

export const clearRpcs3RootOnExecutableChange = (
  previous: EmulatorConfig | undefined,
  next: EmulatorConfig
): EmulatorConfig =>
  next.system === "ps3" && previous?.executablePath !== next.executablePath
    ? { ...next, rpcs3ConfigRoot: null }
    : next;
