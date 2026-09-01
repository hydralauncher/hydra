export interface EmulatorVersionProbe {
  versionFlags: string[];
  versionProbeDisabledPlatforms?: NodeJS.Platform[];
}

export const isEmulatorVersionProbeEnabled = (
  binary: EmulatorVersionProbe,
  platform: NodeJS.Platform = process.platform
): boolean =>
  binary.versionFlags.length > 0 &&
  !binary.versionProbeDisabledPlatforms?.includes(platform);
