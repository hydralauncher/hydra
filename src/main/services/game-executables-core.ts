import type { KnownGameExecutable } from "@main/helpers/game-executable-ranking";

interface ExecutableInfo {
  name: string;
  os: string;
}

export type GameExecutableCatalogResponse = Record<string, ExecutableInfo[]>;
export type GameExecutableCatalog = Record<string, KnownGameExecutable[]>;

const DEFAULT_RETRY_DELAY_MS = 30_000;

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

export class GameExecutableCatalogStore {
  private catalog: GameExecutableCatalog = {};
  private loadPromise: Promise<boolean> | null = null;
  private retryAfter = 0;

  constructor(
    private readonly platform: NodeJS.Platform,
    private readonly retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    private readonly now = () => Date.now()
  ) {}

  async ensureLoaded(
    load: () => Promise<GameExecutableCatalogResponse>,
    forceRetry = false
  ): Promise<boolean> {
    if (Object.keys(this.catalog).length > 0) return true;
    if (this.loadPromise) return this.loadPromise;
    if (!forceRetry && this.now() < this.retryAfter) return false;

    this.loadPromise = load()
      .then((response) => {
        const catalog = normalizeGameExecutableCatalog(response, this.platform);

        if (Object.keys(catalog).length === 0) {
          this.retryAfter = this.now() + this.retryDelayMs;
          return false;
        }

        this.catalog = catalog;
        this.retryAfter = 0;
        return true;
      })
      .catch(() => {
        this.retryAfter = this.now() + this.retryDelayMs;
        return false;
      })
      .finally(() => {
        this.loadPromise = null;
      });

    return this.loadPromise;
  }

  getForGame(objectId: string): KnownGameExecutable[] | null {
    const executables = this.catalog[objectId];
    return executables?.length ? executables : null;
  }

  getAllObjectIds(): string[] {
    return Object.keys(this.catalog);
  }
}
