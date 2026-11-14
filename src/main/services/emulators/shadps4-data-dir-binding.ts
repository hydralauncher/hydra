import type { EmulatorConfig } from "@types";

export const clearShadps4DataDirOnExecutableChange = (
  previous: EmulatorConfig | undefined,
  next: EmulatorConfig
): EmulatorConfig =>
  next.system === "ps4" && previous?.executablePath !== next.executablePath
    ? { ...next, shadps4DataDir: null }
    : next;
