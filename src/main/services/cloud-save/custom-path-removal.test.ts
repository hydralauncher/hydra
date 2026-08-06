import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { RestoreManifestResponse, SnapshotVariant } from "@types";

// @ts-ignore The Node ESM test runner requires the source extension.
import {
  buildCloudSaveCustomPathRemovalProposal,
  executeCloudSaveCustomPathRemoteRemoval,
} from "./custom-path-removal.ts";

const firstPath = "<custom><windows><winDocuments>/First";
const secondPath = "<custom><windows><winDocuments>/Second";
const firstVariant: SnapshotVariant = {
  variantId: "1".repeat(64),
  kind: "default",
};
const secondVariant: SnapshotVariant = {
  variantId: "2".repeat(64),
  kind: "opaque-folder",
  concreteFolderId: "Goldberg",
};
const manifest = (): Pick<
  RestoreManifestResponse,
  "customPathRawPaths" | "variants" | "files"
> => ({
  customPathRawPaths: [firstPath, secondPath],
  variants: [firstVariant, secondVariant],
  files: [
    {
      variantId: firstVariant.variantId,
      rawPath: firstPath,
      relativePath: "first.sav",
      hash: "a".repeat(64),
      sizeBytes: 1,
      lastModifiedAt: "2026-08-02T00:00:00.000Z",
    },
    {
      variantId: secondVariant.variantId,
      rawPath: secondPath,
      relativePath: "second.sav",
      hash: "b".repeat(64),
      sizeBytes: 2,
      lastModifiedAt: "2026-08-02T00:00:00.000Z",
    },
  ],
});

describe("cloud save custom path removal proposal", () => {
  it("removes the location, its files and now-unused variants", () => {
    const proposal = buildCloudSaveCustomPathRemovalProposal(
      manifest(),
      firstPath
    );

    assert.equal(proposal.changed, true);
    assert.deepEqual(proposal.customPathRawPaths, [secondPath]);
    assert.deepEqual(proposal.variants, [secondVariant]);
    assert.equal(proposal.files.length, 1);
    assert.equal(proposal.files[0].rawPath, secondPath);
  });

  it("deletes the remote snapshot when the final location is removed", async () => {
    const current = manifest();
    current.customPathRawPaths = [firstPath];
    current.variants = [firstVariant];
    current.files = [current.files[0]];

    const proposal = buildCloudSaveCustomPathRemovalProposal(
      current,
      firstPath
    );

    assert.equal(proposal.changed, true);
    assert.deepEqual(proposal.customPathRawPaths, []);
    assert.deepEqual(proposal.variants, []);
    assert.deepEqual(proposal.files, []);

    const calls: string[] = [];
    const result = await executeCloudSaveCustomPathRemoteRemoval({
      proposal,
      updateSnapshot: async () => {
        calls.push("update");
      },
      deleteSnapshot: async () => {
        calls.push("delete");
      },
    });

    assert.equal(result, "snapshot-deleted");
    assert.deepEqual(calls, ["delete"]);
  });

  it("updates the snapshot when any other tracked file remains", async () => {
    const proposal = buildCloudSaveCustomPathRemovalProposal(
      manifest(),
      firstPath
    );
    const calls: string[] = [];

    const result = await executeCloudSaveCustomPathRemoteRemoval({
      proposal,
      updateSnapshot: async () => {
        calls.push("update");
      },
      deleteSnapshot: async () => {
        calls.push("delete");
      },
    });

    assert.equal(result, "snapshot-updated");
    assert.deepEqual(calls, ["update"]);
  });

  it("keeps the normal update flow when an automatic save remains", async () => {
    const current = manifest();
    current.customPathRawPaths = [firstPath];
    current.files[1].rawPath = "<winAppData>/Game";
    const proposal = buildCloudSaveCustomPathRemovalProposal(
      current,
      firstPath
    );
    const calls: string[] = [];

    const result = await executeCloudSaveCustomPathRemoteRemoval({
      proposal,
      updateSnapshot: async () => {
        calls.push("update");
      },
      deleteSnapshot: async () => {
        calls.push("delete");
      },
    });

    assert.equal(result, "snapshot-updated");
    assert.equal(proposal.files[0].rawPath, "<winAppData>/Game");
    assert.deepEqual(calls, ["update"]);
  });

  it("updates an empty snapshot when another declared location remains", async () => {
    const current = manifest();
    current.files = [current.files[0]];
    current.variants = [firstVariant];
    const proposal = buildCloudSaveCustomPathRemovalProposal(
      current,
      firstPath
    );
    const calls: string[] = [];

    const result = await executeCloudSaveCustomPathRemoteRemoval({
      proposal,
      updateSnapshot: async () => {
        calls.push("update");
      },
      deleteSnapshot: async () => {
        calls.push("delete");
      },
    });

    assert.deepEqual(proposal.customPathRawPaths, [secondPath]);
    assert.deepEqual(proposal.variants, []);
    assert.deepEqual(proposal.files, []);
    assert.equal(result, "snapshot-updated");
    assert.deepEqual(calls, ["update"]);
  });

  it("rejects an empty snapshot with an orphaned variant", async () => {
    let requested = false;

    await assert.rejects(
      executeCloudSaveCustomPathRemoteRemoval({
        proposal: {
          changed: true,
          customPathRawPaths: [secondPath],
          variants: [secondVariant],
          files: [],
        },
        updateSnapshot: async () => {
          requested = true;
        },
        deleteSnapshot: async () => {
          requested = true;
        },
      }),
      /cloud_save_custom_path_removal_invalid_empty_snapshot/
    );
    assert.equal(requested, false);
  });

  it("does not make a remote request when the location is already absent", async () => {
    const proposal = buildCloudSaveCustomPathRemovalProposal(
      manifest(),
      "<custom><windows><winDocuments>/Missing"
    );
    const calls: string[] = [];

    const result = await executeCloudSaveCustomPathRemoteRemoval({
      proposal,
      updateSnapshot: async () => {
        calls.push("update");
      },
      deleteSnapshot: async () => {
        calls.push("delete");
      },
    });

    assert.equal(result, "unchanged");
    assert.deepEqual(calls, []);
  });

  it("is idempotent after the location is already absent", () => {
    const current = manifest();
    const proposal = buildCloudSaveCustomPathRemovalProposal(
      current,
      "<custom><windows><winDocuments>/Missing"
    );

    assert.equal(proposal.changed, false);
    assert.equal(proposal.files, current.files);
  });
});
