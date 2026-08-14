import type {
  MacCompatibilityGameKey,
  MacCompatibilityRegistryEntry,
  MacCompatibilityStatus,
  MacWineEnvironment,
} from "./MacCompatibilityTypes";

export class MacCompatibilityRegistry {
  private readonly entries = new Map<string, MacCompatibilityRegistryEntry>();

  private getKey(key: MacCompatibilityGameKey): string {
    return `${key.shop}:${key.objectId}`;
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
  }

  public delete(key: MacCompatibilityGameKey): boolean {
    return this.entries.delete(this.getKey(key));
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
  }
}
