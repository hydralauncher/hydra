import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isGlobalGuideButtonEnabled } from "./guide-preferences.js";

describe("isGlobalGuideButtonEnabled", () => {
  it("is off by default", () => {
    assert.equal(isGlobalGuideButtonEnabled(null), false);
    assert.equal(isGlobalGuideButtonEnabled(undefined), false);
    assert.equal(isGlobalGuideButtonEnabled({}), false);
  });

  it("is on only for the boolean true", () => {
    assert.equal(
      isGlobalGuideButtonEnabled({ enableGlobalGuideButton: true }),
      true
    );
    assert.equal(
      isGlobalGuideButtonEnabled({ enableGlobalGuideButton: false }),
      false
    );
  });

  it("refuses merely truthy values", () => {
    // A profile synced from elsewhere, or written by an older build, must never
    // switch on a global input hook by accident.
    const truthy = ["true", "1", "yes", 1, {}, []] as unknown as {
      enableGlobalGuideButton?: boolean;
    }[];

    for (const value of truthy) {
      assert.equal(
        isGlobalGuideButtonEnabled(value),
        false,
        `expected ${JSON.stringify(value)} not to enable the watcher`
      );
    }
  });
});
