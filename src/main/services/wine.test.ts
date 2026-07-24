import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import {
  getWinePrefixUserProfiles,
  resolveWinePrefixPath,
} from "./wine-prefix.ts";

const roots: string[] = [];

const createRoot = async () => {
  const root = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "hydra-wine-prefix-")
  );
  roots.push(root);
  return root;
};

const createValidPrefix = async (prefix: string) => {
  await fs.promises.mkdir(path.join(prefix, "dosdevices"), {
    recursive: true,
  });
  await fs.promises.mkdir(path.join(prefix, "drive_c"), { recursive: true });
  await Promise.all(
    ["system.reg", "user.reg", "userdef.reg"].map((file) =>
      fs.promises.writeFile(path.join(prefix, file), "")
    )
  );
};

after(async () => {
  await Promise.all(
    roots.map((root) => fs.promises.rm(root, { recursive: true, force: true }))
  );
});

describe("Wine prefix resolution", () => {
  it("expands home and canonicalizes an existing parent symlink", async () => {
    const root = await createRoot();
    const home = path.join(root, "home");
    const storage = path.join(root, "storage");
    const alias = path.join(home, "hydralauncher");
    await fs.promises.mkdir(home, { recursive: true });
    await fs.promises.mkdir(storage, { recursive: true });
    await fs.promises.symlink(
      storage,
      alias,
      process.platform === "win32" ? "junction" : "dir"
    );

    const resolved = await resolveWinePrefixPath(
      "~/hydralauncher/wine-prefixes/953490",
      home
    );

    assert.equal(
      resolved,
      path.join(await fs.promises.realpath(storage), "wine-prefixes", "953490")
    );
  });

  it("requires a real non-system Wine profile for restore", async () => {
    const root = await createRoot();
    const prefix = path.join(root, "prefix");
    await createValidPrefix(prefix);
    await fs.promises.mkdir(path.join(prefix, "drive_c", "users", "Public"), {
      recursive: true,
    });

    assert.deepEqual(getWinePrefixUserProfiles(prefix, root), []);

    await fs.promises.mkdir(path.join(prefix, "drive_c", "users", "steamuser"));
    assert.deepEqual(getWinePrefixUserProfiles(prefix, root), ["steamuser"]);
  });
});
