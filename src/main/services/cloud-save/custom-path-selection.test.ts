import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import { hasEligibleCloudSaveCustomPathFiles } from "./custom-path-selection-policy.ts";

describe("cloud save custom path selection", () => {
  it("requires a file discovered under the selected custom path", () => {
    const rawPath = "<custom><windows><winDocuments>/Game";

    assert.equal(hasEligibleCloudSaveCustomPathFiles([], rawPath), false);
    assert.equal(
      hasEligibleCloudSaveCustomPathFiles(
        [{ rawPath: "<winDocuments>/Other" }],
        rawPath
      ),
      false
    );
    assert.equal(
      hasEligibleCloudSaveCustomPathFiles([{ rawPath }], rawPath),
      true
    );
  });
});
