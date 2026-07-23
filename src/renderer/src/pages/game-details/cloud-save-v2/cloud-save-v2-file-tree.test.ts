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
  logicalFileId: JSON.stringify([rawPath, relativePath]),
  variantId: `variant:${rawPath}`,
  ruleId: `rule:${rawPath}`,
  rawPath,
  relativePath,
  absolutePath,
  sizeBytes,
  lastModifiedAt: "2026-07-21T10:00:00.000Z",
  userLabel: "Profile ••••test",
});

const remoteFile = (
  rawPath: string,
  relativePath: string,
  sizeBytes = 4
): CloudSaveV2RemoteFile => ({
  source: "remote",
  logicalFileId: JSON.stringify([rawPath, relativePath]),
  variantId: `variant:${rawPath}`,
  ruleId: `rule:${rawPath}`,
  rawPath,
  relativePath,
  sizeBytes,
  lastModifiedAt: null,
  userLabel: "Profile ••••test",
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

  it("groups different rules that resolve to the same local directory", () => {
    const roots = buildCloudSaveV2LocalFileTree([
      localFile(
        "rule-slots",
        "0.celeste",
        "D:\\Games\\Celeste\\Saves\\0.celeste"
      ),
      localFile(
        "rule-settings",
        "settings.celeste",
        "d:/games/celeste/saves/settings.celeste"
      ),
    ]);

    assert.equal(roots.length, 1);
    assert.deepEqual(
      roots[0].children.map((node) => node.name),
      ["0.celeste", "settings.celeste"]
    );
    assert.notEqual(roots[0].children[0].id, roots[0].children[1].id);
    assert.equal(roots[0].children[0].type, "file");
    assert.equal(roots[0].children[1].type, "file");
    if (
      roots[0].children[0].type !== "file" ||
      roots[0].children[1].type !== "file"
    ) {
      return;
    }
    assert.equal(roots[0].children[0].local?.rawPath, "rule-slots");
    assert.equal(roots[0].children[1].local?.rawPath, "rule-settings");
  });

  it("merges shared nested directories across different rules", () => {
    const [root] = buildCloudSaveV2LocalFileTree([
      localFile(
        "rule-slots",
        "profiles/one/slot.dat",
        "C:\\Saves\\profiles\\one\\slot.dat"
      ),
      localFile(
        "rule-settings",
        "profiles/one/settings.dat",
        "C:\\Saves\\profiles\\one\\settings.dat"
      ),
    ]);

    assert.equal(root.children.length, 1);
    const profiles = root.children[0];
    assert.equal(profiles.type, "directory");
    if (profiles.type !== "directory") return;
    assert.equal(profiles.children.length, 1);
    const one = profiles.children[0];
    assert.equal(one.type, "directory");
    if (one.type !== "directory") return;
    assert.deepEqual(
      one.children.map((node) => node.name),
      ["settings.dat", "slot.dat"]
    );
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
        logicalFileId: local.logicalFileId,
        variantId: local.variantId,
        rawPath,
        relativePath: "profiles/slot.dat",
        status: "modified",
        local,
        remote,
      },
      {
        logicalFileId: JSON.stringify([rawPath, "remote.dat"]),
        variantId: `variant:${rawPath}`,
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
        logicalFileId: JSON.stringify([rawPath, "slot.dat"]),
        variantId: `variant:${rawPath}`,
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

  it("keeps the same rule and relative path separated by variant", () => {
    const rawPath = "<winAppData>/Sekiro/<storeUserId>";
    const first = localFile(rawPath, "S0000.sl2", "C:\\Sekiro\\111\\S0000.sl2");
    const second = localFile(
      rawPath,
      "S0000.sl2",
      "C:\\Sekiro\\222\\S0000.sl2"
    );
    first.logicalFileId = "logical-111";
    first.variantId = "variant-111";
    first.userLabel = "Steam ••••0111";
    second.logicalFileId = "logical-222";
    second.variantId = "variant-222";
    second.userLabel = "Steam ••••0222";

    const roots = buildCloudSaveV2ComparisonTree([
      {
        logicalFileId: first.logicalFileId,
        variantId: first.variantId,
        rawPath,
        relativePath: first.relativePath,
        status: "local-only",
        local: first,
        remote: null,
      },
      {
        logicalFileId: second.logicalFileId,
        variantId: second.variantId,
        rawPath,
        relativePath: second.relativePath,
        status: "local-only",
        local: second,
        remote: null,
      },
    ]);

    assert.equal(roots.length, 2);
    assert.deepEqual(
      roots.map((root) => root.name),
      [
        "Steam ••••0111 · <winAppData>/Sekiro/<storeUserId>",
        "Steam ••••0222 · <winAppData>/Sekiro/<storeUserId>",
      ]
    );
    assert.notEqual(roots[0].children[0].id, roots[1].children[0].id);
  });
});
