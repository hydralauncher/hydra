import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import {
  CLOUD_SAVE_ENVIRONMENT_MARKER,
  resolveCloudSaveEnvironment,
  rotateCloudSavePrefixGeneration,
  type PrefixGenerationDependencies,
} from "./cloud-save-environment.ts";

const roots: string[] = [];

const createGenerationDependencies = (
  writeMarker?: PrefixGenerationDependencies["writeMarker"]
) => {
  const values = new Map<string, string>();
  return {
    values,
    dependencies: {
      store: {
        get: async (key: string) => values.get(key),
        put: async (key: string, value: string) => {
          values.set(key, value);
        },
        del: async (key: string) => {
          values.delete(key);
        },
      },
      writeMarker,
    } satisfies PrefixGenerationDependencies,
  };
};

const createContext = (root: string, winePrefixPath: string) => ({
  shop: "steam" as const,
  objectId: "1091500",
  platform: "linux" as const,
  homeDir: path.join(root, "home"),
  executablePath: path.join(root, "game", "Cyberpunk2077.exe"),
  winePrefixPath,
  steamPath: path.join(root, "steam"),
  storeUserContext: { known: [] },
});

const createRoot = async () => {
  const root = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "hydra-cloud-save-environment-")
  );
  roots.push(root);
  return root;
};

after(async () => {
  await Promise.all(
    roots.map((root) => fs.promises.rm(root, { recursive: true, force: true }))
  );
});

describe("cloud save environment identity", () => {
  it(
    "stays stable for the same prefix and its symlink",
    { skip: process.platform === "win32" },
    async () => {
      const root = await createRoot();
      const prefix = path.join(root, "prefix");
      const alias = path.join(root, "prefix-alias");
      await fs.promises.mkdir(prefix, { recursive: true });
      await fs.promises.symlink(prefix, alias);
      const { dependencies } = createGenerationDependencies();

      const [first, second, throughAlias] = await Promise.all([
        resolveCloudSaveEnvironment(createContext(root, prefix), {
          winePrefixIsValid: true,
          prefixGenerationDependencies: dependencies,
        }),
        resolveCloudSaveEnvironment(createContext(root, prefix), {
          winePrefixIsValid: true,
          prefixGenerationDependencies: dependencies,
        }),
        resolveCloudSaveEnvironment(createContext(root, alias), {
          winePrefixIsValid: true,
          prefixGenerationDependencies: dependencies,
        }),
      ]);

      assert.equal(first.environmentId, second.environmentId);
      assert.equal(first.environmentId, throughAlias.environmentId);
      assert.equal(first.prefixIdentityMode, "marker");
    }
  );

  it("keeps one environment while the active store user changes", async () => {
    const root = await createRoot();
    const prefix = path.join(root, "prefix");
    await fs.promises.mkdir(prefix, { recursive: true });

    const first = await resolveCloudSaveEnvironment(
      {
        ...createContext(root, prefix),
        storeUserContext: {
          active: {
            store: "steam",
            steamId64: "76561198000000001",
            accountId32: "39734273",
            source: "active-login",
          },
          known: [],
        },
      },
      { winePrefixIsValid: false }
    );
    const second = await resolveCloudSaveEnvironment(
      {
        ...createContext(root, prefix),
        storeUserContext: {
          active: {
            store: "steam",
            steamId64: "76561198051718575",
            accountId32: "91452847",
            source: "active-login",
          },
          known: [],
        },
      },
      { winePrefixIsValid: false }
    );

    assert.equal(first.environmentId, second.environmentId);
  });

  it(
    "changes when an executable symlink points to a different install",
    { skip: process.platform === "win32" },
    async () => {
      const root = await createRoot();
      const prefix = path.join(root, "prefix");
      const firstExecutable = path.join(root, "install-a", "game.exe");
      const secondExecutable = path.join(root, "install-b", "game.exe");
      const executableLink = path.join(root, "current-game.exe");
      await fs.promises.mkdir(prefix, { recursive: true });
      await fs.promises.mkdir(path.dirname(firstExecutable), {
        recursive: true,
      });
      await fs.promises.mkdir(path.dirname(secondExecutable), {
        recursive: true,
      });
      await fs.promises.writeFile(firstExecutable, "first");
      await fs.promises.writeFile(secondExecutable, "second");
      await fs.promises.symlink(firstExecutable, executableLink);
      const context = {
        ...createContext(root, prefix),
        executablePath: executableLink,
      };

      const first = await resolveCloudSaveEnvironment(context, {
        winePrefixIsValid: false,
      });
      await fs.promises.unlink(executableLink);
      await fs.promises.symlink(secondExecutable, executableLink);
      const second = await resolveCloudSaveEnvironment(context, {
        winePrefixIsValid: false,
      });

      assert.notEqual(first.environmentId, second.environmentId);
      assert.equal(
        first.pathContext.executablePath,
        await fs.promises.realpath(firstExecutable)
      );
      assert.equal(
        second.pathContext.executablePath,
        await fs.promises.realpath(secondExecutable)
      );
    }
  );

  it("rotates when the prefix is recreated at the same path", async () => {
    const root = await createRoot();
    const prefix = path.join(root, "prefix");
    const { dependencies } = createGenerationDependencies();
    await fs.promises.mkdir(prefix, { recursive: true });
    const first = await resolveCloudSaveEnvironment(
      createContext(root, prefix),
      {
        winePrefixIsValid: true,
        prefixGenerationDependencies: dependencies,
      }
    );

    await fs.promises.rm(prefix, { recursive: true, force: true });
    await fs.promises.mkdir(prefix, { recursive: true });
    const second = await resolveCloudSaveEnvironment(
      createContext(root, prefix),
      {
        winePrefixIsValid: true,
        prefixGenerationDependencies: dependencies,
      }
    );

    assert.notEqual(first.environmentId, second.environmentId);
    assert.equal(
      fs.existsSync(path.join(prefix, CLOUD_SAVE_ENVIRONMENT_MARKER)),
      true
    );
  });

  it("uses stable filesystem identity when marker creation is disabled", async () => {
    const root = await createRoot();
    const prefix = path.join(root, "prefix");
    const { dependencies } = createGenerationDependencies();
    await fs.promises.mkdir(prefix, { recursive: true });

    const first = await resolveCloudSaveEnvironment(
      createContext(root, prefix),
      {
        winePrefixIsValid: false,
        prefixGenerationDependencies: dependencies,
      }
    );
    const second = await resolveCloudSaveEnvironment(
      createContext(root, prefix),
      {
        winePrefixIsValid: false,
        prefixGenerationDependencies: dependencies,
      }
    );

    assert.equal(first.environmentId, second.environmentId);
    assert.equal(first.prefixIdentityMode, "filesystem");
  });

  it("rotates an in-place rebuilt prefix even when the old marker remains", async () => {
    const root = await createRoot();
    const prefix = path.join(root, "prefix");
    const drive = path.join(prefix, "drive_c");
    const { dependencies } = createGenerationDependencies();
    await fs.promises.mkdir(drive, { recursive: true });
    const first = await resolveCloudSaveEnvironment(
      createContext(root, prefix),
      {
        winePrefixIsValid: true,
        prefixGenerationDependencies: dependencies,
      }
    );

    await fs.promises.rm(drive, { recursive: true, force: true });
    await fs.promises.mkdir(drive, { recursive: true });
    const rotated = await rotateCloudSavePrefixGeneration(prefix, dependencies);
    const second = await resolveCloudSaveEnvironment(
      createContext(root, prefix),
      {
        winePrefixIsValid: true,
        prefixGenerationOverride: rotated,
        prefixGenerationDependencies: dependencies,
      }
    );

    assert.equal(rotated.durable, true);
    assert.notEqual(first.environmentId, second.environmentId);
  });

  it("prefers a durable local generation when marker replacement fails", async () => {
    const root = await createRoot();
    const prefix = path.join(root, "prefix");
    const oldMarker = "11111111-1111-4111-8111-111111111111";
    const { dependencies } = createGenerationDependencies(async () => false);
    await fs.promises.mkdir(prefix, { recursive: true });
    await fs.promises.writeFile(
      path.join(prefix, CLOUD_SAVE_ENVIRONMENT_MARKER),
      `${oldMarker}\n`
    );
    const before = await resolveCloudSaveEnvironment(
      createContext(root, prefix),
      {
        winePrefixIsValid: true,
        prefixGenerationDependencies: dependencies,
      }
    );

    const rotated = await rotateCloudSavePrefixGeneration(prefix, dependencies);
    const first = await resolveCloudSaveEnvironment(
      createContext(root, prefix),
      {
        winePrefixIsValid: true,
        prefixGenerationDependencies: dependencies,
      }
    );
    const second = await resolveCloudSaveEnvironment(
      createContext(root, prefix),
      {
        winePrefixIsValid: true,
        prefixGenerationDependencies: dependencies,
      }
    );

    assert.equal(rotated.durable, true);
    assert.equal(rotated.prefixIdentityMode, "local-fallback");
    assert.equal(first.prefixIdentityMode, "local-fallback");
    assert.notEqual(first.environmentId, before.environmentId);
    assert.equal(first.environmentId, second.environmentId);
  });

  it("rotates a pending local generation when drive_c is replaced", async () => {
    const root = await createRoot();
    const prefix = path.join(root, "prefix");
    const drive = path.join(prefix, "drive_c");
    const { dependencies } = createGenerationDependencies(async () => false);
    await fs.promises.mkdir(drive, { recursive: true });

    await rotateCloudSavePrefixGeneration(prefix, dependencies);
    const first = await resolveCloudSaveEnvironment(
      createContext(root, prefix),
      {
        winePrefixIsValid: true,
        prefixGenerationDependencies: dependencies,
      }
    );

    await fs.promises.rename(drive, path.join(prefix, "drive_c-old"));
    await fs.promises.mkdir(drive);
    const second = await resolveCloudSaveEnvironment(
      createContext(root, prefix),
      {
        winePrefixIsValid: true,
        prefixGenerationDependencies: dependencies,
      }
    );

    assert.equal(first.prefixIdentityMode, "local-fallback");
    assert.equal(second.prefixIdentityMode, "local-fallback");
    assert.notEqual(first.environmentId, second.environmentId);
  });

  it("does not trust a legacy pending UUID without a matching marker", async () => {
    const root = await createRoot();
    const prefix = path.join(root, "prefix");
    const drive = path.join(prefix, "drive_c");
    const { values, dependencies } = createGenerationDependencies(
      async () => false
    );
    await fs.promises.mkdir(drive, { recursive: true });
    const legacy = await rotateCloudSavePrefixGeneration(prefix, dependencies);
    const [key] = values.keys();
    assert.ok(key);
    values.set(key, legacy.generationId);
    const legacyEnvironment = await resolveCloudSaveEnvironment(
      createContext(root, prefix),
      {
        winePrefixIsValid: true,
        prefixGenerationOverride: legacy,
        prefixGenerationDependencies: dependencies,
      }
    );

    const resolved = await resolveCloudSaveEnvironment(
      createContext(root, prefix),
      {
        winePrefixIsValid: true,
        prefixGenerationDependencies: dependencies,
      }
    );

    assert.notEqual(resolved.environmentId, legacyEnvironment.environmentId);
    assert.equal(resolved.prefixIdentityMode, "local-fallback");
  });

  it("keeps a non-durable generation stable only for the current session", async () => {
    const root = await createRoot();
    const prefix = path.join(root, "prefix");
    const dependencies = {
      store: {
        get: async () => {
          throw new Error("unavailable");
        },
        put: async () => {
          throw new Error("unavailable");
        },
        del: async () => {
          throw new Error("unavailable");
        },
      },
      writeMarker: async () => false,
    } satisfies PrefixGenerationDependencies;
    await fs.promises.mkdir(prefix, { recursive: true });

    const rotated = await rotateCloudSavePrefixGeneration(prefix, dependencies);
    const first = await resolveCloudSaveEnvironment(
      createContext(root, prefix),
      {
        winePrefixIsValid: true,
        prefixGenerationDependencies: dependencies,
      }
    );
    const second = await resolveCloudSaveEnvironment(
      createContext(root, prefix),
      {
        winePrefixIsValid: true,
        prefixGenerationDependencies: dependencies,
      }
    );

    assert.equal(rotated.durable, false);
    assert.equal(first.prefixIdentityMode, "session");
    assert.equal(first.environmentId, second.environmentId);
  });
});
