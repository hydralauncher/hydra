import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  resolveEpicWindowsPath,
  selectWindowsPathSegment,
} from "./windows-path.js";

test("Windows references resolve spaces/casing and reject escape or ambiguous names", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "epic-win-path-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "Game Binaries"));
  const exe = path.join(root, "Game Binaries", "Game.exe");
  await fs.writeFile(exe, "fixture");
  assert.equal(
    await resolveEpicWindowsPath(root, "game binaries\\GAME.EXE"),
    await fs.realpath(exe)
  );
  assert.equal(await resolveEpicWindowsPath(root, "missing.exe"), null);
  await assert.rejects(resolveEpicWindowsPath(root, "../outside.exe"), {
    code: "invalid-path",
  });
  await assert.rejects(resolveEpicWindowsPath(root, "C:\\outside.exe"), {
    code: "invalid-path",
  });
  assert.throws(
    () => selectWindowsPathSegment(["Game.exe", "game.exe"], "GAME.EXE"),
    { code: "invalid-path" }
  );
  assert.equal(
    selectWindowsPathSegment(["Game.exe", "game.exe"], "Game.exe"),
    "Game.exe"
  );
});
