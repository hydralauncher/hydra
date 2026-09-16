import type { KnownGameExecutable } from "@main/helpers/game-executable-ranking";

interface ExecutableInfo {
  name: string;
  os: string;
}

export type GameExecutableCatalogResponse = Record<string, ExecutableInfo[]>;
export type GameExecutableCatalog = Record<string, KnownGameExecutable[]>;

export const normalizeGameExecutableCatalog = (
  catalog: GameExecutableCatalogResponse,
  platform: NodeJS.Platform
): GameExecutableCatalog =>
  Object.fromEntries(
    Object.entries(catalog).map(([objectId, executables]) => [
      objectId,
      executables
        .filter((executable) => {
          if (platform === "win32") return executable.os === "win32";
          if (platform === "linux") {
            return executable.os === "linux" || executable.os === "win32";
          }

          return false;
        })
        .map((executable) => {
          const lowered = executable.name.toLowerCase();
          const name = lowered.startsWith(">") ? lowered.slice(1) : lowered;

          return {
            name: platform === "win32" ? name.replaceAll("/", "\\") : name,
            exe: name.slice(name.lastIndexOf("/") + 1),
          };
        }),
    ])
  );
