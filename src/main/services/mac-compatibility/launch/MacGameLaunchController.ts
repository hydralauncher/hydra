import type {
  MacCompatibilityGameKey,
  MacGameCompatibility,
} from "../MacCompatibilityTypes";
import {
  MacGameLaunchManager,
  type MacGameLaunchRequest,
  type MacGameLaunchResult,
} from "./MacGameLaunchManager";

export class MacGameLaunchController {
  private readonly launchManager: MacGameLaunchManager;

  constructor(launchManager?: MacGameLaunchManager) {
    this.launchManager = launchManager ?? new MacGameLaunchManager();
  }

  async checkLaunchCompatibility(
    request: MacGameLaunchRequest,
  ): Promise<MacGameCompatibility> {
    const result = await this.launchManager.prepareLaunch(request);

    return result.compatibility;
  }

  async canLaunch(
    request: MacGameLaunchRequest,
  ): Promise<boolean> {
    const result = await this.launchManager.prepareLaunch(request);

    return result.success;
  }

  async launch(
    request: MacGameLaunchRequest,
  ): Promise<MacGameLaunchResult> {
    return this.launchManager.launch(request);
  }

  async launchWindowsGame(
    game: MacCompatibilityGameKey,
    title: string,
    executablePath: string,
    args: string[] = [],
  ): Promise<MacGameLaunchResult> {
    return this.launch({
      game,
      title,
      executablePath,
      isWindowsGame: true,
      args,
    });
  }

  async launchNativeGame(
    game: MacCompatibilityGameKey,
    title: string,
    executablePath: string,
    args: string[] = [],
  ): Promise<MacGameLaunchResult> {
    return this.launch({
      game,
      title,
      executablePath,
      isWindowsGame: false,
      args,
    });
  }
}
