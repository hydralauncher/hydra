import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createInstance } from "i18next";

import { createLanguageApplier } from "./apply-language-core.js";

describe("createLanguageApplier", () => {
  it("recomputes resolvedLanguage when the selected language is already set", async () => {
    const i18n = createInstance();

    await i18n.init({
      resources: { en: { translation: { greeting: "Hello" } } },
      fallbackLng: "en",
      lng: "pt-BR",
    });

    assert.equal(i18n.language, "pt-BR");
    assert.equal(i18n.resolvedLanguage, "en");

    const applyLanguage = createLanguageApplier(i18n, async () => ({
      key: "pt-BR",
      resources: { translation: { greeting: "Olá" } },
    }));

    await applyLanguage("pt-BR");

    assert.equal(i18n.resolvedLanguage, "pt-BR");
    assert.equal(i18n.t("greeting"), "Olá");
  });

  it("applies only the latest language when loads finish out of order", async () => {
    const i18n = createInstance();

    await i18n.init({
      resources: { en: { translation: { greeting: "Hello" } } },
      fallbackLng: "en",
      lng: "en",
    });

    const resolvers = new Map<string, () => void>();
    const locales = {
      fr: { key: "fr", resources: { translation: { greeting: "Bonjour" } } },
      de: { key: "de", resources: { translation: { greeting: "Hallo" } } },
    };
    const applyLanguage = createLanguageApplier(i18n, async (language) => {
      await new Promise<void>((resolve) => resolvers.set(language, resolve));

      return locales[language as keyof typeof locales];
    });

    const french = applyLanguage("fr");
    const german = applyLanguage("de");

    resolvers.get("de")?.();
    await german;

    resolvers.get("fr")?.();
    await french;

    assert.equal(i18n.language, "de");
    assert.equal(i18n.resolvedLanguage, "de");
    assert.equal(i18n.t("greeting"), "Hallo");
  });
});
