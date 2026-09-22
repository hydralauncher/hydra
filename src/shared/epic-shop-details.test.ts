import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mapEpicShopDetails,
  type EpicShopDetailsResponse,
} from "./epic-shop-details.js";

const response: EpicShopDetailsResponse = {
  game: {
    title: "Primary title",
    description: "<p>Primary description</p>",
    developers: ["Studio A", "Studio B"],
    publisher: "Publisher",
    genres: ["Action"],
    supportedLanguages: ["English<strong>*</strong>", "French"],
    requirements: { windows: { minimum: "<p>8 GB</p>" } },
  },
};

describe("Epic shop details", () => {
  it("uses the requested Epic page without a fake Steam ID", () => {
    const mapped = mapEpicShopDetails(response, "en-US", {
      shop: "epic",
      objectId: "123",
    });

    assert.equal(mapped.objectId, "123");
    assert.equal(mapped.assets?.shop, "epic");
    assert.equal(mapped.name, "Primary title");
    assert.equal(mapped.about_the_game, "<p>Primary description</p>");
    assert.equal("steam_appid" in mapped, false);
  });

  it("keeps requirements and provider arrays", () => {
    const mapped = mapEpicShopDetails(response, "en-US", {
      shop: "epic",
      objectId: "123",
    });

    assert.deepEqual(mapped.developers, ["Studio A", "Studio B"]);
    assert.deepEqual(mapped.publishers, ["Publisher"]);
    assert.equal(
      mapped.supported_languages,
      "English<strong>*</strong>, French"
    );
    assert.deepEqual(mapped.pc_requirements, {
      minimum: "<p>8 GB</p>",
      recommended: "",
    });
    assert.equal(mapped.controller_support, undefined);
    assert.equal(mapped.movies, undefined);
  });

  it("handles missing or malformed optional metadata", () => {
    const mapped = mapEpicShopDetails(
      {
        game: {
          title: "Bare game",
          genres: 3,
          requirements: [],
          screenshots: [false, "https://example.com/image.png"],
        },
      },
      "fr",
      { shop: "epic", objectId: "123" }
    );

    assert.deepEqual(mapped.genres, []);
    assert.deepEqual(mapped.pc_requirements, { minimum: "", recommended: "" });
    assert.equal(mapped.screenshots?.length, 1);
    assert.equal(mapped.descriptionLanguage, "fr");
  });
});
