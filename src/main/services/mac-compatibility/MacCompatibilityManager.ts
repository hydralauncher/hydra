import type {
  MacCompatibilityCheckResult,
  MacCompatibilityGameKey,
  MacGameCompatibility,
  MacSystemInfo,
  MacWineVersion,
} from "./MacCompatibilityTypes";
import { MacSystemDetector } from "./MacSystemDetector";
import { MacWineDetector } from "./MacWineDetector";

export class MacCompatibilityManager {
  private readonly systemDetector: MacSystemDetector;
  private readonly wineDetector: MacWineDetector;

  constructor() {
    this.systemDetector = new MacSystemDetector();
    this.wineDetector = new MacWineDetector();
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

    const issues = [];
    const recommendations = [];

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

    if (!wineAvailable) {
      issues.push({
        id: "wine-not-installed",
        code: "WINE_NOT_INSTALLED",
        title: "Wine is not installed",
        description:
          "A Windows compatibility environment is required to run this game on macOS.",
        severity: "error" as const,
        fixable: true,
        action: "create-environment" as const,
      });

      recommendations.push({
        id: "install-wine",
        title: "Set up a Wine environment",
        description:
          "Install or configure a compatible Wine version before launching this game.",
        action: "create-environment" as const,
        priority: "high" as const,
      });
    }

    const recommendedWine =
      wineVersions.find((wine) => wine.isRecommended) ?? wineVersions[0];

    const status = wineAvailable ? "needs_setup" : "needs_setup";
    const level = wineAvailable ? "good" : "poor";
    const score = wineAvailable ? 70 : 25;

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
      environment: null,
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
}
