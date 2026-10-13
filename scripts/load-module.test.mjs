import assert from "node:assert/strict";
import { it } from "node:test";
import { loadTestModule } from "./test/load-module.mjs";

it("the test loader refuses files outside launcher source and remote URLs", () => {
  assert.throws(
    () =>
      loadTestModule(
        new URL("./register-ts-node.mjs", import.meta.url),
        () => undefined
      ),
    /local launcher source/
  );
  assert.throws(
    () =>
      loadTestModule(
        new URL("https://fixture.invalid/untrusted.ts"),
        () => undefined
      ),
    { code: "ERR_INVALID_URL_SCHEME" }
  );
});
