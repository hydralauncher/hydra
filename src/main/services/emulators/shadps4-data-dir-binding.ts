import type { EmulatorConfig } from "@types";

/** A data folder picked for one shadPS4 build is not valid for another. */
export const clearShadps4DataDirOnExecutableChange = (
  previous: EmulatorConfig | undefined,
  next: EmulatorConfig
): EmulatorConfig =>
  next.system === "ps4" && previous?.executablePath !== next.executablePath
    ? { ...next, shadps4DataDir: null }
    : next;
