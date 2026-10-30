import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { ensureDirectorySync } from "./ensure-directory.ts";

describe("ensureDirectorySync", () => {
  it("creates missing nested directories", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-ensure-dir-"));
    try {
      const target = path.join(root, "a", "b", "c");
      ensureDirectorySync(target);
      assert.ok(fs.statSync(target).isDirectory());
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not throw for an existing filesystem root", () => {
    // mkdirSync on a Windows drive root throws EPERM; this must not.
    const root = path.parse(process.cwd()).root;
    assert.doesNotThrow(() => ensureDirectorySync(root));
  });

  it("still throws when the path is a file", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-ensure-dir-"));
    try {
      const file = path.join(root, "file");
      fs.writeFileSync(file, "");
      assert.throws(() => ensureDirectorySync(path.join(file, "child")));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
