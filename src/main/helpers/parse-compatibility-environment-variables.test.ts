import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseCompatibilityEnvironmentVariables,
  unquoteEnvValue,
} from "./parse-compatibility-environment-variables.js";

describe("unquoteEnvValue", () => {
  it("removes surrounding double quotes", () => {
    assert.equal(unquoteEnvValue('"fps,devinfo"'), "fps,devinfo");
  });

  it("removes surrounding single quotes", () => {
    assert.equal(unquoteEnvValue("'version=n,b'"), "version=n,b");
  });

  it("handles empty quotes", () => {
    assert.equal(unquoteEnvValue('""'), "");
    assert.equal(unquoteEnvValue("''"), "");
  });

  it("does not strip mismatched quotes", () => {
    assert.equal(unquoteEnvValue("\"unmatched'"), "\"unmatched'");
  });

  it("leaves unquoted values unchanged", () => {
    assert.equal(unquoteEnvValue("1"), "1");
    assert.equal(unquoteEnvValue("value"), "value");
    assert.equal(unquoteEnvValue(""), "");
  });
});

describe("parseCompatibilityEnvironmentVariables", () => {
  it("returns an empty object for empty or null inputs", () => {
    assert.deepStrictEqual(parseCompatibilityEnvironmentVariables(null), {});
    assert.deepStrictEqual(
      parseCompatibilityEnvironmentVariables(undefined),
      {}
    );
    assert.deepStrictEqual(parseCompatibilityEnvironmentVariables(""), {});
    assert.deepStrictEqual(
      parseCompatibilityEnvironmentVariables("   \n\n  "),
      {}
    );
  });

  it("skips comments and empty lines", () => {
    const raw = `
# this is a comment
  # indented comment
FOO=bar

# another comment
BAZ=qux
`;
    assert.deepStrictEqual(parseCompatibilityEnvironmentVariables(raw), {
      FOO: "bar",
      BAZ: "qux",
    });
  });

  it("trims spaces around variable names and equal signs", () => {
    const raw = `
FOO = 1
BAR   =    2
`;
    assert.deepStrictEqual(parseCompatibilityEnvironmentVariables(raw), {
      FOO: "1",
      BAR: "2",
    });
  });

  it("strips shell quotes from values", () => {
    const raw = `
DXVK_HUD="fps,devinfo"
WINEDLLOVERRIDES='dxgi=n,b'
DXVK_CONFIG="dxvk.tearFree = True"
`;
    assert.deepStrictEqual(parseCompatibilityEnvironmentVariables(raw), {
      DXVK_HUD: "fps,devinfo",
      WINEDLLOVERRIDES: "dxgi=n,b",
      DXVK_CONFIG: "dxvk.tearFree = True",
    });
  });

  it("preserves interior whitespace when quoted", () => {
    const raw = `FOO = "  spaced  "`;
    assert.deepStrictEqual(parseCompatibilityEnvironmentVariables(raw), {
      FOO: "  spaced  ",
    });
  });

  it("handles empty variable values", () => {
    const raw = `
FOO=
BAR=""
BAZ=''
`;
    assert.deepStrictEqual(parseCompatibilityEnvironmentVariables(raw), {
      FOO: "",
      BAR: "",
      BAZ: "",
    });
  });

  it("skips malformed lines and invalid variable names", () => {
    const raw = `
=value_without_name
123BAD=value
INVALID-VAR=value
VALID_VAR_1=ok
NO_EQUALS_SIGN
`;
    assert.deepStrictEqual(parseCompatibilityEnvironmentVariables(raw), {
      VALID_VAR_1: "ok",
    });
  });
});
