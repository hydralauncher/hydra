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
        label: "Main monitor - 1920x1080 @ 0,0",
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        isPrimary: true,
        internal: false,
      },
      {
        id: "2",
        label: "TV - 3840x2160 @ 1920,0",
        bounds: { x: 1920, y: 0, width: 3840, height: 2160 },
        isPrimary: false,
        internal: false,
      },
    ]);
  });

  it("orders display labels by desktop position instead of Electron return order", () => {
    assert.deepEqual(
      toHydraDisplays([displays[1], displays[0]], 1).map((display) => ({
        id: display.id,
        label: display.label,
      })),
      [
        { id: "1", label: "Main monitor - 1920x1080 @ 0,0" },
        { id: "2", label: "TV - 3840x2160 @ 1920,0" },
      ]
    );
  });

  it("resolves the saved Big Picture display when it exists", () => {
    assert.equal(resolveDisplayId("2", null, displays, 1), displays[1]);
  });

  it("prefers saved Big Picture display bounds over a changed display id", () => {
    assert.equal(
      resolveDisplayId(
        "1",
        { x: 1920, y: 0, width: 3840, height: 2160 },
        displays,
        1
      ),
      displays[1]
    );
  });

  it("falls back to saved Big Picture display bounds when the id is missing", () => {
    assert.equal(
      resolveDisplayId(
        "missing",
        { x: 1920, y: 0, width: 3840, height: 2160 },
        displays,
        1
      ),
      displays[1]
    );
  });

  it("falls back to the primary display for default or missing preferences", () => {
    assert.equal(
      resolveDisplayId(DEFAULT_DISPLAY_ID, null, displays, 1),
      displays[0]
    );
    assert.equal(resolveDisplayId("missing", null, displays, 1), displays[0]);
    assert.equal(resolveDisplayId(null, null, displays, 1), displays[0]);
  });
});
