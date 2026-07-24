import path from "node:path";

export interface ResolvedLinuxLaunchCommand {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export const normalizeGamescopeMangoHud = (
  resolved: ResolvedLinuxLaunchCommand,
  enabled: boolean,
  platform: NodeJS.Platform = process.platform
): ResolvedLinuxLaunchCommand => {
  if (platform !== "linux" || !enabled) return resolved;

  const tokens = [resolved.command, ...resolved.args];
  let gamescopeIndex = tokens.findIndex(
    (token) => path.basename(token).toLowerCase() === "gamescope"
  );
  if (gamescopeIndex < 0) return resolved;

  const mangohudIndex = tokens.findIndex(
    (token, index) =>
      index < gamescopeIndex &&
      path.basename(token).toLowerCase() === "mangohud"
  );
  if (mangohudIndex >= 0) {
    tokens.splice(mangohudIndex, 1);
    gamescopeIndex -= 1;
  }

  if (!tokens.includes("--mangoapp")) {
    tokens.splice(gamescopeIndex + 1, 0, "--mangoapp");
  }

  return {
    command: tokens[0],
    args: tokens.slice(1),
    env: resolved.env,
  };
};
