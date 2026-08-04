import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import {
  getCloudSaveCustomPathSelectionFailure,
  hasEligibleCloudSaveCustomPathFiles,
} from "./custom-path-selection-policy.ts";

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

  it("distinguishes empty, foreign, and unavailable environments", () => {
    const rawPath = "<custom><linux><base>/Saves";

    assert.equal(
      getCloudSaveCustomPathSelectionFailure(
        [],
        [
          {
            rawPath,
            outcome: "scanned",
            enumeratedCompletely: true,
          },
        ],
        rawPath
      ),
      "empty"
    );
    assert.equal(
      getCloudSaveCustomPathSelectionFailure(
        [],
        [
          {
            rawPath,
            outcome: "foreign-environment",
            enumeratedCompletely: false,
          },
        ],
        rawPath
      ),
      "foreign-environment"
    );
    assert.equal(
      getCloudSaveCustomPathSelectionFailure(
        [],
        [
          {
            rawPath,
            outcome: "unresolved",
            enumeratedCompletely: false,
          },
        ],
        rawPath
      ),
      "environment-unavailable"
    );
  });

  it("reports incomplete enumeration as unreadable", () => {
    const rawPath = "<custom><linux><base>/Saves";

    assert.equal(
      getCloudSaveCustomPathSelectionFailure(
        [],
        [
          {
            rawPath,
            outcome: "failed",
            enumeratedCompletely: false,
          },
        ],
        rawPath
      ),
      "unreadable"
    );
  });

  it("accepts a discovered file regardless of incomplete sibling coverage", () => {
    const rawPath = "<custom><linux><base>/Saves";

    assert.equal(
      getCloudSaveCustomPathSelectionFailure(
        [{ rawPath }],
        [
          {
            rawPath,
            outcome: "partial",
            enumeratedCompletely: false,
          },
        ],
        rawPath
      ),
      null
    );
  });
});
