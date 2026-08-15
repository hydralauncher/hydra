import { mkdir, rm } from "fs/promises";
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
  MacWineEnvironmentHealthChecker,
  type MacWineEnvironmentHealthResult,
} from "./MacWineEnvironmentHealthChecker";
import {
  DEFAULT_MAC_ENVIRONMENTS_PATH,
  DEFAULT_MAC_ENVIRONMENTS_REGISTRY_PATH,
  assertManagedPrefixPath,
  createEnvironmentId,
  resolveManagedPrefixPath,
} from "./MacWineEnvironmentPaths";

const execFileAsync = promisify(execFile);

/**
 * Creating a Wine prefix from scratch is slow but not unbounded. A
 * wineboot that has not finished in five minutes is stuck, and hanging
 * forever would leave the UI waiting with no way out.
 */
const WINEBOOT_TIMEOUT_MS = 300_000;

export class MacWineEnvironmentManager {
  private readonly registry: MacWineEnvironmentRegistry;
  private readonly healthChecker: MacWineEnvironmentHealthChecker;
  private readonly environmentsPath: string;

  constructor(
    registryPath = DEFAULT_MAC_ENVIRONMENTS_REGISTRY_PATH,
    environmentsPath = DEFAULT_MAC_ENVIRONMENTS_PATH,
  ) {
    this.registry = new MacWineEnvironmentRegistry(registryPath);
    this.healthChecker = new MacWineEnvironmentHealthChecker();
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

    // The prefix is tested rather than assumed: wineboot can exit 0 and
    // still leave an unusable prefix, and writing healthy: true without
    // checking is what produced "ready" games that failed to launch.
    const health = await this.healthChecker.check(
      prefixPath,
      wineVersion.executablePath,
    );

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
      initialized: health.initialized,
      healthy: health.healthy,
      // "wine-prefix" marks that wineboot --init has completed for this
      // environment — the first and, for now, only tracked component.
      // Future dependency installs (VC++ Redist, .NET, etc.) append here
      // via recordInstalledComponent() rather than being written inline,
      // so every install path shares one consistent record-keeping spot.
      installedComponents: health.initialized ? ["wine-prefix"] : [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.registry.set(game, environment);

    if (health.healthy) {
      await MacWineEnvironmentLogger.info(
        prefixPath,
        "Environment created successfully.",
      );
    } else {
      await MacWineEnvironmentLogger.warning(
        prefixPath,
        "Environment was created but did not pass its health check.",
        health.message,
      );
    }

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

  /**
   * Tests one environment for real. Does not write anything — use
   * checkEnvironmentHealth() when the stored flags should be corrected
   * as well.
   *
   * The old implementation ran `wine --version`, which never reads
   * WINEPREFIX and therefore passed for a deleted or corrupted prefix.
   * The health checker is now the single place that decides what
   * "healthy" means, instead of that check existing in three files with
   * three different answers.
   */
  async testEnvironment(
    environment: MacWineEnvironment,
    wineVersion: MacWineVersion,
  ): Promise<boolean> {
    const health = await this.checkHealth(environment, wineVersion);

    return health.healthy;
  }

  /**
   * Tests the game's environment and writes the true result back to
   * environments.json, so a stale healthy/initialized flag is corrected
   * the first time anything asks.
   */
  async checkEnvironmentHealth(
    game: MacCompatibilityGameKey,
    wineVersion: MacWineVersion | null,
  ): Promise<{
    environment: MacWineEnvironment | null;
    health: MacWineEnvironmentHealthResult;
  }> {
    const environment = await this.getEnvironment(game);

    if (!environment) {
      return {
        environment: null,
        health: {
          healthy: false,
          initialized: false,
          message: "No Wine environment exists for this game.",
        },
      };
    }

    const health = await this.checkHealth(environment, wineVersion);

    const updated: MacWineEnvironment = {
      ...environment,
      exists: health.initialized,
      initialized: health.initialized,
      healthy: health.healthy,
      updatedAt: new Date().toISOString(),
    };

    // Only write when something actually changed, so a routine check
    // does not rewrite the registry file on every launch.
    if (
      environment.exists !== updated.exists ||
      environment.initialized !== updated.initialized ||
      environment.healthy !== updated.healthy
    ) {
      await this.registry.set(game, updated);
    }

    return { environment: updated, health };
  }

  /**
   * Cheap correction pass: confirms the prefix folder still exists and
   * still looks initialized, without spawning Wine.
   *
   * If the folder is gone (the user deleted it in Finder, or a disk
   * cleanup removed it), the stored exists/initialized/healthy flags are
   * corrected to false. It deliberately never sets healthy to true —
   * only a real Wine probe in checkEnvironmentHealth() is allowed to do
   * that.
   */
  async refreshEnvironmentPresence(
    game: MacCompatibilityGameKey,
  ): Promise<MacWineEnvironment | null> {
    const environment = await this.getEnvironment(game);

    if (!environment) {
      return null;
    }

    const present = await this.healthChecker.checkPrefixFiles(
      environment.prefixPath,
    );

    if (present) {
      return environment;
    }

    if (
      !environment.exists &&
      !environment.initialized &&
      !environment.healthy
    ) {
      return environment;
    }

    const updated: MacWineEnvironment = {
      ...environment,
      exists: false,
      initialized: false,
      healthy: false,
      updatedAt: new Date().toISOString(),
    };

    await this.registry.set(game, updated);

    return updated;
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

  private async checkHealth(
    environment: MacWineEnvironment,
    wineVersion: MacWineVersion | null,
  ): Promise<MacWineEnvironmentHealthResult> {
    const health = await this.healthChecker.check(
      environment.prefixPath,
      wineVersion?.executablePath ?? "",
    );

    if (!health.healthy) {
      await MacWineEnvironmentLogger.warning(
        environment.prefixPath,
        "Environment test failed.",
        health.message,
      );
    }

    return health;
  }

  private async initializePrefix(
    prefixPath: string,
    wineVersion: MacWineVersion,
  ): Promise<void> {
    await execFileAsync(
      wineVersion.executablePath,
      ["wineboot", "--init"],
      {
        timeout: WINEBOOT_TIMEOUT_MS,
        env: {
          ...process.env,
          WINEPREFIX: prefixPath,
          WINEDEBUG: "-all",
          // Stops Wine from opening blocking "install Mono/Gecko?"
          // dialogs during a headless setup.
          WINEDLLOVERRIDES: "mscoree=d;mshtml=d",
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
