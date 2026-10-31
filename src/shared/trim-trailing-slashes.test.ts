import assert from "node:assert/strict";
import test from "node:test";
import { trimTrailingSlashes } from "./trim-trailing-slashes.js";

test("normalization removes only trailing forward slashes", () => {
  const cases: [string, string][] = [
    ["", ""],
    ["/", ""],
    ["///", ""],
    ["https://api.example.test", "https://api.example.test"],
    ["https://api.example.test/", "https://api.example.test"],
    ["https://api.example.test///", "https://api.example.test"],
    ["https://api.example.test/a//b///", "https://api.example.test/a//b"],
    ["path/ ", "path/ "],
    ["path/\n", "path/\n"],
    ["path/\\", "path/\\"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(trimTrailingSlashes(input), expected);
  }
});

test("long slash runs preserve interior slashes and remove the trailing run", () => {
  const interior = `https://api.example.test/${"/".repeat(100_000)}path`;
  assert.equal(trimTrailingSlashes(interior), interior);
  assert.equal(
    trimTrailingSlashes(`${interior}${"/".repeat(100_000)}`),
    interior
  );
});
