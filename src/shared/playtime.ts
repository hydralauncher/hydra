export type PlayTimeParts = {
  playTimeInMilliseconds?: number | null;
  steamPlayTimeInMilliseconds?: number | null;
  epicPlayTimeInMilliseconds?: number | null;
};

export type RemotePlayTimeInput = {
  hasActiveEpicImport?: boolean;
  playTimeInMilliseconds?: number | null;
  playTimeInSeconds?: number | null;
  runtime?: number | null;
  runtimeByPlatform?: {
    hydra?: number | null;
    steam?: number | null;
    epic?: number | null;
  } | null;
};

const toMilliseconds = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return 0;
  return seconds * 1000;
};

export const getDisplayedPlayTimeInMilliseconds = (
  game: PlayTimeParts
): number =>
  Math.max(0, game.playTimeInMilliseconds ?? 0) +
  Math.max(0, game.steamPlayTimeInMilliseconds ?? 0) +
  Math.max(0, game.epicPlayTimeInMilliseconds ?? 0);

export const getPlayTimeHoursAndMinutes = (milliseconds: number) => {
  const totalMinutes = Math.floor(Math.max(0, milliseconds) / 60_000);
  return {
    hours: Math.floor(totalMinutes / 60),
    minutes: totalMinutes % 60,
  };
};

export const getRemotePlayTimeParts = (
  remote: RemotePlayTimeInput
): { hydraMs: number; steamMs: number; epicMs: number } => {
  const hydraSeconds = remote.runtimeByPlatform?.hydra;
  const steamSeconds = remote.runtimeByPlatform?.steam;
  const epicSeconds = remote.runtimeByPlatform?.epic;
  const combinedSeconds =
    remote.runtime ??
    remote.playTimeInSeconds ??
    (typeof remote.playTimeInMilliseconds === "number"
      ? remote.playTimeInMilliseconds / 1000
      : 0);

  if (
    typeof hydraSeconds === "number" ||
    typeof steamSeconds === "number" ||
    typeof epicSeconds === "number"
  ) {
    return {
      hydraMs:
        typeof hydraSeconds === "number"
          ? toMilliseconds(hydraSeconds)
          : Math.max(
              0,
              toMilliseconds(combinedSeconds) -
                toMilliseconds(steamSeconds ?? 0) -
                toMilliseconds(epicSeconds ?? 0)
            ),
      steamMs: toMilliseconds(steamSeconds ?? 0),
      epicMs: toMilliseconds(epicSeconds ?? 0),
    };
  }

  const seconds =
    remote.runtime ??
    remote.playTimeInSeconds ??
    (typeof remote.playTimeInMilliseconds === "number"
      ? remote.playTimeInMilliseconds / 1000
      : 0);

  return {
    hydraMs: toMilliseconds(seconds),
    steamMs: 0,
    epicMs: 0,
  };
};

export const mergeLocalAndRemotePlayTime = (
  local: PlayTimeParts,
  remote: RemotePlayTimeInput
): {
  playTimeInMilliseconds: number;
  steamPlayTimeInMilliseconds: number;
  epicPlayTimeInMilliseconds: number;
} => {
  // An older API lacks Epic fields entirely; absence is not a zero snapshot.
  const supportsEpic =
    typeof remote.runtimeByPlatform?.epic === "number" ||
    typeof remote.hasActiveEpicImport === "boolean";
  const compatibleRemote =
    !supportsEpic && local.epicPlayTimeInMilliseconds
      ? {
          ...remote,
          runtimeByPlatform: {
            ...remote.runtimeByPlatform,
            epic: local.epicPlayTimeInMilliseconds / 1000,
          },
        }
      : remote;
  const { hydraMs, steamMs, epicMs } = getRemotePlayTimeParts(compatibleRemote);

  return {
    playTimeInMilliseconds: Math.max(
      local.playTimeInMilliseconds ?? 0,
      hydraMs
    ),
    steamPlayTimeInMilliseconds: steamMs,
    epicPlayTimeInMilliseconds: epicMs,
  };
};
