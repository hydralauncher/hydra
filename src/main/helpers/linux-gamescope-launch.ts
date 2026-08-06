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
  const commandDelimiter = tokens.indexOf("--");
  const wrapperEnd = commandDelimiter < 0 ? tokens.length : commandDelimiter;
  let gamescopeIndex = tokens.findIndex(
    (token, index) =>
      index < wrapperEnd && path.basename(token).toLowerCase() === "gamescope"
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

  const updatedDelimiter = tokens.indexOf("--");
  const gamescopeArgsEnd =
    updatedDelimiter < 0 ? tokens.length : updatedDelimiter;
  if (
    !tokens.slice(gamescopeIndex + 1, gamescopeArgsEnd).includes("--mangoapp")
  ) {
    tokens.splice(gamescopeIndex + 1, 0, "--mangoapp");
  }

  return {
    command: tokens[0],
    args: tokens.slice(1),
    env: resolved.env,
  };
};
