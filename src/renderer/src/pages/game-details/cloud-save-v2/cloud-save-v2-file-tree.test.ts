import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  CloudSaveV2FileComparison,
  CloudSaveV2LocalFile,
  CloudSaveV2RemoteFile,
} from "@types";

// @ts-ignore The Node ESM test runner requires the source extension.
import * as fileTree from "./cloud-save-v2-file-tree.ts";

const {
  buildCloudSaveV2ComparisonTree,
  buildCloudSaveV2LocalFileTree,
  filterCloudSaveV2Comparisons,
  formatCloudSaveV2LocalPath,
} = fileTree;

const localFile = (
  rawPath: string,
  relativePath: string,
  absolutePath: string,
  sizeBytes = 4
): CloudSaveV2LocalFile => ({
  source: "local",
  rawPath,
  relativePath,
  absolutePath,
  sizeBytes,
  lastModifiedAt: "2026-07-21T10:00:00.000Z",
});

const remoteFile = (
  rawPath: string,
  relativePath: string,
  sizeBytes = 4
): CloudSaveV2RemoteFile => ({
  source: "remote",
  rawPath,
  relativePath,
  sizeBytes,
  lastModifiedAt: null,
});

describe("cloud save V2 local file tree", () => {
  it("formats Windows extended paths without changing Unix paths", () => {
    assert.equal(
      formatCloudSaveV2LocalPath("//?/C:/Users/Hydra/Saves/slot.dat"),
      "C:\\Users\\Hydra\\Saves\\slot.dat"
    );
    assert.equal(
      formatCloudSaveV2LocalPath("\\\\?\\C:\\Users\\Hydra\\Saves"),
      "C:\\Users\\Hydra\\Saves"
    );
    assert.equal(
      formatCloudSaveV2LocalPath("\\\\?\\UNC\\server\\share\\Saves"),
      "\\\\server\\share\\Saves"
    );
    assert.equal(
      formatCloudSaveV2LocalPath("/home/hydra/saves/slot.dat"),
      "/home/hydra/saves/slot.dat"
    );
  });

  it("uses real Windows paths and normalizes mixed relative separators", () => {
    const [root] = buildCloudSaveV2LocalFileTree([
      localFile(
        "<home>/game",
        "profiles\\one/slot.dat",
        "C:\\Users\\Hydra\\Saves\\profiles\\one\\slot.dat"
      ),
    ]);

    assert.equal(root.name, "C:\\Users\\Hydra\\Saves");
    assert.equal(root.localDirectoryPath, "C:\\Users\\Hydra\\Saves");
    assert.equal(root.children[0].name, "profiles");
    assert.equal(root.children[0].type, "directory");
    if (root.children[0].type !== "directory") return;
    assert.equal(
      root.children[0].localDirectoryPath,
      "C:\\Users\\Hydra\\Saves\\profiles"
    );
    const one = root.children[0].children[0];
    assert.equal(one.type, "directory");
    if (one.type !== "directory") return;
    assert.equal(one.children[0].type, "file");
    if (one.children[0].type !== "file") return;
    assert.equal(
      one.children[0].local?.absolutePath,
      "C:\\Users\\Hydra\\Saves\\profiles\\one\\slot.dat"
    );
  });

  it("preserves Unix and UNC roots belonging to different rules", () => {
    const roots = buildCloudSaveV2LocalFileTree([
      localFile("rule-b", "slot.dat", "\\\\server\\share\\slot.dat"),
      localFile("rule-a", "slot.dat", "/home/hydra/saves/slot.dat"),
    ]);

    assert.deepEqual(
      roots.map((root) => root.name),
      ["/home/hydra/saves", "\\\\server\\share"]
    );
    assert.notEqual(roots[0].children[0].id, roots[1].children[0].id);
  });

  it("sorts directories before files and preserves metadata", () => {
    const [root] = buildCloudSaveV2LocalFileTree([
      localFile("rule", "z.dat", "/saves/z.dat", 8),
      localFile("rule", "profiles/slot.dat", "/saves/profiles/slot.dat", 16),
      localFile("rule", "a.dat", "/saves/a.dat", 4),
    ]);

    assert.deepEqual(
      root.children.map((node) => [node.type, node.name]),
      [
        ["directory", "profiles"],
        ["file", "a.dat"],
        ["file", "z.dat"],
      ]
    );
    const zFile = root.children[2];
    assert.equal(zFile.type, "file");
    if (zFile.type === "file") assert.equal(zFile.local?.sizeBytes, 8);
  });
});

describe("cloud save V2 comparison tree", () => {
  it("shows all files by default and can show only changed files", () => {
    const comparisons = [
      { status: "unchanged" },
      { status: "modified" },
      { status: "local-only" },
    ] as CloudSaveV2FileComparison[];

    assert.equal(filterCloudSaveV2Comparisons(comparisons, false).length, 3);
    assert.deepEqual(
      filterCloudSaveV2Comparisons(comparisons, true).map(
        (comparison) => comparison.status
      ),
      ["modified", "local-only"]
    );
  });

  it("keeps local and remote entries paired in a single row", () => {
    const rawPath = "<home>/game";
    const local = localFile(
      rawPath,
      "profiles/slot.dat",
      "C:\\Saves\\profiles\\slot.dat"
    );
    const remote = remoteFile(rawPath, "profiles/slot.dat");
    const comparisons: CloudSaveV2FileComparison[] = [
      {
        rawPath,
        relativePath: "profiles/slot.dat",
        status: "modified",
        local,
        remote,
      },
      {
        rawPath,
        relativePath: "remote.dat",
        status: "remote-only",
        local: null,
        remote: remoteFile(rawPath, "remote.dat"),
      },
    ];

    const [root] = buildCloudSaveV2ComparisonTree(comparisons);
    assert.equal(root.hasLocalFiles, true);
    assert.equal(root.hasRemoteFiles, true);
    const profiles = root.children[0];
    assert.equal(profiles.type, "directory");
    if (profiles.type !== "directory") return;
    const slot = profiles.children[0];
    assert.equal(slot.type, "file");
    if (slot.type !== "file") return;
    assert.equal(slot.local, local);
    assert.equal(slot.remote, remote);
    assert.equal(slot.status, "modified");

    const remoteOnly = root.children[1];
    assert.equal(remoteOnly.type, "file");
    if (remoteOnly.type !== "file") return;
    assert.equal(remoteOnly.local, null);
    assert.equal(remoteOnly.status, "remote-only");
  });

  it("keeps homonymous paths separated by rawPath", () => {
    const comparisons: CloudSaveV2FileComparison[] = ["rule-b", "rule-a"].map(
      (rawPath) => ({
        rawPath,
        relativePath: "slot.dat",
        status: "unchanged",
        local: localFile(rawPath, "slot.dat", `/saves/${rawPath}/slot.dat`),
        remote: remoteFile(rawPath, "slot.dat"),
      })
    );

    const roots = buildCloudSaveV2ComparisonTree(comparisons);
    assert.deepEqual(
      roots.map((root) => root.rawPath),
      ["rule-a", "rule-b"]
    );
    assert.notEqual(roots[0].children[0].id, roots[1].children[0].id);
  });
});
