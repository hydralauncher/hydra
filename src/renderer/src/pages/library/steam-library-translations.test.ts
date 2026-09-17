import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const STEAM_LIBRARY_KEYS = [
  "category_steam_library",
  "imported_from_steam",
] as const;

const STEAM_SETTINGS_KEYS = ["hide_library_steam_badges"] as const;

describe("Steam Library translations", () => {
  it("defines every Steam Library string in every desktop locale", () => {
    const localesPath = path.resolve(process.cwd(), "src/locales");

    for (const locale of fs.readdirSync(localesPath)) {
      const translationPath = path.join(
        localesPath,
        locale,
        "translation.json"
      );
      if (!fs.existsSync(translationPath)) continue;

      const translation = JSON.parse(fs.readFileSync(translationPath, "utf8"));

      for (const key of STEAM_LIBRARY_KEYS) {
        assert.equal(
          typeof translation.library?.[key],
          "string",
          `${locale} is missing library.${key}`
        );
        assert.ok(
          translation.library[key].trim(),
          `${locale} has an empty library.${key}`
        );
      }

      for (const key of STEAM_SETTINGS_KEYS) {
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

  it("keeps the requested English and Brazilian Portuguese copy", () => {
    const readLibrary = (locale: string) => {
      const translationPath = path.resolve(
        process.cwd(),
        "src/locales",
        locale,
        "translation.json"
      );
      return JSON.parse(fs.readFileSync(translationPath, "utf8")).library;
    };

    assert.deepEqual(
      STEAM_LIBRARY_KEYS.map((key) => readLibrary("en")[key]),
      [
        "Steam Library",
        "Imported from the Steam library linked to this profile.",
      ]
    );
    assert.deepEqual(
      STEAM_LIBRARY_KEYS.map((key) => readLibrary("pt-BR")[key]),
      [
        "Biblioteca Steam",
        "Importado da biblioteca Steam vinculada a este perfil.",
      ]
    );

    const readSettings = (locale: string) => {
      const translationPath = path.resolve(
        process.cwd(),
        "src/locales",
        locale,
        "translation.json"
      );
      return JSON.parse(fs.readFileSync(translationPath, "utf8")).settings;
    };

    assert.equal(
      readSettings("en").hide_library_steam_badges,
      "Hide Steam Library connection badges"
    );
    assert.equal(
      readSettings("pt-BR").hide_library_steam_badges,
      "Ocultar selos da conexão com a biblioteca Steam"
    );
  });
});
