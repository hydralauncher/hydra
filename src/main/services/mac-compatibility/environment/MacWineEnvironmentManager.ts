import { access, mkdir, rm } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";

import type {
  MacArchitecture,
  MacCompatibilityGameKey,
  MacWineEnvironment,
} from "../MacCompatibilityTypes";

export class MacWineEnvironmentManager {
  private readonly basePath: string;

  constructor(basePath?: string) {
    this.basePath =
      basePath ?? join(homedir(), "Library", "Application Support", "Hydra", "mac-compatibility");
  }

  async createEnvironment(
    game: MacCompatibilityGameKey,
    architecture: MacArchitecture,
    wineVersionId: string | null = null,
    wineVersionName: string | null = null,
  ): Promise<MacWineEnvironment> {
    const environmentId = `${game.shop}-${game.objectId}-${randomUUID()}`;
    const environmentPath = this.getEnvironmentPath(environmentId);

    await mkdir(environmentPath, {
      recursive: true,
    });

    const now = new Date().toISOString();

    const environment: MacWineEnvironment = {
      id: environmentId,
      prefixPath: environmentPath,
      wineVersionId,
      wineVersionName,
      architecture,
      exists: true,
      initialized: false,
      healthy: false,
      installedComponents: [],
      createdAt: now,
      updatedAt: now,
    };

    return environment;
  }

  async environmentExists(
    environment: MacWineEnvironment,
  ): Promise<boolean> {
    try {
      await access(environment.prefixPath);
      return true;
    } catch {
      return false;
    }
  }

  async initializeEnvironment(
    environment: MacWineEnvironment,
  ): Promise<MacWineEnvironment> {
    const exists = await this.environmentExists(environment);

    if (!exists) {
      throw new Error(
        `Wine environment does not exist: ${environment.prefixPath}`,
      );
    }

    const updatedEnvironment: MacWineEnvironment = {
      ...environment,
      exists: true,
      initialized: true,
      healthy: true,
      updatedAt: new Date().toISOString(),
    };

    return updatedEnvironment;
  }

  async repairEnvironment(
    environment: MacWineEnvironment,
  ): Promise<MacWineEnvironment> {
    const exists = await this.environmentExists(environment);

    if (!exists) {
      throw new Error(
        `Cannot repair missing Wine environment: ${environment.prefixPath}`,
      );
    }

    return {
      ...environment,
      exists: true,
      initialized: true,
      healthy: true,
      updatedAt: new Date().toISOString(),
    };
  }

  async deleteEnvironment(
    environment: MacWineEnvironment,
  ): Promise<void> {
    const exists = await this.environmentExists(environment);

    if (!exists) {
      return;
    }

    await rm(environment.prefixPath, {
      recursive: true,
      force: true,
    });
  }

  async addInstalledComponent(
    environment: MacWineEnvironment,
    component: string,
  ): Promise<MacWineEnvironment> {
    const components = environment.installedComponents.includes(component)
      ? environment.installedComponents
      : [...environment.installedComponents, component];

    return {
      ...environment,
      installedComponents: components,
      updatedAt: new Date().toISOString(),
    };
  }

  private getEnvironmentPath(environmentId: string): string {
    return join(this.basePath, "environments", environmentId);
  }
}
