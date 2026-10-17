import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { MODS_ERROR_CODES } from "../../../../../../shared/mods-errors.js";

const root = process.cwd();
const read = (relative: string) =>
  fs.readFileSync(path.join(root, relative), "utf8");

const en = JSON.parse(read("src/locales/en/translation.json")) as {
  mods: Record<string, unknown>;
};
const mods = en.mods;

const hasKey = (key: string): boolean =>
  key in mods || (`${key}_one` in mods && `${key}_other` in mods);

const keysUsed = (source: string, fn: string): string[] =>
  [...source.matchAll(new RegExp(`\\b${fn}\\(\\s*"([a-z0-9_]+)"`, "g"))].map(
    (match) => match[1]
  );

test("every key used by the Mods window exists in English", () => {
  const modal = read(
    "src/renderer/src/pages/game-details/modals/mods-modal/mods-modal.tsx"
  );
  const used = keysUsed(modal, "t");
  assert.ok(used.length > 20, "expected to find the modal's keys");

  const missing = used.filter((key) => !hasKey(key));
  assert.deepEqual(missing, []);
});

test("the game page button text exists in English", () => {
  const hero = read(
    "src/renderer/src/pages/game-details/hero/hero-panel-actions.tsx"
  );
  const used = keysUsed(hero, "tMods");
  assert.deepEqual(used, ["button"]);
  assert.ok(hasKey("button"));
});

test("progress stages shown while installing have labels", () => {
  for (const stage of [
    "resolving",
    "downloading",
    "extracting",
    "installing",
  ]) {
    assert.ok(`stage_${stage}` in mods, `missing stage_${stage}`);
  }
});

test("every error code has a message, plus the generic fallbacks", () => {
  const errors = mods.errors as Record<string, string>;
  for (const code of MODS_ERROR_CODES) {
    assert.equal(typeof errors[code], "string", `missing errors.${code}`);
  }
  assert.equal(typeof errors.generic, "string");
  assert.equal(typeof errors.generic_short, "string");
});

test("no hard-coded English is left in the Mods window", () => {
  const modal = read(
    "src/renderer/src/pages/game-details/modals/mods-modal/mods-modal.tsx"
  );
  for (const phrase of [
    "Install",
    "Uninstall",
    "Browse",
    "No mods found",
    "Prev",
  ]) {
    assert.ok(
      !new RegExp(`>\\s*${phrase}\\s*<`).test(modal),
      `"${phrase}" is still hard-coded`
    );
  }
});
