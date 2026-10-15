import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import {
  linuxEpicSaveVariables,
  resolveLinuxEpicSavePath,
} from "./cloud-save-linux-path.js";

async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "epic-save-path-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const prefix = path.join(root, "prefix");
  const profile = path.join(prefix, "drive_c", "users", "steamuser");
  await fs.mkdir(profile, { recursive: true });
  return { root, prefix, profile };
}

test("automatic Windows save references keep real casing and preserve a missing suffix", async (t) => {
  const f = await fixture(t);
  const local = path.join(f.profile, "AppData", "local");
  await fs.mkdir(local, { recursive: true });
  const result = await resolveLinuxEpicSavePath(
    path.join(f.profile, "appdata", "Local", "New Game", "Saves")
  );
  assert.equal(result, path.join(local, "New Game", "Saves"));
  const variables = await linuxEpicSaveVariables(f.prefix, { path: f.profile });
  assert.equal(variables["{appdata}"], local);
});

test("known folder symlinks resolve to the actual Wine user directory without a host fallback", async (t) => {
  const f = await fixture(t);
  const documents = path.join(f.root, "Documents on another volume");
  await fs.mkdir(documents);
  await fs.symlink(
    documents,
    path.join(f.profile, "Documents"),
    process.platform === "win32" ? "junction" : "dir"
  );
  const variables = await linuxEpicSaveVariables(f.prefix, { path: f.profile });
  assert.equal(variables["{userdir}"], await fs.realpath(documents));
  assert.equal(variables["{userprofile}"], await fs.realpath(f.profile));
});

test(
  "registry known folders use prefix drive mappings, expanded values and actual casing",
  { skip: process.platform === "win32" },
  async (t) => {
    const f = await fixture(t);
    await fs.mkdir(path.join(f.prefix, "dosdevices"));
    await fs.symlink(
      path.join(f.prefix, "drive_c"),
      path.join(f.prefix, "dosdevices", "c:")
    );
    const documents = path.join(f.profile, "Meus Documentos");
    const local = path.join(f.profile, "AppData", "LOCAL");
    const roaming = path.join(f.profile, "Roaming custom");
    await fs.mkdir(documents);
    await fs.mkdir(local, { recursive: true });
    await fs.mkdir(roaming);
    await fs.writeFile(
      path.join(f.prefix, "user.reg"),
      String.raw`WINE REGISTRY Version 2
[Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders]
"Personal"="%USERPROFILE%\\unused"
"AppData"=str(2):"%USERPROFILE%\\roaming custom"
[Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders]
"Personal"="C:\\users\\steamuser\\meus documentos"
"Local AppData"="C:\\users\\steamuser\\AppData\\local"
`
    );
    const variables = await linuxEpicSaveVariables(f.prefix, {
      path: f.profile,
      windowsPath: "C:/users/steamuser",
    });
    assert.equal(variables["{userdir}"], documents);
    assert.equal(variables["{appdata}"], local);
    assert.equal(variables["{roaming}"], roaming);
  }
);

test(
  "ambiguous Windows save references are rejected instead of choosing an unrelated Linux directory",
  { skip: process.platform === "win32" },
  async (t) => {
    const f = await fixture(t);
    await fs.mkdir(path.join(f.profile, "Saves"));
    await fs.mkdir(path.join(f.profile, "SAVES"));
    await assert.rejects(
      resolveLinuxEpicSavePath(path.join(f.profile, "saves")),
      /invalid-path/
    );
  }
);
