import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";

import { createInstance } from "i18next";

import { registerBigPictureI18nResources } from "./locales/register-resources.js";

describe("Big Picture i18n resources", () => {
  it("resolves similar-game copy from the namespace root", async () => {
    const languages = ["en", "es", "fr", "pt-BR", "ru"] as const;
    const resourcesByLanguage = Object.fromEntries(
      await Promise.all(
        languages.map(async (language) => {
          const locale = JSON.parse(
            await readFile(
              new URL(
                `./locales/${language}/translation.json`,
                import.meta.url
              ),
              "utf8"
            )
          ) as { format: Record<string, string> };

          return [language, locale.format];
        })
      )
    );
    const i18next = createInstance();

    await i18next.init({
      fallbackLng: "en",
      lng: "en",
      resources: {},
    });

    registerBigPictureI18nResources(i18next, resourcesByLanguage);

    const translations = {
      en: ["More like this", "No similar games found"],
      es: ["Juegos similares", "No se encontraron juegos similares"],
      fr: ["Jeux similaires", "Aucun jeu similaire trouvé"],
      "pt-BR": ["Ver similares", "Nenhum jogo similar encontrado"],
      ru: ["Похожие игры", "Похожие игры не найдены"],
    } as const;

    for (const [language, [heading, emptyState]] of Object.entries(
      translations
    )) {
      await i18next.changeLanguage(language);

      assert.equal(i18next.t("similar_games", { ns: "big_picture" }), heading);
      assert.equal(
        i18next.t("no_similar_games", { ns: "big_picture" }),
        emptyState
      );
    }
  });
});
