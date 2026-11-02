import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatBitRate } from "./format-bit-rate.js";

describe("formatBitRate", () => {
  it("shows zero and invalid speeds as 0 bps", () => {
    assert.equal(formatBitRate(0), "0 bps");
    assert.equal(formatBitRate(-5), "0 bps");
    assert.equal(formatBitRate(Number.NaN), "0 bps");
  });

  it("keeps slow upload speeds visible", () => {
    assert.equal(formatBitRate(100), "800 bps");
    assert.equal(formatBitRate(4_000), "32 Kbps");
    assert.equal(formatBitRate(1_500), "12 Kbps");
  });

  it("switches to Mbps and Gbps for fast speeds", () => {
    assert.equal(formatBitRate(1_250_000), "10 Mbps");
    assert.equal(formatBitRate(5_000_000), "40 Mbps");
    assert.equal(formatBitRate(250_000_000), "2 Gbps");
  });
});
