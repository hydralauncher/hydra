import type {
  MacCompatibilityCheckResult,
  MacCompatibilityGameKey,
  MacGameCompatibility,
  MacSystemInfo,
  MacWineEnvironment,
  MacWineVersion,
} from "./MacCompatibilityTypes";
import { MacCompatibilityRegistry } from "./MacCompatibilityRegistry";
import { MacSystemDetector } from "./MacSystemDetector";
import { MacWineDetector } from "./MacWineDetector";
import {
  MacWineEnvironmentManager,
  MacWineEnvironmentRegistry,
} from "./environment";
export class MacCompatibilityManager {
  private readonly systemDetector: MacSystemDetector;
  private readonly wineDetector: MacWineDetector;
  private readonly registry: MacCompatibilityRegistry;
  private readonly environmentRegistry: MacWineEnvironmentRegistry;
  private readonly environmentManager: MacWineEnvironmentManager;
  constructor() {
    this.systemDetector = new MacSystemDetector();
    this.wineDetector = new MacWineDetector();
    this.registry = new MacCompatibilityRegistry();
    this.environmentRegistry = new MacWineEnvironmentRegistry();
    this.environmentManager = new MacWineEnvironmentManager(
      this.environmentRegistry,
    );
  }
  async getSystemInfo(): Promise<MacSystemInfo> {
    return this.systemDetector.detect();
  }
  async getWineVersions(): Promise<MacWineVersion[]> {
    return this.wineDetector.detectInstalledVersions();
  }
  async isWineAvailable(): Promise<boolean> {
    return this.wineDetector.isWineAvailable();
  }
  async getGameEnvironment(
    game: MacCompatibilityGameKey,
  ): Promise<MacWineEnvironment | null> {
    return (
      this.registry.getEnvironment(game) ??
      this.environmentRegistry.get(game)
    );
  }
  async checkGame(
    game: MacCompatibilityGameKey,
    title: string,
    isWindowsGame: boolean,
  ): Promise<MacGameCompatibility> {
    const systemInfo = await this.getSystemInfo();
    const wineVersions = await this.getWineVersions();
    const requiresWine = isWindowsGame;
    const wineAvailable = wineVersions.length > 0;
    const issues: MacGameCompatibility["issues"] = [];
    const recommendations: MacGameCompatibility["recommendations"] = [];
    if (!isWindowsGame) {
      const result: MacGameCompatibility = {
        shop: game.shop,
        objectId: game.objectId,
        title,
        status: "ready",
        level: "native",
        score: 100,
        isWindowsGame: false,
        requiresWine: false,
        requiresRosetta: false,
        recommendedWineVersionId: null,
        recommendedWineVersionName: null,
        environment: null,
        issues,
        recommendations,
      };
      this.registry.setStatus(game, result.status);
      return result;
    }
    const environment = await this.getGameEnvironment(game);
    if (!wineAvailable) {
      issues.push({
        id: "wine-not-installed",
        code: "WINE_NOT_INSTALLED",
        title: "Wine is not installed",
        description:
          "A Windows compatibility environment is required to run this game on macOS.",
        severity: "error",
        fixable: true,
        action: "create-environment",
      });
      recommendations.push({
        id: "install-wine",
        title: "Set up a Wine environment",
        description:
          "Install or configure a compatible Wine version before launching this game.",
        action: "create-environment",
        priority: "high",
      });
    }
    if (wineAvailable && !environment) {
      recommendations.push({
        id: "create-game-environment",
        title: "Create a game environment",
        description:
          "Create a dedicated Wine environment for this game.",
        action: "create-environment",
        priority: "high",
      });
    }
    if (environment && !environment.healthy) {
      issues.push({
        id: "environment-unhealthy",
        code: "ENVIRONMENT_UNHEALTHY",
        title: "Game environment needs repair",
        description:
          "The compatibility environment exists but is not currently healthy.",
        severity: "error",
        fixable: true,
        action: "repair",
      });
    }
    const recommendedWine =
      wineVersions.find((wine) => wine.isRecommended) ?? wineVersions[0];
    let status: MacGameCompatibility["status"] = "needs_setup";
    let level: MacGameCompatibility["level"] = "poor";
    let score = 25;
    if (environment?.healthy) {
      status = "ready";
      level = "good";
      score = 85;
    } else if (wineAvailable) {
      status = "needs_setup";
      level = "good";
      score = 70;
    }
    const result: MacGameCompatibility = {
      shop: game.shop,
      objectId: game.objectId,
      title,
      status,
      level,
      score,
      isWindowsGame,
      requiresWine,
      requiresRosetta: systemInfo.isAppleSilicon,
      recommendedWineVersionId: recommendedWine?.id ?? null,
      recommendedWineVersionName: recommendedWine?.name ?? null,
      environment,
      issues,
      recommendations,
    };
    this.registry.setStatus(game, result.status);
    if (recommendedWine) {
      this.registry.setWineVersion(game, recommendedWine.id);
    }
    return result;
  }
  async checkGameStatus(
    game: MacCompatibilityGameKey,
    title: string,
    isWindowsGame: boolean,
  ): Promise<MacCompatibilityCheckResult> {
    const result = await this.checkGame(game, title, isWindowsGame);
    return {
      status: result.status,
      issues: result.issues,
      recommendations: result.recommendations,
      checkedAt: new Date().toISOString(),
    };
  }
  async setGameEnvironment(
    game: MacCompatibilityGameKey,
    environment: MacWineEnvironment | null,
  ): Promise<void> {
    this.registry.setEnvironment(game, environment);
    if (environment) {
      this.environmentRegistry.set(game, environment);
    } else {
      this.environmentRegistry.delete(game);
    }
  }
  async setWineVersion(
    game: MacCompatibilityGameKey,
    wineVersionId: string | null,
  ): Promise<void> {
    this.registry.setWineVersion(game, wineVersionId);
  }
  getRegistry(): MacCompatibilityRegistry {
    return this.registry;
  }
  getEnvironmentManager(): MacWineEnvironmentManager {
    return this.environmentManager;
  }
}
