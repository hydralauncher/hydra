import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toZ64 } from "./n64-rom.js";

const z64 = Buffer.from([
  0x80, 0x37, 0x12, 0x40, 0x00, 0x00, 0x00, 0x0f, 0x41, 0x42, 0x43, 0x44,
]);
const v64 = Buffer.from([
  0x37, 0x80, 0x40, 0x12, 0x00, 0x00, 0x0f, 0x00, 0x42, 0x41, 0x44, 0x43,
]);
const n64 = Buffer.from([
  0x40, 0x12, 0x37, 0x80, 0x0f, 0x00, 0x00, 0x00, 0x44, 0x43, 0x42, 0x41,
]);

describe("toZ64", () => {
  it("keeps a .z64 ROM as it is", () => {
    assert.equal(toZ64(z64), z64);
  });

  it("swaps each byte pair of a .v64 ROM", () => {
    assert.deepEqual(toZ64(v64), z64);
  });

  it("reverses each 4-byte word of a .n64 ROM", () => {
    assert.deepEqual(toZ64(n64), z64);
  });

  it("does not change the ROM it converts", () => {
    const original = Buffer.from(v64);
    toZ64(v64);
    assert.deepEqual(v64, original);
  });

  it("rejects a file that is not an N64 ROM", () => {
    assert.throws(
      () => toZ64(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])),
      /not_n64_rom/
    );
  });
});
