import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";

import { encodeCloudSaveCustomPath } from "./custom-path.ts";
import { resolveSelectedCustomPathApproval } from "./custom-path-approval-selection.ts";

it("binds a remote file to an existing file with a different name", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-file-rebind-"));
  try {
    const context = { platform: "linux" as const, homeDir: root };
    const rawPath = encodeCloudSaveCustomPath(
      path.join(root, "old.srm"),
      context
    ).rawPath;
    const renamed = path.join(root, "renamed.srm");
    await fs.writeFile(renamed, "existing save");

    const selected = await resolveSelectedCustomPathApproval(
      rawPath,
      "file",
      "old.srm",
      renamed,
      context
    );
    assert.equal(selected.path, await fs.realpath(renamed));

    const folder = await resolveSelectedCustomPathApproval(
      rawPath,
      "file",
      "old.srm",
      root,
      context
    );
    assert.equal(folder.path, path.join(await fs.realpath(root), "old.srm"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

it("rejects choosing a file for a directory snapshot", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-dir-rebind-"));
  try {
    const context = { platform: "linux" as const, homeDir: root };
    const file = path.join(root, "state.state1");
    await fs.writeFile(file, "state");
    const rawPath = encodeCloudSaveCustomPath(root, context).rawPath;
    await assert.rejects(
      resolveSelectedCustomPathApproval(rawPath, "dir", "", file, context),
      /cloud_save_custom_path_not_directory/
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
