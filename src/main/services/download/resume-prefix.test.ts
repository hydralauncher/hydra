import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  ResumePrefixMismatchError,
  verifyResumePrefixChunk,
} from "./resume-prefix.ts";

test("compares skipped remote bytes against the saved partial", async () => {
  const directory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "hydra-resume-prefix-")
  );
  const filePath = path.join(directory, "partial.zip");
  await fs.promises.writeFile(filePath, "abcdef");
  const file = await fs.promises.open(filePath, "r");

  try {
    await verifyResumePrefixChunk(file, Buffer.from("abc"), 0, 3);
    await verifyResumePrefixChunk(file, Buffer.from("defghi"), 3, 3);
    await assert.rejects(
      verifyResumePrefixChunk(file, Buffer.from("x"), 5, 1),
      ResumePrefixMismatchError
    );
    await assert.rejects(
      verifyResumePrefixChunk(file, Buffer.from("x"), 6, 1),
      ResumePrefixMismatchError
    );
  } finally {
    await file.close();
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});
