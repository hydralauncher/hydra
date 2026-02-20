import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getPathType } from "./extraction-path";

test("getPathType returns file for regular files", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-path-type-"));
  const filePath = path.join(tempDir, "installer.exe");

  try {
    fs.writeFileSync(filePath, "binary");
    const pathType = await getPathType(filePath);
    assert.equal(pathType, "file");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("getPathType returns directory for folders", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-path-type-"));

  try {
    const pathType = await getPathType(tempDir);
    assert.equal(pathType, "directory");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("getPathType returns missing for unknown paths", async () => {
  const missingPath = path.join(
    os.tmpdir(),
    `hydra-path-type-missing-${Date.now()}-${Math.random()}`
  );

  const pathType = await getPathType(missingPath);
  assert.equal(pathType, "missing");
});
