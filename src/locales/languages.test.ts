import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { languageKeys, languageNames, resolveLanguage } from "./languages.js";

describe("languages", () => {
  it("lists every locale translation directory", () => {
    const locales = readdirSync(new URL(".", import.meta.url), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    assert.deepEqual([...languageKeys].sort(), locales);
    assert.equal(languageNames.en, "English");
  });

  it("keeps native names aligned with the translation files", () => {
    for (const language of languageKeys) {
      const translation = JSON.parse(
        readFileSync(
          new URL(`./${language}/translation.json`, import.meta.url),
          "utf8"
        )
      ) as { language_name: string };

      assert.equal(languageNames[language], translation.language_name);
    }
  });

  it("resolves exact, base and fallback languages", () => {
    assert.equal(resolveLanguage("pt-BR"), "pt-BR");
    assert.equal(resolveLanguage("pt"), "pt-BR");
    assert.equal(resolveLanguage("en-US"), "en");
    assert.equal(resolveLanguage("unknown"), "en");
    assert.equal(resolveLanguage(null), "en");
  });
});
