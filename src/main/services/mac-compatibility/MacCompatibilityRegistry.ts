import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
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
 * Trade-off this accepts: a save may still be in flight if the process
 * is killed immediately after a write (not on clean quit/close, since
 * Node keeps the process alive for pending I/O by default). Acceptable
 * here because this registry only stores derived/re-checkable state
 * (status, selection) — worst case on an unclean exit is one stale
 * write, not data loss of anything not re-derivable.
 */
export class MacCompatibilityRegistry {
  private readonly entries = new Map<string, MacCompatibilityRegistryEntry>();
  private readonly registryPath: string;

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

  private persist(): void {
    const data = Array.from(this.entries.values());
    const dir = dirname(this.registryPath);

    // Fire-and-forget by design (see class-level comment). Errors are
    // logged-equivalent via console since this file has no logger
    // dependency today; a failed save just means the next in-memory
    // write will retry via the same path.
    void (async () => {
      try {
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
        await writeFile(this.registryPath, JSON.stringify(data, null, 2), "utf8");
      } catch (error) {
        console.error(
          "[MacCompatibilityRegistry] Failed to persist registry:",
          error,
        );
      }
    })();
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
