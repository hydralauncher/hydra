import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";

import type { EmulatorSystem } from "@types";
import { DISC_CLOUD_SAVE_EMULATOR_SYSTEMS } from "../../../../../shared/cloud-save-emulator-provider.js";

import { EMULATOR_SAVE_LOCATION_KEY_PREFIXES } from "./emulator-save-location-keys.js";

it("has every save location string in the English locale", () => {
  const { settings: strings } = JSON.parse(
    readFileSync(
      new URL("../../../../../locales/en/translation.json", import.meta.url),
      "utf8"
    )
  ) as { settings: Record<string, string> };
  const suffixes = [
    "title",
    "description",
    "ready",
    "not-configured",
    "missing",
    "ambiguous",
    "invalid-selection",
    "checking",
    "error",
    "no_folder",
    "browse",
    "invalid_selection",
  ];

  for (const system of DISC_CLOUD_SAVE_EMULATOR_SYSTEMS as EmulatorSystem[]) {
    const keyPrefix = (
      EMULATOR_SAVE_LOCATION_KEY_PREFIXES as Partial<
        Record<EmulatorSystem, string>
      >
    )[system];
    assert.ok(keyPrefix, `no save location keys for ${system}`);
    for (const suffix of suffixes) {
      const key = `${keyPrefix}_${suffix}`;
      assert.ok(strings[key], `missing en string ${key}`);
    }
  }
});
