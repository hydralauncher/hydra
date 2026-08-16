import { mkdir, readFile, rename, rm, writeFile } from "fs/promises";
import { dirname } from "path";
import { randomUUID } from "node:crypto";
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

  /**
   * The in-flight (or finished) load. Storing the promise instead of a
   * boolean is what makes concurrent callers safe — see ensureLoaded().
   */
  private loadPromise: Promise<void> | null = null;

  /**
   * Serializes writes so two saves can never interleave and the last
   * caller's data is the data left on disk — see save().
   */
  private saveQueue: Promise<void> = Promise.resolve();

  constructor(registryPath: string) {
    this.registryPath = registryPath;
  }

  async get(key: MacCompatibilityGameKey): Promise<MacWineEnvironment | null> {
    await this.ensureLoaded();

    return this.entries.get(this.getKey(key))?.environment ?? null;
  }

  async set(
    key: MacCompatibilityGameKey,
    environment: MacWineEnvironment
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

  /**
   * Waits for any queued write to reach disk. Useful before quitting.
   */
  async flush(): Promise<void> {
    await this.saveQueue;
  }

  private getKey(key: MacCompatibilityGameKey): string {
    return `${key.shop}:${key.objectId}`;
  }

  /**
   * Loads the registry exactly once, and makes every concurrent caller
   * wait for that same load.
   *
   * The old version set `loaded = true` before awaiting the file read,
   * so a second call arriving during the read saw "already loaded" and
   * read an empty map — reporting "no environment" for a game that has
   * one, which then created a second environment or showed the wrong
   * status. Caching the promise removes that window entirely.
   */
  private async ensureLoaded(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = this.load();
    }

    await this.loadPromise;
  }

  private async load(): Promise<void> {
    try {
      const contents = await readFile(this.registryPath, "utf8");
      const data = JSON.parse(contents) as RegistryEntry[];

      if (!Array.isArray(data)) {
        return;
      }

      for (const entry of data) {
        if (entry?.key?.shop && entry?.key?.objectId && entry?.environment) {
          this.entries.set(this.getKey(entry.key), entry);
        }
      }
    } catch {
      // The registry does not exist yet (or is corrupted).
      // It will be recreated when the first environment is saved.
    }
  }

  /**
   * Queues one atomic write.
   *
   * Two problems are fixed here. First, ordering: several saves used to
   * be able to run at the same time, and whichever write happened to
   * finish last won — which is not necessarily the newest data. Each
   * save now waits for the previous one, so disk order matches call
   * order. Second, atomicity: writing straight over registry.json meant
   * a crash or a full disk mid-write left a truncated, unparseable file
   * and every game lost its environment record. The data is written to a
   * temporary file in the same folder and then renamed over the real one,
   * which is atomic — readers see either the old file or the new one,
   * never a half-written one.
   */
  private async save(): Promise<void> {
    const contents = JSON.stringify(Array.from(this.entries.values()), null, 2);

    const write = this.saveQueue.then(
      () => this.writeAtomically(contents),
      () => this.writeAtomically(contents)
    );

    // The queue itself must never hold a rejection, or every later save
    // would inherit it. The caller still sees the real error below.
    this.saveQueue = write.then(
      () => undefined,
      () => undefined
    );

    await write;
  }

  private async writeAtomically(contents: string): Promise<void> {
    await this.ensureDirectory();

    const temporaryPath = `${this.registryPath}.${randomUUID()}.tmp`;

    try {
      await writeFile(temporaryPath, contents, "utf8");
      await rename(temporaryPath, this.registryPath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async ensureDirectory(): Promise<void> {
    await mkdir(dirname(this.registryPath), {
      recursive: true,
    });
  }
}
