import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

type Labels = Record<"en" | "fr" | "pt-BR", string>;

const LABELS: Record<string, Labels> = {
  "sidebar.play_later": {
    en: "Play later",
    fr: "À jouer plus tard",
    "pt-BR": "Jogar depois",
  },
  "game_details.add_to_play_later": {
    en: "Add to Play later",
    fr: "Ajouter à À jouer plus tard",
    "pt-BR": "Adicionar a Jogar depois",
  },
  "game_details.remove_from_play_later": {
    en: "Remove from Play later",
    fr: "Retirer de À jouer plus tard",
    "pt-BR": "Remover de Jogar depois",
  },
  "play_later.title": {
    en: "Play later",
    fr: "À jouer plus tard",
    "pt-BR": "Jogar depois",
  },
  "play_later.sort_by_date_added": {
    en: "Date added",
    fr: "Date d'ajout",
    "pt-BR": "Data de adição",
  },
  "play_later.sort_by_name": { en: "Name", fr: "Nom", "pt-BR": "Nome" },
  "play_later.added_on": {
    en: "Added on {{date}}",
    fr: "Ajouté le {{date}}",
    "pt-BR": "Adicionado em {{date}}",
  },
  "play_later.remove": {
    en: "Remove {{title}} from Play later",
    fr: "Retirer {{title}} de À jouer plus tard",
    "pt-BR": "Remover {{title}} de Jogar depois",
  },
  "play_later.empty_title": {
    en: "Nothing here yet",
    fr: "Rien pour l'instant",
    "pt-BR": "Nada aqui ainda",
  },
  "play_later.empty_description": {
    en: "Use the bookmark on a game's page to save it for later.",
    fr: "Utilisez le marque-page sur la fiche d'un jeu pour le garder pour plus tard.",
    "pt-BR": "Use o marcador na página de um jogo para salvá-lo para depois.",
  },
  "play_later.update_failed": {
    en: "Couldn't update Play later",
    fr: "Impossible de mettre à jour À jouer plus tard",
    "pt-BR": "Não foi possível atualizar Jogar depois",
  },
  "play_later.load_failed": {
    en: "Couldn't load Play later",
    fr: "Impossible de charger À jouer plus tard",
    "pt-BR": "Não foi possível carregar Jogar depois",
  },
};

const readTranslation = (locale: string) =>
  JSON.parse(
    fs.readFileSync(
      path.resolve(process.cwd(), "src/locales", locale, "translation.json"),
      "utf8"
    )
  );

describe("Play later translations", () => {
  it("defines every Play later label in en, fr and pt-BR", () => {
    for (const locale of ["en", "fr", "pt-BR"] as const) {
      const translation = readTranslation(locale);

      for (const [key, labels] of Object.entries(LABELS)) {
        const [namespace, name] = key.split(".");
        assert.equal(
          translation[namespace]?.[name],
          labels[locale],
          `${locale}: ${key}`
        );
      }
    }
  });
});
