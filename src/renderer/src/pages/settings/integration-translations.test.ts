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

const INTEGRATION_SOURCE_FILES = [
  "src/renderer/src/pages/settings/settings-steam.tsx",
  "src/renderer/src/pages/settings/settings-steam-state.ts",
  "src/renderer/src/pages/settings/settings-retroachievements.tsx",
  "src/renderer/src/pages/retroachievements-connection-window/retroachievements-connection-window.tsx",
] as const;

const LANGUAGE_NEUTRAL_KEYS = new Set([
  "retroachievements",
  "steam",
  "steam_sync_progress",
]);

const readSettingsTranslations = (locale: string) => {
  const translationPath = path.resolve(
    process.cwd(),
    "src/locales",
    locale,
    "translation.json"
  );

  return JSON.parse(fs.readFileSync(translationPath, "utf8"))
    .settings as Record<string, string>;
};

const getIntegrationKeys = () => {
  const keys = new Set(["cancel", "retroachievements", "steam"]);
  const integrationKeyPattern =
    /["']((?:integration|retroachievements|steam)_[a-z0-9_]+)["']/g;

  for (const sourceFile of INTEGRATION_SOURCE_FILES) {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), sourceFile),
      "utf8"
    );

    for (const match of source.matchAll(integrationKeyPattern)) {
      keys.add(match[1]);
    }
  }

  return keys;
};

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

  it("keeps every integration copy translated in pt-BR", () => {
    const english = readSettingsTranslations("en");
    const portuguese = readSettingsTranslations("pt-BR");

    for (const key of getIntegrationKeys()) {
      assert.equal(
        typeof portuguese[key],
        "string",
        `pt-BR is missing settings.${key}`
      );
      assert.ok(portuguese[key].trim(), `pt-BR has an empty settings.${key}`);

      if (!LANGUAGE_NEUTRAL_KEYS.has(key)) {
        assert.notEqual(
          portuguese[key],
          english[key],
          `settings.${key} still uses the English copy in pt-BR`
        );
      }
    }
  });
});
