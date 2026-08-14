import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname } from "path";
import type {
  MacCompatibilityGameKey,
  MacWineEnvironment,
} from "../MacCompatibilityTypes";

interface StoredEnvironment {
  key: MacCompatibilityGameKey;
  environment: MacWineEnvironment;
}

export class MacWineEnvironmentRegistry {
  private readonly filePath: string;
  private readonly entries = new Map<string, StoredEnvironment>();
  private loaded = false;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<void> {
    if (this.loaded) {
      return;
    }

    this.loaded = true;

    try {
      const contents = await readFile(this.filePath, "utf8");
      const stored = JSON.parse(contents) as StoredEnvironment[];

      for (const entry of stored) {
        this.entries.set(this.getKey(entry.key), entry);
      }
    } catch {
      // The registry does not exist yet.
    }
  }

  async save(): Promise<void> {
    await mkdir(dirname(this.filePath), {
      recursive: true,
    });

    const contents = JSON.stringify(
      Array.from(this.entries.values()),
      null,
      2,
    );

    await writeFile(this.filePath, contents, "utf8");
  }

  async get(
    key: MacCompatibilityGameKey,
  ): Promise<MacWineEnvironment | null> {
    await this.load();

    return this.entries.get(this.getKey(key))?.environment ?? null;
  }

  async set(
    key: MacCompatibilityGameKey,
    environment: MacWineEnvironment,
  ): Promise<void> {
    await this.load();

    this.entries.set(this.getKey(key), {
      key,
      environment,
    });

    await this.save();
  }

  async delete(key: MacCompatibilityGameKey): Promise<boolean> {
    await this.load();

    const deleted = this.entries.delete(this.getKey(key));

    if (deleted) {
      await this.save();
    }

    return deleted;
  }

  async has(key: MacCompatibilityGameKey): Promise<boolean> {
    await this.load();

    return this.entries.has(this.getKey(key));
  }

  async getAll(): Promise<StoredEnvironment[]> {
    await this.load();

    return Array.from(this.entries.values());
  }

  async clear(): Promise<void> {
    await this.load();

    this.entries.clear();

    await this.save();
  }

  private getKey(key: MacCompatibilityGameKey): string {
    return `${key.shop}:${key.objectId}`;
  }
}
