import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { listArchiveFiles } from "./archive-discovery.ts";

test("finds a newly extracted archive one folder below its wrapper", async () => {
  const directory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "hydra-archive-discovery-")
  );

  try {
    await fs.promises.writeFile(path.join(directory, "outer.zip"), "");
    await fs.promises.mkdir(path.join(directory, "wrapper", "deeper"), {
      recursive: true,
    });
    await fs.promises.writeFile(
      path.join(directory, "wrapper", "inner.zip"),
      ""
    );
    await fs.promises.writeFile(
      path.join(directory, "wrapper", "deeper", "other.zip"),
      ""
    );

    assert.deepEqual(await listArchiveFiles(directory, 0, [".zip"]), [
      "outer.zip",
    ]);
    assert.deepEqual(await listArchiveFiles(directory, 1, [".zip"]), [
      "outer.zip",
      path.join("wrapper", "inner.zip"),
    ]);
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});
