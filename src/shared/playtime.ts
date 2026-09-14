export type PlayTimeParts = {
  playTimeInMilliseconds?: number | null;
  steamPlayTimeInMilliseconds?: number | null;
};

export type RemotePlayTimeInput = {
  playTimeInMilliseconds?: number | null;
  playTimeInSeconds?: number | null;
  runtime?: number | null;
  runtimeByPlatform?: { hydra?: number | null; steam?: number | null } | null;
};

const toMilliseconds = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return 0;
  return seconds * 1000;
};

export const getDisplayedPlayTimeInMilliseconds = (
  game: PlayTimeParts
): number =>
  Math.max(0, game.playTimeInMilliseconds ?? 0) +
  Math.max(0, game.steamPlayTimeInMilliseconds ?? 0);

export const getRemotePlayTimeParts = (
  remote: RemotePlayTimeInput
): { hydraMs: number; steamMs: number } => {
  const hydraSeconds = remote.runtimeByPlatform?.hydra;
  const steamSeconds = remote.runtimeByPlatform?.steam;

  if (typeof hydraSeconds === "number" || typeof steamSeconds === "number") {
    return {
      hydraMs: toMilliseconds(hydraSeconds ?? 0),
      steamMs: toMilliseconds(steamSeconds ?? 0),
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
  };
};

export const mergeLocalAndRemotePlayTime = (
  local: PlayTimeParts,
  remote: RemotePlayTimeInput
): { playTimeInMilliseconds: number; steamPlayTimeInMilliseconds: number } => {
  const { hydraMs, steamMs } = getRemotePlayTimeParts(remote);

  return {
    playTimeInMilliseconds: Math.max(
      local.playTimeInMilliseconds ?? 0,
      hydraMs
    ),
    steamPlayTimeInMilliseconds: steamMs,
  };
};
