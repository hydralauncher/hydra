import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import { ensureDirectorySync } from "./ensure-directory.ts";

const epermError = (directory: string) =>
  Object.assign(
    new Error(`EPERM: operation not permitted, mkdir '${directory}'`),
    {
      code: "EPERM",
    }
  );

describe("ensureDirectorySync", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-ensure-dir-"));
  });

  afterEach(() => {
    mock.restoreAll();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("creates missing nested directories", () => {
    const target = path.join(root, "a", "b", "c");
    ensureDirectorySync(target);
    assert.ok(fs.statSync(target).isDirectory());
  });

  it("does not call mkdir for an existing directory", () => {
    const mkdir = mock.method(fs, "mkdirSync");
    ensureDirectorySync(root);
    assert.equal(mkdir.mock.callCount(), 0);
  });

  it("ignores EPERM from mkdir when the directory exists afterwards", () => {
    const target = path.join(root, "drive-root");
    const originalMkdir = fs.mkdirSync;
    const mkdir = mock.method(fs, "mkdirSync", (directory: fs.PathLike) => {
      originalMkdir(directory);
      throw epermError(String(directory));
    });

    assert.doesNotThrow(() => ensureDirectorySync(target));
    assert.equal(mkdir.mock.callCount(), 1);
  });

  it("rethrows EPERM from mkdir when the directory was not created", () => {
    const target = path.join(root, "denied");
    mock.method(fs, "mkdirSync", (directory: fs.PathLike) => {
      throw epermError(String(directory));
    });

    assert.throws(() => ensureDirectorySync(target), { code: "EPERM" });
  });

  it("throws when a parent path component is a file", () => {
    const file = path.join(root, "file");
    fs.writeFileSync(file, "");
    assert.throws(() => ensureDirectorySync(path.join(file, "child")));
  });
});
