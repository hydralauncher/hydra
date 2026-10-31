import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getLanguageDisplayName,
  getReviewTranslation,
  getReviewTranslationLanguage,
} from "./review-translation.js";

const base = {
  translations: { pt: "Ótimo", en: "Great" },
  detectedLanguage: "en",
  language: "pt-BR",
  isOwnReview: false,
};

describe("getReviewTranslation", () => {
  it("returns the translation for the app base language", () => {
    assert.equal(getReviewTranslation(base), "Ótimo");
  });

  it("keeps the original for the viewer's own review", () => {
    assert.equal(getReviewTranslation({ ...base, isOwnReview: true }), null);
  });

  it("keeps the original when the review is in the app language", () => {
    assert.equal(
      getReviewTranslation({ ...base, detectedLanguage: "pt-PT" }),
      null
    );
  });

  it("keeps the original when there is no translation", () => {
    assert.equal(getReviewTranslation({ ...base, translations: {} }), null);
  });
});

describe("review translation language helpers", () => {
  it("uses the lower-case base language", () => {
    assert.equal(getReviewTranslationLanguage("PT-BR"), "pt");
  });

  it("names a language, or falls back to its code", () => {
    assert.equal(getLanguageDisplayName(null, "en"), "");
    assert.equal(getLanguageDisplayName("en", "en"), "English");
  });
});
