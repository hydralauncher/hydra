import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_DISPLAY_ID,
  resolveDisplayId,
  toHydraDisplays,
} from "./display-manager-utils.ts";

const displays = [
  {
    id: 1,
    label: "Main monitor",
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    internal: false,
  },
  {
    id: 2,
    label: "TV",
    bounds: { x: 1920, y: 0, width: 3840, height: 2160 },
    internal: false,
  },
];

describe("display manager utilities", () => {
  it("maps Electron displays to renderer-safe display payloads", () => {
    assert.deepEqual(toHydraDisplays(displays, 1), [
      {
        id: "1",
        label: "Main monitor",
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        isPrimary: true,
        internal: false,
      },
      {
        id: "2",
        label: "TV",
        bounds: { x: 1920, y: 0, width: 3840, height: 2160 },
        isPrimary: false,
        internal: false,
      },
    ]);
  });

  it("resolves the saved Big Picture display when it exists", () => {
    assert.equal(resolveDisplayId("2", displays, 1), displays[1]);
  });

  it("falls back to the primary display for default or missing preferences", () => {
    assert.equal(
      resolveDisplayId(DEFAULT_DISPLAY_ID, displays, 1),
      displays[0]
    );
    assert.equal(resolveDisplayId("missing", displays, 1), displays[0]);
    assert.equal(resolveDisplayId(null, displays, 1), displays[0]);
  });
});
