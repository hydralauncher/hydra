import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { test } from "node:test";
const require = createRequire(import.meta.url);
const {
  verifyPe,
  verifyEpicPrerequisiteRunner,
  sourceDigest,
  resolveCargoExecutable,
  resolveSystemExecutable,
  TARGET,
  FILE_NAME,
  MANIFEST_NAME,
} = require("./build-epic-prerequisite-runner.cjs");

test("Cargo resolves its explicit home without searching a poisoned PATH", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-epic-cargo-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const cargoHome = path.join(root, "Cargo home with spaces");
  const name = process.platform === "win32" ? "cargo.exe" : "cargo";
  const cargo = path.join(cargoHome, "bin", name);
  await fs.mkdir(path.dirname(cargo), { recursive: true });
  await fs.writeFile(cargo, "benign resolver fixture", { mode: 0o755 });
  assert.equal(
    await resolveCargoExecutable({
      environment: {
        CARGO_HOME: cargoHome,
        PATH: path.join(root, "untrusted"),
      },
      homeDirectory: path.join(root, "unused-home"),
    }),
    cargo
  );
});

test("Cargo rejects a relative configured home and keeps its absolute user-home alias", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-epic-cargo-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const cargo = path.join(
    root,
    ".cargo",
    "bin",
    process.platform === "win32" ? "cargo.exe" : "cargo"
  );
  await fs.mkdir(path.dirname(cargo), { recursive: true });
  await fs.writeFile(cargo, "benign resolver fixture", { mode: 0o755 });
  assert.equal(
    await resolveCargoExecutable({
      environment: { CARGO_HOME: "relative-home", PATH: "relative-bin" },
      homeDirectory: root,
    }),
    cargo
  );
});

test("system fixture tools reject path components", async () => {
  await assert.rejects(resolveSystemExecutable("../wine"), /Invalid system/);
  await assert.rejects(resolveSystemExecutable("/tmp/wine"), /Invalid system/);
});

test(
  "Linux fixture tools resolve only an executable in root-owned system directories",
  { skip: process.platform !== "linux" },
  async () => {
    const executable = await resolveSystemExecutable("true");
    assert.ok(path.isAbsolute(executable));
    assert.equal((await fs.stat(executable)).uid, 0);
    assert.equal(path.basename(executable), "true");
  }
);

function pe() {
  const bytes = Buffer.alloc(128);
  bytes.write("MZ");
  bytes.writeUInt32LE(64, 60);
  bytes.write("PE\0\0", 64);
  bytes.writeUInt16LE(0x8664, 68);
  bytes.writeUInt16LE(0x20b, 88);
  return bytes;
}
test("packaging accepts only PE32+ x64 and bounds the PE offset", () => {
  assert.equal(verifyPe(pe()), true);
  const wrongArchitecture = pe();
  wrongArchitecture.writeUInt16LE(0x14c, 68);
  assert.equal(verifyPe(wrongArchitecture), false);
  const truncated = pe();
  truncated.writeUInt32LE(0xffffffff, 60);
  assert.equal(verifyPe(truncated), false);
  assert.equal(verifyPe(Buffer.from("MZ")), false);
});
test("packaging detects modified supervisor bytes, stale sources and missing manifests", async (t) => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-epic-pe-"));
  t.after(() => fs.rm(projectDir, { recursive: true, force: true }));
  const source = path.join(projectDir, "native/epic-prerequisite-runner");
  const directory = path.join(projectDir, "package/epic");
  await fs.mkdir(path.join(source, "src"), { recursive: true });
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(source, "Cargo.toml"), "source manifest");
  await fs.writeFile(path.join(source, "Cargo.lock"), "locked dependencies");
  await fs.writeFile(path.join(source, "src/main.rs"), "fn main() {}");
  const bytes = pe();
  await fs.writeFile(path.join(directory, FILE_NAME), bytes);
  await fs.writeFile(
    path.join(directory, MANIFEST_NAME),
    JSON.stringify({
      schemaVersion: 1,
      target: TARGET,
      sourceSha256: await sourceDigest(projectDir),
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    })
  );
  assert.equal(
    await verifyEpicPrerequisiteRunner({ projectDir, directory }),
    true
  );
  await fs.appendFile(path.join(directory, FILE_NAME), "tampered");
  assert.equal(
    await verifyEpicPrerequisiteRunner({ projectDir, directory }),
    false
  );
  await fs.writeFile(path.join(directory, FILE_NAME), bytes);
  await fs.appendFile(path.join(source, "src/main.rs"), "// changed");
  assert.equal(
    await verifyEpicPrerequisiteRunner({ projectDir, directory }),
    false
  );
  await fs.unlink(path.join(directory, MANIFEST_NAME));
  assert.equal(
    await verifyEpicPrerequisiteRunner({ projectDir, directory }),
    false
  );
});
