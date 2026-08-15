import { spawn } from "node:child_process";
import path from "node:path";
import type {
  MacCompatibilityGameKey,
  MacGameCompatibility,
  MacWineEnvironment,
  MacWineVersion,
} from "../MacCompatibilityTypes";
import { MacCompatibilityManager } from "../MacCompatibilityManager";

export interface MacGameLaunchRequest {
  game: MacCompatibilityGameKey;
  title: string;
  executablePath: string;
  isWindowsGame: boolean;
  args?: string[];
}

export interface MacGameLaunchResult {
  success: boolean;
  pid: number | null;
  compatibility: MacGameCompatibility;
  environment: MacWineEnvironment | null;
  wineVersion: MacWineVersion | null;
  message: string;
}

export class MacGameLaunchManager {
  private readonly compatibilityManager: MacCompatibilityManager;

  constructor(compatibilityManager?: MacCompatibilityManager) {
    this.compatibilityManager =
      compatibilityManager ?? new MacCompatibilityManager();
  }

  async prepareLaunch(
    request: MacGameLaunchRequest,
  ): Promise<MacGameLaunchResult> {
    const compatibility = await this.compatibilityManager.checkGame(
      request.game,
      request.title,
      request.isWindowsGame,
    );

    if (!request.isWindowsGame) {
      return {
        success: true,
        pid: null,
        compatibility,
        environment: null,
        wineVersion: null,
        message: "Native macOS game. No compatibility environment required.",
      };
    }

    let environment =
      await this.compatibilityManager.getGameEnvironment(request.game);

    let wineVersions =
      await this.compatibilityManager.getWineVersions();

    let wineVersion = this.findWineVersion(
      environment?.wineVersionId ??
        compatibility.recommendedWineVersionId,
      wineVersions,
    );

    if (!wineVersion) {
      return {
        success: false,
        pid: null,
        compatibility,
        environment,
        wineVersion: null,
        message:
          "No compatible Wine version is installed. Install Wine before launching this game.",
      };
    }

    if (!environment) {
      try {
        environment =
          await this.compatibilityManager.createGameEnvironment(
            request.game,
          );

        wineVersions =
          await this.compatibilityManager.getWineVersions();

        wineVersion = this.findWineVersion(
          environment.wineVersionId,
          wineVersions,
        );
      } catch (error) {
        return {
          success: false,
          pid: null,
          compatibility,
          environment: null,
          wineVersion,
          message: this.getErrorMessage(
            error,
            "Failed to create the game's compatibility environment.",
          ),
        };
      }
    }

    if (!wineVersion) {
      return {
        success: false,
        pid: null,
        compatibility,
        environment,
        wineVersion: null,
        message:
          "The game's selected Wine version is no longer available.",
      };
    }

    // The stored healthy flag is a memory of the last check, not a fact
    // about right now: the prefix may have been deleted, moved, or left
    // half-written since then, and Wine may have been upgraded or
    // uninstalled. Trusting it here is what let a game be launched into
    // a broken prefix and fail with no explanation, so the environment
    // is always tested for real immediately before launch.
    const healthy = await this.compatibilityManager.testGameEnvironment(
      request.game,
    );

    // The test writes the corrected flags, so re-read the environment to
    // report the true state back to the caller.
    environment =
      (await this.compatibilityManager.getGameEnvironment(request.game)) ??
      environment;

    if (!healthy) {
      try {
        // repairGameEnvironment() re-tests after repairing and throws if
        // the environment is still not usable, so reaching the next line
        // means the prefix really works.
        environment =
          await this.compatibilityManager.repairGameEnvironment(
            request.game,
          );
      } catch (error) {
        return {
          success: false,
          pid: null,
          compatibility,
          environment,
          wineVersion,
          message: this.getErrorMessage(
            error,
            "The game's compatibility environment needs repair.",
          ),
        };
      }
    }

    return {
      success: true,
      pid: null,
      compatibility,
      environment,
      wineVersion,
      message: "Compatibility environment is ready for launch.",
    };
  }

  async launch(
    request: MacGameLaunchRequest,
  ): Promise<MacGameLaunchResult> {
    const prepared = await this.prepareLaunch(request);

    if (!prepared.success) {
      return prepared;
    }

    if (!request.isWindowsGame) {
      return this.launchNative(request, prepared);
    }

    if (!prepared.environment || !prepared.wineVersion) {
      return {
        ...prepared,
        success: false,
        message:
          "The Windows game's Wine environment is not available.",
      };
    }

    return this.launchWithWine(
      request,
      prepared,
      prepared.environment,
      prepared.wineVersion,
    );
  }

  private async launchNative(
    request: MacGameLaunchRequest,
    prepared: MacGameLaunchResult,
  ): Promise<MacGameLaunchResult> {
    try {
      const workingDirectory = path.dirname(request.executablePath);

      const child = spawn(
        request.executablePath,
        request.args ?? [],
        {
          shell: false,
          detached: true,
          stdio: "ignore",
          cwd: workingDirectory,
          env: {
            ...process.env,
          },
        },
      );

      return await new Promise<MacGameLaunchResult>((resolve) => {
        const onSpawn = () => {
          child.off("error", onError);
          child.unref();

          resolve({
            ...prepared,
            success: true,
            pid: child.pid ?? null,
            message: "Game launched natively.",
          });
        };

        const onError = (error: Error) => {
          child.off("spawn", onSpawn);

          resolve({
            ...prepared,
            success: false,
            pid: null,
            message: this.getErrorMessage(
              error,
              "Failed to launch the native macOS game.",
            ),
          });
        };

        child.once("spawn", onSpawn);
        child.once("error", onError);
      });
    } catch (error) {
      return {
        ...prepared,
        success: false,
        pid: null,
        message: this.getErrorMessage(
          error,
          "Failed to launch the native macOS game.",
        ),
      };
    }
  }

  private async launchWithWine(
    request: MacGameLaunchRequest,
    prepared: MacGameLaunchResult,
    environment: MacWineEnvironment,
    wineVersion: MacWineVersion,
  ): Promise<MacGameLaunchResult> {
    try {
      const workingDirectory = path.dirname(request.executablePath);

      const child = spawn(
        wineVersion.executablePath,
        [request.executablePath, ...(request.args ?? [])],
        {
          shell: false,
          detached: true,
          stdio: "ignore",
          cwd: workingDirectory,
          env: {
            ...process.env,
            WINEPREFIX: environment.prefixPath,
          },
        },
      );

      return await new Promise<MacGameLaunchResult>((resolve) => {
        const onSpawn = () => {
          child.off("error", onError);
          child.unref();

          resolve({
            ...prepared,
            success: true,
            pid: child.pid ?? null,
            message: `Game launched with ${wineVersion.name}.`,
          });
        };

        const onError = (error: Error) => {
          child.off("spawn", onSpawn);

          resolve({
            ...prepared,
            success: false,
            pid: null,
            message: this.getErrorMessage(
              error,
              "Failed to launch the Windows game with Wine.",
            ),
          });
        };

        child.once("spawn", onSpawn);
        child.once("error", onError);
      });
    } catch (error) {
      return {
        ...prepared,
        success: false,
        pid: null,
        message: this.getErrorMessage(
          error,
          "Failed to launch the Windows game with Wine.",
        ),
      };
    }
  }

  private findWineVersion(
    wineVersionId: string | null,
    wineVersions: MacWineVersion[],
  ): MacWineVersion | null {
    if (!wineVersionId) {
      return (
        wineVersions.find((wine) => wine.isRecommended) ??
        wineVersions[0] ??
        null
      );
    }

    return (
      wineVersions.find((wine) => wine.id === wineVersionId) ??
      null
    );
  }

  private getErrorMessage(
    error: unknown,
    fallback: string,
  ): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    return fallback;
  }
}
