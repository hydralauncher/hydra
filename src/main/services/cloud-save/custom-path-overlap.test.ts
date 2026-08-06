import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  CloudSaveCustomPath,
  CloudSaveCustomPathBindings,
  CloudSavePathContext,
  RestoreManifestFile,
} from "../../../types/index.ts";

import { getCloudSaveCustomPathOverlapErrorCode } from "./custom-path-overlap-error.ts";
import {
  partitionCloudSaveCustomPathBindingsByOverlap,
  type CloudSaveCustomPathOverlapOptions,
} from "./custom-path-overlap-bindings.ts";

const pathContext: CloudSavePathContext = {
  shop: "steam",
  objectId: "game",
  platform: "windows",
  homeDir: "C:/Users/Player",
  storeUserContext: { known: [] },
};

const customPath = (rawPath: string, path: string): CloudSaveCustomPath => ({
  rawPath,
  path,
  platform: "windows",
});

const remoteFile = (
  rawPath: string,
  relativePath: string
): RestoreManifestFile => ({
  variantId: "a".repeat(64),
  rawPath,
  relativePath,
  hash: "b".repeat(64),
  sizeBytes: 10,
  lastModifiedAt: "2026-07-30T00:00:00.000Z",
});

describe("Cloud Save custom path overlap errors", () => {
  it("preserves the overlap reason in the surfaced error code", () => {
    assert.equal(
      getCloudSaveCustomPathOverlapErrorCode("mapped-location-overlap"),
      "cloud_save_custom_path_mapped_location_overlap"
    );
    assert.equal(
      getCloudSaveCustomPathOverlapErrorCode("custom-location-overlap"),
      "cloud_save_custom_path_custom_location_overlap"
    );
    assert.equal(
      getCloudSaveCustomPathOverlapErrorCode("remote-target-mapped"),
      "cloud_save_custom_path_remote_target_overlap"
    );
  });
});

describe("Cloud Save custom path overlap bindings", () => {
  it("moves an overlapping stored binding to unresolved and keeps its path hint", () => {
    const overlapping = customPath(
      "<custom><windows><home>/Game/Saves",
      "C:/Users/Player/Game/Saves"
    );
    const usable = customPath(
      "<custom><windows><home>/Other",
      "C:/Users/Player/Other"
    );
    const bindings: CloudSaveCustomPathBindings = {
      ready: [overlapping, usable],
      unresolved: [],
    };

    const result = partitionCloudSaveCustomPathBindingsByOverlap(
      {
        objectId: "game",
        shop: "steam",
        pathContext,
        bindings,
        approvedRules: [],
        remoteFiles: [],
      },
      ({ selectedPath }) =>
        selectedPath === overlapping.path
          ? { hasOverlap: true, reason: "mapped-location-overlap" }
          : { hasOverlap: false }
    );

    assert.deepEqual(result.ready, [usable]);
    assert.deepEqual(result.unresolved, [
      {
        rawPath: overlapping.rawPath,
        pathHint: overlapping.path,
        state: "needs-confirmation",
        reason: "mapped-location-overlap",
        registered: true,
      },
    ]);
  });

  it("checks only the remote files that belong to each binding", () => {
    const first = customPath(
      "<custom><windows><home>/First",
      "C:/Users/Player/First"
    );
    const second = customPath(
      "<custom><windows><home>/Second",
      "C:/Users/Player/Second"
    );
    const calls: CloudSaveCustomPathOverlapOptions[] = [];

    partitionCloudSaveCustomPathBindingsByOverlap(
      {
        objectId: "game",
        shop: "steam",
        pathContext,
        bindings: { ready: [first, second], unresolved: [] },
        approvedRules: [],
        remoteFiles: [
          remoteFile(first.rawPath, "one.sav"),
          remoteFile(second.rawPath, "two.sav"),
          remoteFile(first.rawPath, "three.sav"),
        ],
      },
      (options) => {
        calls.push(options);
        return { hasOverlap: false };
      }
    );

    assert.deepEqual(calls[0].remoteRelativePaths, ["one.sav", "three.sav"]);
    assert.deepEqual(calls[1].remoteRelativePaths, ["two.sav"]);
    assert.equal(calls[0].currentRawPath, first.rawPath);
    assert.equal(calls[1].currentRawPath, second.rawPath);
  });

  it("preserves the distinction between manifest and custom overlaps", () => {
    const first = customPath(
      "<custom><windows><home>/First",
      "C:/Users/Player/First"
    );
    const existingUnresolved: CloudSaveCustomPathBindings["unresolved"][number] =
      {
        rawPath: "<custom><linux><home>/Legacy",
        pathHint: null,
        state: "needs-confirmation",
        reason: "foreign-platform",
        registered: true,
      };

    const result = partitionCloudSaveCustomPathBindingsByOverlap(
      {
        objectId: "game",
        shop: "steam",
        pathContext,
        bindings: {
          ready: [first],
          unresolved: [existingUnresolved],
        },
        approvedRules: [],
        remoteFiles: [],
      },
      () => ({ hasOverlap: true, reason: "custom-location-overlap" })
    );

    assert.deepEqual(result.unresolved, [
      existingUnresolved,
      {
        rawPath: first.rawPath,
        pathHint: first.path,
        state: "needs-confirmation",
        reason: "custom-location-overlap",
        registered: true,
      },
    ]);
  });
});
