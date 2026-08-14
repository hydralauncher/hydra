import { readFileSync, existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import type {
  MacCompatibilityGameKey,
  MacCompatibilityRegistryEntry,
  MacCompatibilityStatus,
  MacWineEnvironment,
} from "./MacCompatibilityTypes";

/**
 * Disk-backed, matching the pattern MacWineEnvironmentRegistry already
 * uses one level down. Before this change, every entry here (selected
 * Wine version, last known status, environment reference) was lost on
 * every Hydra restart, forcing a full re-check of every game.
 *
 * Public API is intentionally kept SYNCHRONOUS — every existing call
 * site in MacCompatibilityManager.ts calls these methods without
 * `await`. Making this class async instead would require updating every
 * one of those call sites, which is a second file and a larger change
 * than this fix needs. Instead: load once, synchronously, at
 * construction (a single small JSON read at startup is cheap), and
 * persist writes in the background without blocking the caller.
 *
 * Background writes are queued and atomic (see persist()), so they
 * cannot land out of order or leave a half-written file, and flush()
 * exists for callers that want to wait for the disk before quitting.
 */
export class MacCompatibilityRegistry {
  private readonly entries = new Map<string, MacCompatibilityRegistryEntry>();
  private readonly registryPath: string;

  /**
   * Serializes background writes so disk order matches call order.
   */
  private persistQueue: Promise<void> = Promise.resolve();

  constructor(
    registryPath: string = join(
      homedir(),
      "Library",
      "Application Support",
      "Hydra",
      "mac-compatibility",
      "registry.json",
    ),
  ) {
    this.registryPath = registryPath;
    this.loadFromDisk();
  }

  private getKey(key: MacCompatibilityGameKey): string {
    return `${key.shop}:${key.objectId}`;
  }

  private loadFromDisk(): void {
    try {
      if (!existsSync(this.registryPath)) {
        return;
      }

      const contents = readFileSync(this.registryPath, "utf8");
      const data = JSON.parse(contents) as MacCompatibilityRegistryEntry[];

      if (!Array.isArray(data)) {
        return;
      }

      for (const entry of data) {
        if (entry?.key?.shop && entry?.key?.objectId) {
          this.entries.set(this.getKey(entry.key), entry);
        }
      }
    } catch {
      // No registry yet, or it's corrupted — start empty rather than
      // crash. It will be recreated on the next write.
    }
  }

  /**
   * Queues one atomic write of the current state.
   *
   * Two problems are fixed here. Ordering: these writes used to be
   * started in parallel and whichever finished last won, so a stale
   * snapshot could overwrite a newer one. Each write now waits for the
   * previous one, so the file ends up matching the last call. Atomicity:
   * writing directly over registry.json meant an interrupted write left
   * a truncated file that fails to parse on the next start, wiping every
   * game's saved status. The data now goes to a temporary file in the
   * same folder and is renamed over the real one, which is atomic.
   */
  private persist(): void {
    const contents = JSON.stringify(Array.from(this.entries.values()), null, 2);

    this.persistQueue = this.persistQueue.then(
      () => this.writeAtomically(contents),
      () => this.writeAtomically(contents),
    );

    // Fire-and-forget by design (see class-level comment), but a failure
    // must not poison the queue for later writes, and must not become an
    // unhandled rejection.
    this.persistQueue = this.persistQueue.catch((error) => {
      console.error(
        "[MacCompatibilityRegistry] Failed to persist registry:",
        error,
      );
    });
  }

  private async writeAtomically(contents: string): Promise<void> {
    await mkdir(dirname(this.registryPath), { recursive: true });

    const temporaryPath = `${this.registryPath}.${randomUUID()}.tmp`;

    try {
      await writeFile(temporaryPath, contents, "utf8");
      await rename(temporaryPath, this.registryPath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  /**
   * Waits for every queued write to reach disk. Call before quitting if
   * the very last status change must survive.
   */
  public async flush(): Promise<void> {
    await this.persistQueue;
  }

  public get(
    key: MacCompatibilityGameKey,
  ): MacCompatibilityRegistryEntry | null {
    return this.entries.get(this.getKey(key)) ?? null;
  }

  public set(
    key: MacCompatibilityGameKey,
    entry: MacCompatibilityRegistryEntry,
  ): void {
    this.entries.set(this.getKey(key), entry);
    this.persist();
  }

  public delete(key: MacCompatibilityGameKey): boolean {
    const deleted = this.entries.delete(this.getKey(key));
    if (deleted) {
      this.persist();
    }
    return deleted;
  }

  public has(key: MacCompatibilityGameKey): boolean {
    return this.entries.has(this.getKey(key));
  }

  public getEnvironment(
    key: MacCompatibilityGameKey,
  ): MacWineEnvironment | null {
    return this.get(key)?.environment ?? null;
  }

  public setEnvironment(
    key: MacCompatibilityGameKey,
    environment: MacWineEnvironment | null,
  ): void {
    const existing = this.get(key);

    if (existing) {
      this.set(key, {
        ...existing,
        environment,
        updatedAt: new Date().toISOString(),
      });

      return;
    }

    this.set(key, {
      key,
      environment,
      selectedWineVersionId: environment?.wineVersionId ?? null,
      lastStatus: "unknown",
      lastCheckedAt: null,
      updatedAt: new Date().toISOString(),
    });
  }

  public setStatus(
    key: MacCompatibilityGameKey,
    status: MacCompatibilityStatus,
  ): void {
    const existing = this.get(key);

    if (existing) {
      this.set(key, {
        ...existing,
        lastStatus: status,
        lastCheckedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      return;
    }

    this.set(key, {
      key,
      environment: null,
      selectedWineVersionId: null,
      lastStatus: status,
      lastCheckedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  public setWineVersion(
    key: MacCompatibilityGameKey,
    wineVersionId: string | null,
  ): void {
    const existing = this.get(key);

    if (existing) {
      this.set(key, {
        ...existing,
        selectedWineVersionId: wineVersionId,
        updatedAt: new Date().toISOString(),
      });

      return;
    }

    this.set(key, {
      key,
      environment: null,
      selectedWineVersionId: wineVersionId,
      lastStatus: "unknown",
      lastCheckedAt: null,
      updatedAt: new Date().toISOString(),
    });
  }

  public getAll(): MacCompatibilityRegistryEntry[] {
    return Array.from(this.entries.values());
  }

  public clear(): void {
    this.entries.clear();
    this.persist();
  }
}
