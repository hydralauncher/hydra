import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_OVERLAY_HOTKEY,
  formatOverlayHotkey,
  isOverlaySameAsScreenshotHotkey,
  isSameOverlayHotkey,
  normalizeOverlayHotkey,
  validateOverlayHotkey,
} from "./overlay-input.js";

describe("validateOverlayHotkey", () => {
  const cases: [
    string,
    { modifier: "shift" | "alt"; key: string },
    string | null,
  ][] = [
    ["default Shift+Tab", { modifier: "shift", key: "Tab" }, null],
    ["Alt+Q", { modifier: "alt", key: "KeyQ" }, null],
    ["Shift+F10", { modifier: "shift", key: "F10" }, null],
    ["Alt+Tab", { modifier: "alt", key: "Tab" }, "hotkey_reserved"],
    ["Alt+F4", { modifier: "alt", key: "F4" }, "hotkey_reserved"],
    ["Alt+Space", { modifier: "alt", key: "Space" }, "hotkey_reserved"],
    ["Alt+Escape", { modifier: "alt", key: "Escape" }, "hotkey_reserved"],
    ["Shift+Escape", { modifier: "shift", key: "Escape" }, "hotkey_reserved"],
    [
      "an unsupported key",
      { modifier: "shift", key: "MediaPlayPause" },
      "hotkey_unsupported_key",
    ],
    [
      "Shift+PrintScreen",
      { modifier: "shift", key: "PrintScreen" },
      "hotkey_unsupported_key",
    ],
    [
      "Alt+PrintScreen",
      { modifier: "alt", key: "PrintScreen" },
      "hotkey_unsupported_key",
    ],
  ];

  for (const [name, candidate, error] of cases) {
    it(`${error ? "rejects" : "accepts"} ${name}`, () => {
      assert.deepEqual(
        validateOverlayHotkey(candidate),
        error ? { valid: false, error } : { valid: true }
      );
    });
  }
});

describe("normalizeOverlayHotkey", () => {
  const fallbackCases: [string, unknown][] = [
    ["undefined", undefined],
    ["null", null],
    ["a string", "Shift+Tab"],
    ["a missing key", { modifier: "shift" }],
    ["an invalid modifier", { modifier: "ctrl", key: "Tab" }],
    ["a reserved shortcut", { modifier: "alt", key: "Tab" }],
    ["an unsupported key", { modifier: "alt", key: "MediaPlayPause" }],
    ["a saved PrintScreen binding", { modifier: "shift", key: "PrintScreen" }],
  ];

  for (const [name, saved] of fallbackCases) {
    it(`falls back to Shift+Tab for ${name}`, () => {
      assert.deepEqual(normalizeOverlayHotkey(saved), DEFAULT_OVERLAY_HOTKEY);
    });
  }

  it("keeps a valid saved binding and drops unknown fields", () => {
    assert.deepEqual(
      normalizeOverlayHotkey({
        modifier: "alt",
        key: "KeyQ",
        ctrl: true,
        extra: "value",
      }),
      { modifier: "alt", key: "KeyQ" }
    );
  });
});

describe("isSameOverlayHotkey", () => {
  it("compares modifier and key", () => {
    assert.equal(
      isSameOverlayHotkey(
        { modifier: "shift", key: "Tab" },
        { modifier: "shift", key: "Tab" }
      ),
      true
    );
    assert.equal(
      isSameOverlayHotkey(
        { modifier: "shift", key: "Tab" },
        { modifier: "alt", key: "Tab" }
      ),
      false
    );
  });
});

describe("isOverlaySameAsScreenshotHotkey", () => {
  const screenshot = (
    overrides: Partial<{
      key: string;
      ctrl: boolean;
      alt: boolean;
      shift: boolean;
    }> = {}
  ) => ({ key: "Tab", ctrl: false, alt: false, shift: true, ...overrides });

  it("detects an exact collision", () => {
    assert.equal(
      isOverlaySameAsScreenshotHotkey(
        { modifier: "shift", key: "Tab" },
        screenshot()
      ),
      true
    );
  });

  it("does not collide when modifiers differ", () => {
    assert.equal(
      isOverlaySameAsScreenshotHotkey(
        { modifier: "alt", key: "Tab" },
        screenshot()
      ),
      false
    );
    assert.equal(
      isOverlaySameAsScreenshotHotkey(
        { modifier: "shift", key: "Tab" },
        screenshot({ ctrl: true })
      ),
      false
    );
  });
});

describe("formatOverlayHotkey", () => {
  it("formats the modifier and key", () => {
    assert.equal(
      formatOverlayHotkey({ modifier: "shift", key: "Tab" }),
      "Shift + Tab"
    );
    assert.equal(
      formatOverlayHotkey({ modifier: "alt", key: "KeyQ" }),
      "Alt + Q"
    );
  });
});
