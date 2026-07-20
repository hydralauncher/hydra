import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluateUmuPrefixPreparation } from "./umu-prefix-preparation.ts";

describe("UMU prefix preparation postcondition", () => {
  it("accepts a valid prefix despite a non-zero exit", () => {
    assert.deepEqual(evaluateUmuPrefixPreparation(1, null, true), {
      success: true,
      acceptedNonZeroExit: true,
    });
  });

  it("accepts a valid prefix after a zero exit", () => {
    assert.deepEqual(evaluateUmuPrefixPreparation(0, null, true), {
      success: true,
      acceptedNonZeroExit: false,
    });
  });

  it("rejects an invalid prefix regardless of exit code", () => {
    for (const exitCode of [0, 1]) {
      const result = evaluateUmuPrefixPreparation(exitCode, null, false);
      assert.equal(result.success, false);
      assert.match(result.errorMessage ?? "", /invalid prefix/);
    }
  });
});
