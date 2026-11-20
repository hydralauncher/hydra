import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import * as chipModule from "./studio-filter-chip.ts";

const { isStudioFilterShown } = chipModule;

const playWay = {
  key: "publishers" as const,
  name: "PlayWay S.A.",
  values: ["PlayWay S.A.", "Red Dot Games, PlayWay S.A."],
};

describe("isStudioFilterShown", () => {
  it("groups the values a studio click set, in any order", () => {
    assert.equal(
      isStudioFilterShown(playWay, "publishers", [
        "Red Dot Games, PlayWay S.A.",
        "PlayWay S.A.",
      ]),
      true
    );
  });

  it("goes back to one chip per value once the filter is edited", () => {
    assert.equal(
      isStudioFilterShown(playWay, "publishers", ["PlayWay S.A."]),
      false
    );
  });

  it("leaves the other filter category alone", () => {
    assert.equal(
      isStudioFilterShown(playWay, "developers", playWay.values),
      false
    );
  });

  it("does nothing without a studio click", () => {
    assert.equal(isStudioFilterShown(null, "publishers", []), false);
  });
});
