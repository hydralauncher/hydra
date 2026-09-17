import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getGenreLanguage,
  translateGenreName,
  translateGenreNames,
} from "./genre-translation.js";

const genres = {
  en: ["Action", "Adventure", "Beat 'em Up", "Platform"],
  pt: ["Ação", "Aventura", "Briga de Rua", "Plataforma"],
  fr: ["Action", "Aventure", "Beat 'em Up", ""],
};

describe("getGenreLanguage", () => {
  it("keeps only the language part of a locale", () => {
    assert.equal(getGenreLanguage("pt-BR"), "pt");
    assert.equal(getGenreLanguage("en"), "en");
    assert.equal(getGenreLanguage(""), "en");
  });
});

describe("translateGenreName", () => {
  it("maps an English genre to the same index in the requested language", () => {
    assert.equal(
      translateGenreName(genres, "pt", "Beat 'em Up"),
      "Briga de Rua"
    );
    assert.equal(translateGenreName(genres, "pt", "Platform"), "Plataforma");
  });

  it("returns the English name when there is no translation", () => {
    assert.equal(translateGenreName(genres, "en", "Platform"), "Platform");
    assert.equal(translateGenreName(genres, "pt", "Unknown"), "Unknown");
    assert.equal(translateGenreName(genres, "de", "Platform"), "Platform");
    assert.equal(translateGenreName({}, "pt", "Platform"), "Platform");
  });

  it("falls back to English for a blank translation entry", () => {
    assert.equal(translateGenreName(genres, "fr", "Platform"), "Platform");
  });
});

describe("translateGenreNames", () => {
  it("translates every name in order", () => {
    assert.deepEqual(
      translateGenreNames(genres, "pt", ["Action", "Platform", "Other"]),
      ["Ação", "Plataforma", "Other"]
    );
  });
});
