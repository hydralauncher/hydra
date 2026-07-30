import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import {
  getWinePrefixUserProfile,
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

  it("resolves the active profile from user.reg", async () => {
    const root = await createRoot();
    const prefix = path.join(root, "prefix");
    await createValidPrefix(prefix);
    await Promise.all(
      ["other-user", "steamuser"].map((profile) =>
        fs.promises.mkdir(path.join(prefix, "drive_c", "users", profile), {
          recursive: true,
        })
      )
    );
    await fs.promises.writeFile(
      path.join(prefix, "user.reg"),
      String.raw`WINE REGISTRY Version 2

[Volatile Environment]
"USERPROFILE"="C:\\users\\other-user"
`
    );

    assert.deepEqual(getWinePrefixUserProfile(prefix), {
      name: "other-user",
      path: await fs.promises.realpath(
        path.join(prefix, "drive_c", "users", "other-user")
      ),
      windowsPath: "C:/users/other-user",
    });
  });

  it("rejects missing, external, and system profiles from user.reg", async () => {
    const root = await createRoot();
    const prefix = path.join(root, "prefix");
    await createValidPrefix(prefix);
    await fs.promises.mkdir(path.join(prefix, "drive_c", "users", "Public"), {
      recursive: true,
    });

    for (const userProfile of [
      String.raw`C:\\users\\missing`,
      String.raw`D:\\users\\player`,
      String.raw`C:\\users\\Public`,
      String.raw`C:\\users\\player\\nested`,
    ]) {
      await fs.promises.writeFile(
        path.join(prefix, "user.reg"),
        `WINE REGISTRY Version 2\n\n[Volatile Environment]\n"USERPROFILE"="${userProfile}"\n`
      );
      assert.equal(getWinePrefixUserProfile(prefix), null);
    }
  });
});
