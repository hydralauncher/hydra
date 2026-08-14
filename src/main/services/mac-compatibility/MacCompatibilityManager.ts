import type {
  MacCompatibilityCheckResult,
  MacCompatibilityGameKey,
  MacGameCompatibility,
  MacSystemInfo,
  MacWineEnvironment,
  MacWineVersion,
} from "./MacCompatibilityTypes";
import { MacSystemDetector } from "./MacSystemDetector";
import { MacWineDetector } from "./MacWineDetector";
import { MacWineEnvironmentManager } from "./environment/MacWineEnvironmentManager";

export class MacCompatibilityManager {
  private readonly systemDetector: MacSystemDetector;
  private readonly wineDetector: MacWineDetector;
  private readonly environmentManager: MacWineEnvironmentManager;

  constructor() {
    this.systemDetector = new MacSystemDetector();
    this.wineDetector = new MacWineDetector();
    this.environmentManager = new MacWineEnvironmentManager();
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
      return {
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
    }

    const environment = this.environmentManager.getEnvironment(game);

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
    } else if (!environment) {
      issues.push({
        id: "environment-not-created",
        code: "ENVIRONMENT_NOT_CREATED",
        title: "Game environment has not been created",
        description:
          "This game does not have a dedicated Wine environment yet.",
        severity: "warning",
        fixable: true,
        action: "create-environment",
      });

      recommendations.push({
        id: "create-environment",
        title: "Create game environment",
        description:
          "Create a dedicated Wine environment for this game.",
        action: "create-environment",
        priority: "high",
      });
    }

    const recommendedWine =
      wineVersions.find((wine) => wine.isRecommended) ?? wineVersions[0];

    let status: MacGameCompatibility["status"] = "needs_setup";
    let level: MacGameCompatibility["level"] = "good";
    let score: number | null = 70;

    if (!wineAvailable) {
      level = "poor";
      score = 25;
    } else if (environment?.healthy) {
      status = "ready";
      level = "good";
      score = 85;
    }

    return {
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

  async getGameEnvironment(
    game: MacCompatibilityGameKey,
  ): Promise<MacWineEnvironment | null> {
    return this.environmentManager.getEnvironment(game);
  }
}
