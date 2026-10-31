import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const GAME_DETAILS_KEYS = [
  "hide_game",
  "unhide_game",
  "conceal_game",
  "reveal_game",
  "game_visibility_updated",
  "failed_update_game_visibility",
] as const;

const LIBRARY_KEYS = [
  "hidden_games",
  "hidden_from_others_tooltip",
  "hidden_game_tooltip",
  "empty_hidden_title",
  "empty_hidden_description",
  "hidden_games_load_failed",
  "retry_hidden_games",
] as const;

const readTranslation = (locale: string) => {
  const filename = path.resolve(
    process.cwd(),
    "src/locales",
    locale,
    "translation.json"
  );
  return JSON.parse(fs.readFileSync(filename, "utf8"));
};

describe("game visibility translations", () => {
  it("defines distinct actions and supporting text in every locale", () => {
    const localesPath = path.resolve(process.cwd(), "src/locales");
    const locales = fs
      .readdirSync(localesPath)
      .filter((locale) =>
        fs.existsSync(path.join(localesPath, locale, "translation.json"))
      );

    for (const locale of locales) {
      const translation = readTranslation(locale);

      for (const key of GAME_DETAILS_KEYS) {
        assert.ok(
          translation.game_details?.[key]?.trim(),
          `${locale} is missing game_details.${key}`
        );
      }

      for (const key of LIBRARY_KEYS) {
        assert.ok(
          translation.library?.[key]?.trim(),
          `${locale} is missing library.${key}`
        );
      }

      assert.notEqual(
        translation.game_details.hide_game,
        translation.game_details.conceal_game,
        `${locale} gives both actions the same label`
      );
      assert.notEqual(
        translation.game_details.unhide_game,
        translation.game_details.reveal_game,
        `${locale} gives both inverse actions the same label`
      );
    }
  });

  it("keeps the agreed short English and Brazilian Portuguese menu copy", () => {
    const en = readTranslation("en");
    const ptBR = readTranslation("pt-BR");

    assert.deepEqual(
      GAME_DETAILS_KEYS.slice(0, 4).map((key) => en.game_details[key]),
      ["Hide", "Unhide", "Conceal", "Reveal"]
    );
    assert.deepEqual(
      GAME_DETAILS_KEYS.slice(0, 4).map((key) => ptBR.game_details[key]),
      ["Esconder", "Deixar de esconder", "Ocultar", "Desocultar"]
    );
    assert.equal(en.library.hidden_games, "Concealed games");
    assert.doesNotMatch(en.library.empty_hidden_description, /move/i);
  });

  it("explains that concealed games are only visible in the concealed collection", () => {
    const en = readTranslation("en");
    const ptBR = readTranslation("pt-BR");

    assert.match(en.library.hidden_game_tooltip, /can only be seen in/);
    assert.match(ptBR.library.hidden_game_tooltip, /só pode ser visto em/);

    for (const translation of [en, ptBR]) {
      assert.ok(
        translation.library.hidden_game_tooltip.includes(
          translation.library.hidden_games
        )
      );
      assert.notEqual(
        translation.library.hidden_game_tooltip,
        translation.library.hidden_from_others_tooltip
      );
    }
  });
});
