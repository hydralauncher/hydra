import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ELF_MAGIC,
  isElfBinary,
  isLinuxNativeExecutable,
  isLinuxShellScript,
} from "./linux-native-executable.ts";

let tmpDir: string;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-native-exec-"));
  fs.writeFileSync(path.join(tmpDir, "game.sh"), "#!/bin/bash\necho hi\n");
  fs.writeFileSync(path.join(tmpDir, "GAME.SH"), "#!/bin/bash\necho hi\n");
  fs.writeFileSync(
    path.join(tmpDir, "game-noext"),
    Buffer.concat([ELF_MAGIC, Buffer.from("fake-elf-body")])
  );
  fs.writeFileSync(
    path.join(tmpDir, "game.elf"),
    Buffer.concat([ELF_MAGIC, Buffer.from([0x02, 0x01])])
  );
  fs.writeFileSync(path.join(tmpDir, "game.exe"), "MZ-fake-windows-binary");
  fs.writeFileSync(
    path.join(tmpDir, "notes.txt"),
    "#!/bin/bash\nnot-a-script\n"
  );
  fs.writeFileSync(path.join(tmpDir, "empty"), "");
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("isLinuxShellScript", () => {
  it("matches .sh case-insensitively", () => {
    assert.strictEqual(isLinuxShellScript("/games/doom/game.sh"), true);
    assert.strictEqual(isLinuxShellScript("/games/doom/GAME.SH"), true);
  });

  it("rejects other extensions and extensionless files", () => {
    assert.strictEqual(isLinuxShellScript("/games/doom/game.exe"), false);
    assert.strictEqual(isLinuxShellScript("/games/doom/game"), false);
  });
});

describe("isElfBinary", () => {
  it("detects ELF magic regardless of extension", () => {
    assert.strictEqual(isElfBinary(path.join(tmpDir, "game-noext")), true);
    assert.strictEqual(isElfBinary(path.join(tmpDir, "game.elf")), true);
  });

  it("rejects non-ELF files, empty files and missing files", () => {
    assert.strictEqual(isElfBinary(path.join(tmpDir, "game.sh")), false);
    assert.strictEqual(isElfBinary(path.join(tmpDir, "game.exe")), false);
    assert.strictEqual(isElfBinary(path.join(tmpDir, "empty")), false);
    assert.strictEqual(isElfBinary(path.join(tmpDir, "does-not-exist")), false);
  });
});

describe("isLinuxNativeExecutable", () => {
  it("treats .sh and ELF binaries as native on linux", (t) => {
    if (process.platform !== "linux") {
      t.skip();
      return;
    }
    assert.strictEqual(
      isLinuxNativeExecutable(path.join(tmpDir, "game.sh")),
      true
    );
    assert.strictEqual(
      isLinuxNativeExecutable(path.join(tmpDir, "game-noext")),
      true
    );
    assert.strictEqual(
      isLinuxNativeExecutable(path.join(tmpDir, "game.elf")),
      true
    );
  });

  it("never routes .exe or plain text through the native path", (t) => {
    if (process.platform !== "linux") {
      t.skip();
      return;
    }
    assert.strictEqual(
      isLinuxNativeExecutable(path.join(tmpDir, "game.exe")),
      false
    );
    assert.strictEqual(
      isLinuxNativeExecutable(path.join(tmpDir, "notes.txt")),
      false
    );
    assert.strictEqual(
      isLinuxNativeExecutable(path.join(tmpDir, "does-not-exist")),
      false
    );
  });
});
