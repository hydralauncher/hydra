import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const INTEGRATION_DISPLAY_KEYS = [
  "integration_connect",
  "integration_disconnect",
  "integration_reconnect",
  "integration_status_not_connected",
  "integration_sync",
  "retroachievements_connect_title",
  "retroachievements_status_invalid_credentials",
  "retroachievements_invalid_credentials_description",
  "retroachievements_last_checked",
  "steam_status_reconnect_required",
] as const;

describe("integration translations", () => {
  it("defines every displayed integration key in every desktop locale", () => {
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

      for (const key of INTEGRATION_DISPLAY_KEYS) {
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
