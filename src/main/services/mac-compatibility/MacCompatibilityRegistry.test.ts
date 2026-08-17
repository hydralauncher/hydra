import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import { MacCompatibilityRegistry } from "./MacCompatibilityRegistry.ts";
// @ts-ignore The Node ESM test runner requires the source extension.
import type {
  MacCompatibilityGameKey,
  MacCompatibilityRegistryEntry,
  MacWineEnvironment,
} from "./MacCompatibilityTypes.ts";

const GAME: MacCompatibilityGameKey = {
  shop: "steam",
  objectId: "1091500",
};

const OTHER_GAME: MacCompatibilityGameKey = {
  shop: "custom",
  objectId: "123456",
};

const ENVIRONMENT: MacWineEnvironment = {
  id: "env-1",
  prefixPath: "/tmp/hydra-mac-env/env-1",
  wineVersionId: "homebrew-wine-arm64",
  wineVersionName: "Wine (Homebrew, Apple Silicon)",
  architecture: "arm64",
  exists: true,
  initialized: true,
  healthy: true,
  installedComponents: ["wine-prefix"],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

async function makeRegistryPath(): Promise<{
  directory: string;
  registryPath: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), "hydra-registry-test-"));

  return {
    directory,
    registryPath: join(directory, "registry.json"),
  };
}

async function cleanup(directory: string): Promise<void> {
  await rm(directory, {
    recursive: true,
    force: true,
  });
}

describe("MacCompatibilityRegistry persistence", () => {
  it("starts empty when the registry file does not exist", async () => {
    const { directory, registryPath } = await makeRegistryPath();

    try {
      const registry = new MacCompatibilityRegistry(registryPath);

      assert.equal(registry.getAll().length, 0);
      assert.equal(registry.has(GAME), false);
      assert.equal(registry.get(GAME), null);
    } finally {
      await cleanup(directory);
    }
  });

  it("persists an entry to disk", async () => {
    const { directory, registryPath } = await makeRegistryPath();

    try {
      const registry = new MacCompatibilityRegistry(registryPath);

      registry.setStatus(GAME, "needs_setup");
      await registry.flush();

      const contents = await readFile(registryPath, "utf8");
      const data = JSON.parse(contents) as MacCompatibilityRegistryEntry[];

      assert.equal(data.length, 1);
      assert.equal(data[0]?.key.shop, GAME.shop);
      assert.equal(data[0]?.key.objectId, GAME.objectId);
      assert.equal(data[0]?.lastStatus, "needs_setup");
    } finally {
      await cleanup(directory);
    }
  });

  it("loads persisted entries when a new registry instance is created", async () => {
    const { directory, registryPath } = await makeRegistryPath();

    try {
      const firstRegistry = new MacCompatibilityRegistry(registryPath);

      firstRegistry.setStatus(GAME, "ready");
      firstRegistry.setWineVersion(GAME, "homebrew-wine-arm64");
      await firstRegistry.flush();

      const secondRegistry = new MacCompatibilityRegistry(registryPath);

      const entry = secondRegistry.get(GAME);

      assert.ok(entry);
      assert.equal(entry?.lastStatus, "ready");
      assert.equal(entry?.selectedWineVersionId, "homebrew-wine-arm64");
    } finally {
      await cleanup(directory);
    }
  });

  it("updates an existing entry instead of creating duplicates", async () => {
    const { directory, registryPath } = await makeRegistryPath();

    try {
      const registry = new MacCompatibilityRegistry(registryPath);

      registry.setStatus(GAME, "needs_setup");
      registry.setStatus(GAME, "needs_repair");
      await registry.flush();

      const entries = registry.getAll();

      assert.equal(entries.length, 1);
      assert.equal(entries[0]?.lastStatus, "needs_repair");
    } finally {
      await cleanup(directory);
    }
  });

  it("persists and retrieves a Wine environment", async () => {
    const { directory, registryPath } = await makeRegistryPath();

    try {
      const registry = new MacCompatibilityRegistry(registryPath);

      registry.setEnvironment(GAME, ENVIRONMENT);
      await registry.flush();

      const environment = registry.getEnvironment(GAME);

      assert.deepEqual(environment, ENVIRONMENT);

      const reloadedRegistry = new MacCompatibilityRegistry(registryPath);

      assert.deepEqual(reloadedRegistry.getEnvironment(GAME), ENVIRONMENT);
    } finally {
      await cleanup(directory);
    }
  });

  it("setEnvironment preserves existing status and Wine selection", async () => {
    const { directory, registryPath } = await makeRegistryPath();

    try {
      const registry = new MacCompatibilityRegistry(registryPath);

      registry.setStatus(GAME, "needs_repair");
      registry.setWineVersion(GAME, "wine-version-1");

      registry.setEnvironment(GAME, ENVIRONMENT);
      await registry.flush();

      const entry = registry.get(GAME);

      assert.ok(entry);
      assert.equal(entry?.lastStatus, "needs_repair");
      assert.equal(entry?.selectedWineVersionId, "wine-version-1");
      assert.deepEqual(entry?.environment, ENVIRONMENT);
    } finally {
      await cleanup(directory);
    }
  });

  it("setEnvironment creates a complete entry when none exists", async () => {
    const { directory, registryPath } = await makeRegistryPath();

    try {
      const registry = new MacCompatibilityRegistry(registryPath);

      registry.setEnvironment(GAME, ENVIRONMENT);
      await registry.flush();

      const entry = registry.get(GAME);

      assert.ok(entry);
      assert.equal(entry?.key.shop, GAME.shop);
      assert.equal(entry?.key.objectId, GAME.objectId);
      assert.deepEqual(entry?.environment, ENVIRONMENT);
      assert.equal(entry?.selectedWineVersionId, ENVIRONMENT.wineVersionId);
      assert.equal(entry?.lastStatus, "unknown");
      assert.equal(entry?.lastCheckedAt, null);
      assert.ok(entry?.updatedAt);
    } finally {
      await cleanup(directory);
    }
  });

  it("setEnvironment with null clears the environment but preserves the entry", async () => {
    const { directory, registryPath } = await makeRegistryPath();

    try {
      const registry = new MacCompatibilityRegistry(registryPath);

      registry.setEnvironment(GAME, ENVIRONMENT);
      registry.setStatus(GAME, "ready");

      registry.setEnvironment(GAME, null);
      await registry.flush();

      const entry = registry.get(GAME);

      assert.ok(entry);
      assert.equal(entry?.environment, null);
      assert.equal(entry?.lastStatus, "ready");
    } finally {
      await cleanup(directory);
    }
  });

  it("setStatus updates the status and timestamp", async () => {
    const { directory, registryPath } = await makeRegistryPath();

    try {
      const registry = new MacCompatibilityRegistry(registryPath);

      registry.setStatus(GAME, "needs_repair");
      await registry.flush();

      const entry = registry.get(GAME);

      assert.ok(entry);
      assert.equal(entry?.lastStatus, "needs_repair");
      assert.ok(entry?.lastCheckedAt);
      assert.ok(entry?.updatedAt);
    } finally {
      await cleanup(directory);
    }
  });

  it("setWineVersion updates only the selected Wine version on an existing entry", async () => {
    const { directory, registryPath } = await makeRegistryPath();

    try {
      const registry = new MacCompatibilityRegistry(registryPath);

      registry.setStatus(GAME, "ready");
      registry.setWineVersion(GAME, "wine-version-2");
      await registry.flush();

      const entry = registry.get(GAME);

      assert.ok(entry);
      assert.equal(entry?.selectedWineVersionId, "wine-version-2");
      assert.equal(entry?.lastStatus, "ready");
    } finally {
      await cleanup(directory);
    }
  });

  it("setWineVersion can create an entry when none exists", async () => {
    const { directory, registryPath } = await makeRegistryPath();

    try {
      const registry = new MacCompatibilityRegistry(registryPath);

      registry.setWineVersion(GAME, "wine-version-3");
      await registry.flush();

      const entry = registry.get(GAME);

      assert.ok(entry);
      assert.equal(entry?.selectedWineVersionId, "wine-version-3");
      assert.equal(entry?.lastStatus, "unknown");
      assert.equal(entry?.environment, null);
    } finally {
      await cleanup(directory);
    }
  });

  it("delete removes the entry and persists the deletion", async () => {
    const { directory, registryPath } = await makeRegistryPath();

    try {
      const registry = new MacCompatibilityRegistry(registryPath);

      registry.setStatus(GAME, "ready");
      await registry.flush();

      assert.equal(registry.delete(GAME), true);
      await registry.flush();

      assert.equal(registry.has(GAME), false);
      assert.equal(registry.get(GAME), null);

      const reloadedRegistry = new MacCompatibilityRegistry(registryPath);

      assert.equal(reloadedRegistry.has(GAME), false);
    } finally {
      await cleanup(directory);
    }
  });

  it("delete returns false when the entry does not exist", async () => {
    const { directory, registryPath } = await makeRegistryPath();

    try {
      const registry = new MacCompatibilityRegistry(registryPath);

      assert.equal(registry.delete(GAME), false);
    } finally {
      await cleanup(directory);
    }
  });

  it("supports multiple games independently", async () => {
    const { directory, registryPath } = await makeRegistryPath();

    try {
      const registry = new MacCompatibilityRegistry(registryPath);

      registry.setStatus(GAME, "ready");
      registry.setStatus(OTHER_GAME, "needs_repair");
      await registry.flush();

      assert.equal(registry.getAll().length, 2);
      assert.equal(registry.get(GAME)?.lastStatus, "ready");
      assert.equal(registry.get(OTHER_GAME)?.lastStatus, "needs_repair");
    } finally {
      await cleanup(directory);
    }
  });

  it("clear removes all entries and persists the empty registry", async () => {
    const { directory, registryPath } = await makeRegistryPath();

    try {
      const registry = new MacCompatibilityRegistry(registryPath);

      registry.setStatus(GAME, "ready");
      registry.setStatus(OTHER_GAME, "needs_repair");
      await registry.flush();

      registry.clear();
      await registry.flush();

      assert.equal(registry.getAll().length, 0);

      const reloadedRegistry = new MacCompatibilityRegistry(registryPath);

      assert.equal(reloadedRegistry.getAll().length, 0);
    } finally {
      await cleanup(directory);
    }
  });

  it("handles a corrupted registry file by starting empty", async () => {
    const { directory, registryPath } = await makeRegistryPath();

    try {
      const { writeFile } = await import("node:fs/promises");

      await writeFile(registryPath, "{ this is not valid JSON", "utf8");

      const registry = new MacCompatibilityRegistry(registryPath);

      assert.equal(registry.getAll().length, 0);
      assert.equal(registry.get(GAME), null);
    } finally {
      await cleanup(directory);
    }
  });

  it("ignores a valid JSON value that is not an array", async () => {
    const { directory, registryPath } = await makeRegistryPath();

    try {
      const { writeFile } = await import("node:fs/promises");

      await writeFile(
        registryPath,
        JSON.stringify({ not: "an array" }),
        "utf8"
      );

      const registry = new MacCompatibilityRegistry(registryPath);

      assert.equal(registry.getAll().length, 0);
    } finally {
      await cleanup(directory);
    }
  });

  it("flush waits for queued writes to finish", async () => {
    const { directory, registryPath } = await makeRegistryPath();

    try {
      const registry = new MacCompatibilityRegistry(registryPath);

      registry.setStatus(GAME, "needs_setup");
      registry.setStatus(GAME, "needs_repair");
      registry.setStatus(GAME, "ready");

      await registry.flush();

      const reloadedRegistry = new MacCompatibilityRegistry(registryPath);

      assert.equal(reloadedRegistry.get(GAME)?.lastStatus, "ready");
    } finally {
      await cleanup(directory);
    }
  });
});
