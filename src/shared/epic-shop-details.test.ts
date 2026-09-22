import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mapEpicShopDetails,
  type EpicShopDetailsResponse,
} from "./epic-shop-details.js";

const response: EpicShopDetailsResponse = {
  game: {
    title: "Primary title",
    description:
      "<!--image--> [![Banner](https://example.com/banner.png)](/discover/example) <!--textBlock--> <!--title--> # Primary description <!--text--> **Formatted text** • First item • Second item",
    shortDescription: "Plain summary",
    developers: ["Studio A", "Studio B"],
    publisher: "Publisher",
    genres: ["Action"],
    supportedLanguages: ["English<strong>*</strong>", "French"],
    requirements: {
      minimum: "OS version: Windows 10\nMemory: 8 GB",
      recommended: "Memory: 16 GB",
    },
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
    assert.match(mapped.about_the_game, /<h1>Primary description<\/h1>/);
    assert.match(
      mapped.about_the_game,
      /<a href="\/discover\/example"><img src="https:\/\/example\.com\/banner\.png" alt="Banner"><\/a>/
    );
    assert.match(mapped.about_the_game, /<strong>Formatted text<\/strong>/);
    assert.match(mapped.about_the_game, /<li>First item<\/li>/);
    assert.match(mapped.about_the_game, /<li>Second item<\/li>/);
    assert.doesNotMatch(mapped.about_the_game, /textBlock/);
    assert.equal(mapped.short_description, "Plain summary");
    assert.equal("steam_appid" in mapped, false);
  });

  it("escapes raw HTML in Epic descriptions", () => {
    const mapped = mapEpicShopDetails(
      {
        game: {
          title: "Unsafe description",
          description: '<script>alert("unsafe")</script>',
        },
      },
      "en-US",
      { shop: "epic", objectId: "123" }
    );

    assert.doesNotMatch(mapped.about_the_game, /<script>/);
    assert.match(mapped.about_the_game, /&lt;script&gt;/);
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
      minimum: "OS version: Windows 10\nMemory: 8 GB",
      recommended: "Memory: 16 GB",
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
