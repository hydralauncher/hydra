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
  MacWineEnvironmentRepairer,
} from "./environment";

export class MacCompatibilityManager {
  private readonly systemDetector: MacSystemDetector;
  private readonly wineDetector: MacWineDetector;
  private readonly registry: MacCompatibilityRegistry;
  private readonly environmentManager: MacWineEnvironmentManager;
  private readonly environmentRepairer: MacWineEnvironmentRepairer;

  constructor() {
    this.systemDetector = new MacSystemDetector();
    this.wineDetector = new MacWineDetector();
    this.registry = new MacCompatibilityRegistry();
    this.environmentManager = new MacWineEnvironmentManager();
    this.environmentRepairer = new MacWineEnvironmentRepairer();
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
    return this.environmentManager.getEnvironment(game);
  }

  async checkGame(
    game: MacCompatibilityGameKey,
    title: string,
    isWindowsGame: boolean,
  ): Promise<MacGameCompatibility> {
    const systemInfo = await this.getSystemInfo();
    const wineVersions = await this.getWineVersions();

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

    const recommendedWine =
      wineVersions.find((wine) => wine.isRecommended) ?? wineVersions[0];

    if (!recommendedWine) {
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
    } else if (!environment) {
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
        title: "Environment needs repair",
        description:
          "The Wine environment exists but is not currently healthy.",
        severity: "error",
        fixable: true,
        action: "repair",
      });

      recommendations.push({
        id: "repair-environment",
        title: "Repair the Wine environment",
        description:
          "Reinitialize the game's compatibility environment and test it again.",
        action: "repair",
        priority: "high",
      });
    }

    let status: MacGameCompatibility["status"] = "needs_setup";
    let level: MacGameCompatibility["level"] = "poor";
    let score = 25;

    if (environment?.healthy) {
      status = "ready";
      level = "good";
      score = 85;
    } else if (recommendedWine) {
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
      isWindowsGame: true,
      requiresWine: true,
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

  async createGameEnvironment(
    game: MacCompatibilityGameKey,
  ): Promise<MacWineEnvironment> {
    const wineVersions = await this.getWineVersions();

    const wineVersion =
      wineVersions.find((wine) => wine.isRecommended) ?? wineVersions[0];

    if (!wineVersion) {
      throw new Error("No compatible Wine version is installed.");
    }

    const environment = await this.environmentManager.createEnvironment(
      game,
      wineVersion,
    );

    this.registry.setEnvironment(game, environment);
    this.registry.setWineVersion(game, wineVersion.id);
    this.registry.setStatus(game, "ready");

    return environment;
  }

  async testGameEnvironment(
    game: MacCompatibilityGameKey,
  ): Promise<boolean> {
    const environment = await this.getGameEnvironment(game);

    if (!environment) {
      this.registry.setStatus(game, "needs_setup");
      return false;
    }

    const wineVersions = await this.getWineVersions();

    const wineVersion = wineVersions.find(
      (wine) => wine.id === environment.wineVersionId,
    );

    if (!wineVersion) {
      this.registry.setStatus(game, "needs_repair");
      return false;
    }

    const healthy = await this.environmentManager.testEnvironment(
      environment,
      wineVersion,
    );

    this.registry.setStatus(
      game,
      healthy ? "ready" : "needs_repair",
    );

    return healthy;
  }

  async repairGameEnvironment(
    game: MacCompatibilityGameKey,
  ): Promise<MacWineEnvironment> {
    const environment = await this.getGameEnvironment(game);

    if (!environment) {
      throw new Error("No Wine environment exists for this game.");
    }

    const wineVersions = await this.getWineVersions();

    const wineVersion = wineVersions.find(
      (wine) => wine.id === environment.wineVersionId,
    );

    if (!wineVersion) {
      throw new Error(
        "The Wine version used by this environment is no longer installed.",
      );
    }

    const result = await this.environmentRepairer.repair(
      environment,
      wineVersion.executablePath,
    );

    if (!result.success) {
      this.registry.setStatus(game, "needs_repair");
      throw new Error(result.message);
    }

    this.registry.setEnvironment(game, result.environment);
    this.registry.setWineVersion(game, wineVersion.id);
    this.registry.setStatus(game, "ready");

    return result.environment;
  }

  async deleteGameEnvironment(
    game: MacCompatibilityGameKey,
  ): Promise<boolean> {
    const deleted = await this.environmentManager.deleteEnvironment(game);

    if (deleted) {
      this.registry.setEnvironment(game, null);
      this.registry.setStatus(game, "needs_setup");
    }

    return deleted;
  }

  getRegistry(): MacCompatibilityRegistry {
    return this.registry;
  }

  getEnvironmentManager(): MacWineEnvironmentManager {
    return this.environmentManager;
  }

  getEnvironmentRepairer(): MacWineEnvironmentRepairer {
    return this.environmentRepairer;
  }
}
