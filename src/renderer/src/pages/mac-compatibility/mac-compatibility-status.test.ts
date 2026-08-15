import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import { toCircleStatus } from "./mac-compatibility-status.ts";

describe("toCircleStatus", () => {
  it("maps the ready status to the ready circle state", () => {
    assert.equal(toCircleStatus("ready"), "ready");
  });

  it("maps needs_setup to the needs-setup circle state", () => {
    assert.equal(toCircleStatus("needs_setup"), "needs-setup");
  });

  it("maps needs_repair to the needs-fix circle state", () => {
    assert.equal(toCircleStatus("needs_repair"), "needs-fix");
  });

  it("maps unsupported and error to the not-compatible circle state", () => {
    assert.equal(toCircleStatus("unsupported"), "not-compatible");
    assert.equal(toCircleStatus("error"), "not-compatible");
  });

  it("maps checking and unknown to the unknown circle state", () => {
    assert.equal(toCircleStatus("checking"), "unknown");
    assert.equal(toCircleStatus("unknown"), "unknown");
  });

  it("falls back to unknown for null, undefined, and unrecognised values", () => {
    assert.equal(toCircleStatus(null), "unknown");
    assert.equal(toCircleStatus(undefined), "unknown");
  });
});
