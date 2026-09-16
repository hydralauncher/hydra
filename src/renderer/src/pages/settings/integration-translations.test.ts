import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const SHARED_ACTION_KEYS = [
  "integration_connect",
  "integration_disconnect",
  "integration_reconnect",
  "integration_sync",
] as const;

describe("integration action translations", () => {
  it("defines every shared action in every desktop locale", () => {
    const localesPath = path.resolve(process.cwd(), "src/locales");
    const locales = fs.readdirSync(localesPath);

    for (const locale of locales) {
      const translationPath = path.join(
        localesPath,
        locale,
        "translation.json"
      );
      if (!fs.existsSync(translationPath)) continue;

      const translation = JSON.parse(fs.readFileSync(translationPath, "utf8"));

      for (const key of SHARED_ACTION_KEYS) {
        assert.equal(
          typeof translation.settings?.[key],
          "string",
          `${locale} is missing settings.${key}`
        );
        assert.ok(
          translation.settings[key].trim(),
          `${locale} has an empty settings.${key}`
        );
      }
    }
  });
});
