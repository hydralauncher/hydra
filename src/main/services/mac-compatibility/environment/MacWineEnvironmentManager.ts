import { access, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import type {
  MacCompatibilityGameKey,
  MacWineEnvironment,
  MacWineVersion,
} from "../MacCompatibilityTypes";
import { MacWineEnvironmentRegistry } from "./MacWineEnvironmentRegistry";

const execFileAsync = promisify(execFile);

export class MacWineEnvironmentManager {
  private readonly registry: MacWineEnvironmentRegistry;
  private readonly environmentsPath: string;

  constructor(
    registryPath = join(
      homedir(),
      "Library",
      "Application Support",
      "Hydra",
      "mac-compatibility",
      "environments.json",
    ),
    environmentsPath = join(
      homedir(),
      "Library",
      "Application Support",
      "Hydra",
      "mac-compatibility",
      "environments",
    ),
  ) {
    this.registry = new MacWineEnvironmentRegistry(registryPath);
    this.environmentsPath = environmentsPath;
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
    const prefixPath = join(this.environmentsPath, environmentId);

    await mkdir(prefixPath, {
      recursive: true,
    });

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
      installedComponents: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.registry.set(game, environment);

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
    } catch {
      return false;
    }
  }

  async deleteEnvironment(
    game: MacCompatibilityGameKey,
  ): Promise<boolean> {
    const environment = await this.getEnvironment(game);

    if (!environment) {
      return false;
    }

    const { rm } = await import("fs/promises");

    await rm(environment.prefixPath, {
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
    const shop = this.sanitizeId(game.shop);
    const objectId = this.sanitizeId(game.objectId);

    return `${shop}-${objectId}`;
  }

  private sanitizeId(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }
}
