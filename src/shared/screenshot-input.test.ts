import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_SCREENSHOT_GAMEPAD_COMBO,
  DEFAULT_SCREENSHOT_HOTKEY,
  normalizeScreenshotGamepadCombo,
  normalizeScreenshotHotkey,
  validateScreenshotGamepadCombo,
  validateScreenshotHotkey,
  type ScreenshotHotkeyCandidate,
} from "./screenshot-input.js";

const hotkey = (
  key: string,
  modifiers: Partial<Omit<ScreenshotHotkeyCandidate, "key">> = {}
): ScreenshotHotkeyCandidate => ({
  key,
  ctrl: false,
  alt: false,
  shift: false,
  ...modifiers,
});

describe("validateScreenshotHotkey", () => {
  const cases: [string, ScreenshotHotkeyCandidate, string | null][] = [
    ["default F10", hotkey("F10"), null],
    ["F12 alone", hotkey("F12"), null],
    ["PrintScreen alone", hotkey("PrintScreen"), null],
    ["numpad digit alone", hotkey("Numpad5"), "hotkey_modifier_required"],
    ["Ctrl+Shift+letter", hotkey("KeyP", { ctrl: true, shift: true }), null],
    ["Alt+letter", hotkey("KeyA", { alt: true }), null],
    ["Alt+F4", hotkey("F4", { alt: true }), "hotkey_reserved"],
    [
      "Shift+Alt+F4",
      hotkey("F4", { alt: true, shift: true }),
      "hotkey_reserved",
    ],
    [
      "Ctrl+Alt+Delete",
      hotkey("Delete", { ctrl: true, alt: true }),
      "hotkey_reserved",
    ],
    [
      "Ctrl+Alt+Backspace",
      hotkey("Backspace", { ctrl: true, alt: true }),
      "hotkey_reserved",
    ],
    ["Alt+Tab", hotkey("Tab", { alt: true }), "hotkey_reserved"],
    ["Alt+Space", hotkey("Space", { alt: true }), "hotkey_reserved"],
    ["Ctrl+Alt+F3", hotkey("F3", { ctrl: true, alt: true }), "hotkey_reserved"],
    ["Win+F10", hotkey("F10", { meta: true }), "hotkey_reserved"],
    [
      "Super+Ctrl+letter",
      hotkey("KeyS", { ctrl: true, meta: true }),
      "hotkey_reserved",
    ],
    ["Escape alone", hotkey("Escape"), "hotkey_reserved"],
    ["Ctrl+Escape", hotkey("Escape", { ctrl: true }), "hotkey_reserved"],
    ["plain letter", hotkey("KeyA"), "hotkey_modifier_required"],
    [
      "Shift+letter",
      hotkey("KeyA", { shift: true }),
      "hotkey_modifier_required",
    ],
    ["plain digit", hotkey("Digit1"), "hotkey_modifier_required"],
    ["plain Space", hotkey("Space"), "hotkey_modifier_required"],
    ["plain arrow", hotkey("ArrowUp"), "hotkey_modifier_required"],
    ["unknown key", hotkey("MetaLeft"), "hotkey_unsupported_key"],
    ["empty key", hotkey(""), "hotkey_unsupported_key"],
  ];

  for (const [name, candidate, error] of cases) {
    it(`${error ? "rejects" : "accepts"} ${name}`, () => {
      assert.deepEqual(
        validateScreenshotHotkey(candidate),
        error ? { valid: false, error } : { valid: true }
      );
    });
  }
});

describe("normalizeScreenshotHotkey", () => {
  const fallbackCases: [string, unknown][] = [
    ["undefined", undefined],
    ["null", null],
    ["a string", "F10"],
    ["a missing modifier", { key: "F9", ctrl: false, alt: false }],
    [
      "a non-boolean modifier",
      { key: "F9", ctrl: 1, alt: false, shift: false },
    ],
    ["a reserved shortcut", hotkey("F4", { alt: true })],
    ["a plain letter", hotkey("KeyQ")],
    ["an unsupported key", hotkey("MediaPlayPause")],
  ];

  for (const [name, saved] of fallbackCases) {
    it(`falls back to F10 for ${name}`, () => {
      assert.deepEqual(
        normalizeScreenshotHotkey(saved),
        DEFAULT_SCREENSHOT_HOTKEY
      );
    });
  }

  it("keeps a valid saved binding and drops unknown fields", () => {
    assert.deepEqual(
      normalizeScreenshotHotkey({
        ...hotkey("F9", { ctrl: true }),
        meta: false,
        extra: "value",
      }),
      hotkey("F9", { ctrl: true })
    );
  });
});

describe("validateScreenshotGamepadCombo", () => {
  const cases: [string[], string | null][] = [
    [[], "gamepad_combo_too_short"],
    [["back"], "gamepad_combo_too_short"],
    [["back", "back"], "gamepad_combo_too_short"],
    [["back", "rb"], null],
    [["back", "rb", "a"], null],
    [["a", "b", "x", "y"], null],
    [["a", "b", "x", "y", "lb"], "gamepad_combo_too_long"],
    [["back", "guide"], "gamepad_combo_unsupported_button"],
  ];

  for (const [buttons, error] of cases) {
    it(`${error ?? "accepts"} for [${buttons.join(", ")}]`, () => {
      assert.deepEqual(
        validateScreenshotGamepadCombo(buttons),
        error ? { valid: false, error } : { valid: true }
      );
    });
  }
});

describe("normalizeScreenshotGamepadCombo", () => {
  it("falls back to the default combo for malformed or invalid saved combos", () => {
    for (const saved of [
      undefined,
      null,
      "back+rb",
      ["back"],
      ["back", 1],
      ["a", "b", "x", "y", "lb"],
    ]) {
      assert.deepEqual(
        normalizeScreenshotGamepadCombo(saved),
        DEFAULT_SCREENSHOT_GAMEPAD_COMBO
      );
    }
  });

  it("deduplicates a valid combo into canonical button order", () => {
    assert.deepEqual(normalizeScreenshotGamepadCombo(["rb", "start", "rb"]), [
      "rb",
      "start",
    ]);
  });
});
