export interface EmulatorVersionProbe {
  versionFlags: string[];
  versionProbeDisabledPlatforms?: NodeJS.Platform[];
  readVersion?: (executablePath: string) => string | null;
}

export const isEmulatorVersionProbeEnabled = (
  binary: EmulatorVersionProbe
): boolean =>
  binary.versionFlags.length > 0 &&
  !binary.versionProbeDisabledPlatforms?.includes(process.platform);
