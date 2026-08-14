import type {
  MacCompatibilityGameKey,
  MacGameCompatibility,
  MacWineEnvironment,
} from "./MacCompatibilityTypes";
import { MacCompatibilityManager } from "./MacCompatibilityManager";
import { MacCompatibilityRegistry } from "./MacCompatibilityRegistry";

export class MacGameManager {
  private readonly compatibilityManager: MacCompatibilityManager;
  private readonly registry: MacCompatibilityRegistry;

  constructor(
    compatibilityManager?: MacCompatibilityManager,
    registry?: MacCompatibilityRegistry,
  ) {
    this.compatibilityManager =
      compatibilityManager ?? new MacCompatibilityManager();

    this.registry = registry ?? new MacCompatibilityRegistry();
  }

  async checkGame(
    game: MacCompatibilityGameKey,
    title: string,
    isWindowsGame: boolean,
  ): Promise<MacGameCompatibility> {
    const compatibility = await this.compatibilityManager.checkGame(
      game,
      title,
      isWindowsGame,
    );

    const existingEnvironment = this.registry.getEnvironment(game);

    if (existingEnvironment) {
      return {
        ...compatibility,
        environment: existingEnvironment,
      };
    }

    this.registry.setStatus(game, compatibility.status);

    return compatibility;
  }

  getEnvironment(
    game: MacCompatibilityGameKey,
  ): MacWineEnvironment | null {
    return this.registry.getEnvironment(game);
  }

  setEnvironment(
    game: MacCompatibilityGameKey,
    environment: MacWineEnvironment | null,
  ): void {
    this.registry.setEnvironment(game, environment);
  }

  setWineVersion(
    game: MacCompatibilityGameKey,
    wineVersionId: string | null,
  ): void {
    this.registry.setWineVersion(game, wineVersionId);
  }

  getSelectedWineVersionId(
    game: MacCompatibilityGameKey,
  ): string | null {
    return this.registry.get(game)?.selectedWineVersionId ?? null;
  }

  getStatus(
    game: MacCompatibilityGameKey,
  ): MacGameCompatibility["status"] {
    return this.registry.get(game)?.lastStatus ?? "unknown";
  }

  removeGame(game: MacCompatibilityGameKey): boolean {
    return this.registry.delete(game);
  }

  hasGame(game: MacCompatibilityGameKey): boolean {
    return this.registry.has(game);
  }
}
