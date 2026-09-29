import assert from "node:assert/strict";
import { it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import { canSelectCloudSaveCustomFile } from "./cloud-save-emulator-provider.ts";

it("offers Add save file only for LaunchBox emulator V2 games", () => {
  assert.equal(canSelectCloudSaveCustomFile("steam"), false);
  assert.equal(canSelectCloudSaveCustomFile("steam", "Super Nintendo"), false);
  assert.equal(
    canSelectCloudSaveCustomFile("launchbox", "Unsupported Platform"),
    false
  );
  assert.equal(
    canSelectCloudSaveCustomFile("launchbox", "Super Nintendo"),
    true
  );
  assert.equal(
    canSelectCloudSaveCustomFile("launchbox", "PlayStation 3"),
    true
  );
});
