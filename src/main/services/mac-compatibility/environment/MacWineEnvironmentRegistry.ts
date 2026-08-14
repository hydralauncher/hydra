import { readFile, writeFile } from "fs/promises";
import { dirname } from "path";
import type {
  MacCompatibilityGameKey,
  MacWineEnvironment,
} from "../MacCompatibilityTypes";

interface RegistryEntry {
  key: MacCompatibilityGameKey;
  environment: MacWineEnvironment;
}

export class MacWineEnvironmentRegistry {
  private readonly registryPath: string;
  private entries = new Map<string, RegistryEntry>();
  private loaded = false;

  constructor(registryPath: string) {
    this.registryPath = registryPath;
  }

  async get(
    key: MacCompatibilityGameKey,
  ): Promise<MacWineEnvironment | null> {
    await this.ensureLoaded();

    return this.entries.get(this.getKey(key))?.environment ?? null;
  }

  async set(
    key: MacCompatibilityGameKey,
    environment: MacWineEnvironment,
  ): Promise<void> {
    await this.ensureLoaded();

    this.entries.set(this.getKey(key), {
      key,
      environment,
    });

    await this.save();
  }

  async delete(key: MacCompatibilityGameKey): Promise<boolean> {
    await this.ensureLoaded();

    const deleted = this.entries.delete(this.getKey(key));

    if (deleted) {
      await this.save();
    }

    return deleted;
  }

  async has(key: MacCompatibilityGameKey): Promise<boolean> {
    await this.ensureLoaded();

    return this.entries.has(this.getKey(key));
  }

  async getAll(): Promise<
    Array<{
      key: MacCompatibilityGameKey;
      environment: MacWineEnvironment;
    }>
  > {
    await this.ensureLoaded();

    return Array.from(this.entries.values());
  }

  async clear(): Promise<void> {
    await this.ensureLoaded();

    this.entries.clear();

    await this.save();
  }

  private getKey(key: MacCompatibilityGameKey): string {
    return `${key.shop}:${key.objectId}`;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }

    this.loaded = true;

    try {
      const contents = await readFile(this.registryPath, "utf8");
      const data = JSON.parse(contents) as RegistryEntry[];

      for (const entry of data) {
        if (
          entry?.key?.shop &&
          entry?.key?.objectId &&
          entry?.environment
        ) {
          this.entries.set(this.getKey(entry.key), entry);
        }
      }
    } catch {
      // The registry does not exist yet.
      // It will be created automatically when the first
      // environment is saved.
    }
  }

  private async save(): Promise<void> {
    await this.ensureDirectory();

    const data = Array.from(this.entries.values());

    await writeFile(
      this.registryPath,
      JSON.stringify(data, null, 2),
      "utf8",
    );
  }

  private async ensureDirectory(): Promise<void> {
    const { mkdir } = await import("fs/promises");

    await mkdir(dirname(this.registryPath), {
      recursive: true,
    });
  }
}
