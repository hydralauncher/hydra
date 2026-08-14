import { access, mkdir, rm } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import type {
  MacCompatibilityGameKey,
  MacWineEnvironment,
  MacWineVersion,
} from "../MacCompatibilityTypes";
import { MacWineEnvironmentRegistry } from "./MacWineEnvironmentRegistry";
import { MacWineEnvironmentLogger } from "./MacWineEnvironmentLogger";
import {
  DEFAULT_MAC_ENVIRONMENTS_PATH,
  DEFAULT_MAC_ENVIRONMENTS_REGISTRY_PATH,
  assertManagedPrefixPath,
  createEnvironmentId,
  resolveManagedPrefixPath,
} from "./MacWineEnvironmentPaths";

const execFileAsync = promisify(execFile);

export class MacWineEnvironmentManager {
  private readonly registry: MacWineEnvironmentRegistry;
  private readonly environmentsPath: string;

  constructor(
    registryPath = DEFAULT_MAC_ENVIRONMENTS_REGISTRY_PATH,
    environmentsPath = DEFAULT_MAC_ENVIRONMENTS_PATH,
  ) {
    this.registry = new MacWineEnvironmentRegistry(registryPath);
    this.environmentsPath = environmentsPath;
  }

  /**
   * The folder this game owns, derived from the game identity rather
   * than read from environments.json. Two different games can never
   * resolve to the same folder.
   */
  getPrefixPathForGame(game: MacCompatibilityGameKey): string {
    return resolveManagedPrefixPath(this.environmentsPath, game);
  }

  async getEnvironment(
    game: MacCompatibilityGameKey,
  ): Promise<MacWineEnvironment | null> {
    return this.registry.get(game);
  }

  async createEnvironment(
    game: MacCompatibilityGameKey,
    wineVersion: MacWineVersion,
  ): Promise<MacWineEnvironment> {
    const environmentId = this.createEnvironmentId(game);
    const prefixPath = this.getPrefixPathForGame(game);

    await mkdir(prefixPath, {
      recursive: true,
    });

    await MacWineEnvironmentLogger.info(
      prefixPath,
      `Creating environment with ${wineVersion.name}.`,
      wineVersion.executablePath,
    );

    await this.initializePrefix(prefixPath, wineVersion);

    const environment: MacWineEnvironment = {
      id: environmentId,
      prefixPath,
      wineVersionId: wineVersion.id,
      wineVersionName: wineVersion.name,
      architecture:
        wineVersion.architecture === "universal"
          ? "unknown"
          : wineVersion.architecture,
      exists: true,
      initialized: true,
      healthy: true,
      // "wine-prefix" marks that wineboot --init has completed for this
      // environment — the first and, for now, only tracked component.
      // Future dependency installs (VC++ Redist, .NET, etc.) append here
      // via recordInstalledComponent() rather than being written inline,
      // so every install path shares one consistent record-keeping spot.
      installedComponents: ["wine-prefix"],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.registry.set(game, environment);

    await MacWineEnvironmentLogger.info(
      prefixPath,
      "Environment created successfully.",
    );

    return environment;
  }

  async ensureEnvironment(
    game: MacCompatibilityGameKey,
    wineVersion: MacWineVersion,
  ): Promise<MacWineEnvironment> {
    const existing = await this.getEnvironment(game);

    if (existing?.exists && existing.initialized) {
      return existing;
    }

    return this.createEnvironment(game, wineVersion);
  }

  async testEnvironment(
    environment: MacWineEnvironment,
    wineVersion: MacWineVersion,
  ): Promise<boolean> {
    try {
      await access(environment.prefixPath);

      await execFileAsync(
        wineVersion.executablePath,
        ["--version"],
        {
          env: {
            ...process.env,
            WINEPREFIX: environment.prefixPath,
          },
        },
      );

      return true;
    } catch (error) {
      await MacWineEnvironmentLogger.warning(
        environment.prefixPath,
        "Environment test failed.",
        error instanceof Error ? error.message : String(error),
      );

      return false;
    }
  }

  /**
   * Appends a component id to this environment's installedComponents
   * list (e.g. a Visual C++ Redistributable or .NET version once that
   * dependency-installation work exists) and logs it. Idempotent: adding
   * the same component id twice is a no-op rather than a duplicate.
   */
  async recordInstalledComponent(
    game: MacCompatibilityGameKey,
    componentId: string,
  ): Promise<MacWineEnvironment | null> {
    const environment = await this.getEnvironment(game);

    if (!environment) {
      return null;
    }

    if (environment.installedComponents.includes(componentId)) {
      return environment;
    }

    const updated: MacWineEnvironment = {
      ...environment,
      installedComponents: [
        ...environment.installedComponents,
        componentId,
      ],
      updatedAt: new Date().toISOString(),
    };

    await this.registry.set(game, updated);

    await MacWineEnvironmentLogger.info(
      environment.prefixPath,
      `Component installed: ${componentId}`,
    );

    return updated;
  }

  /**
   * Deletes one game's Wine environment folder.
   *
   * The path stored in environments.json is never trusted on its own:
   * it is validated against the environments root immediately before
   * rm() runs, and an unsafe value throws instead of deleting anything.
   * When no path is stored, the folder is derived from the game key.
   */
  async deleteEnvironment(
    game: MacCompatibilityGameKey,
  ): Promise<boolean> {
    const environment = await this.getEnvironment(game);

    if (!environment) {
      return false;
    }

    const candidatePrefixPath =
      typeof environment.prefixPath === "string" &&
      environment.prefixPath.trim() !== ""
        ? environment.prefixPath
        : this.getPrefixPathForGame(game);

    const safePrefixPath = await assertManagedPrefixPath(
      this.environmentsPath,
      candidatePrefixPath,
    );

    await rm(safePrefixPath, {
      recursive: true,
      force: true,
    });

    return this.registry.delete(game);
  }

  async getAllEnvironments(): Promise<
    Array<{
      key: MacCompatibilityGameKey;
      environment: MacWineEnvironment;
    }>
  > {
    return this.registry.getAll();
  }

  private async initializePrefix(
    prefixPath: string,
    wineVersion: MacWineVersion,
  ): Promise<void> {
    await execFileAsync(
      wineVersion.executablePath,
      ["wineboot", "--init"],
      {
        env: {
          ...process.env,
          WINEPREFIX: prefixPath,
        },
      },
    );
  }

  private createEnvironmentId(
    game: MacCompatibilityGameKey,
  ): string {
    return createEnvironmentId(game);
  }
}
