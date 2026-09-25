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
    supportedLanguages: [
      "English<strong>*</strong>",
      "French",
      "Spanish (Latin America, Spain)",
    ],
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
    assert.match(
      mapped.about_the_game,
      /<h1 class="epic-description-heading">Primary description<\/h1>/
    );
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

  it("formats requirements and keeps provider arrays", () => {
    const mapped = mapEpicShopDetails(response, "en-US", {
      shop: "epic",
      objectId: "123",
    });

    assert.deepEqual(mapped.developers, ["Studio A", "Studio B"]);
    assert.deepEqual(mapped.publishers, ["Publisher"]);
    assert.equal(
      mapped.supported_languages,
      "English<strong>*</strong>, French, Spanish (Latin America, Spain)"
    );
    assert.deepEqual(mapped.supportedLanguages, [
      "English<strong>*</strong>",
      "French",
      "Spanish (Latin America, Spain)",
    ]);
    assert.deepEqual(mapped.pc_requirements, {
      minimum:
        "<ul><li><strong>OS version</strong><span>Windows 10</span></li><li><strong>Memory</strong><span>8 GB</span></li></ul>",
      recommended:
        "<ul><li><strong>Memory</strong><span>16 GB</span></li></ul>",
    });
    assert.equal(mapped.controller_support, undefined);
    assert.equal(mapped.movies, undefined);
  });

  it("escapes requirement HTML and preserves colons in values", () => {
    const mapped = mapEpicShopDetails(
      {
        game: {
          requirements: {
            minimum:
              "OS: Windows <11>\nStorage: SSD: 90 GB\n\nNotes without label",
            recommended: "Unsafe: <script>alert('xss')</script>",
          },
        },
      },
      "en-US",
      { shop: "epic", objectId: "123" }
    );

    assert.equal(
      mapped.pc_requirements.minimum,
      "<ul><li><strong>OS</strong><span>Windows &lt;11&gt;</span></li><li><strong>Storage</strong><span>SSD: 90 GB</span></li><li><span>Notes without label</span></li></ul>"
    );
    assert.equal(
      mapped.pc_requirements.recommended,
      "<ul><li><strong>Unsafe</strong><span>&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;</span></li></ul>"
    );
  });

  it("maps Epic videos to the gallery movie contract", () => {
    const mapped = mapEpicShopDetails(
      {
        game: {
          title: "Video game",
          screenshots: ["https://example.com/screenshot.jpg"],
          assets: {
            libraryHeroImageUrl: "https://example.com/hero.jpg",
          },
          videos: [
            {
              id: "hls-video",
              title: "HLS trailer",
              thumbnailUrl: "https://example.com/trailer.jpg",
              url: "https://example.com/trailer.m3u8",
              contentType: "application/x-mpegURL",
            },
            {
              id: "mp4-video",
              title: null,
              thumbnailUrl: null,
              url: "https://example.com/trailer.mp4",
              contentType: "video/mp4; charset=utf-8",
            },
            {
              id: "webm-video",
              url: "https://example.com/trailer.webm",
              contentType: "video/webm",
            },
            {
              id: "unsupported-video",
              url: "https://example.com/trailer.mov",
              contentType: "video/quicktime",
            },
            {
              url: "https://example.com/missing-id.mp4",
              contentType: "video/mp4",
            },
          ],
        },
      },
      "en-US",
      { shop: "epic", objectId: "namespace:item" }
    );

    assert.deepEqual(mapped.movies, [
      {
        id: "hls-video",
        name: "HLS trailer",
        thumbnail: "https://example.com/trailer.jpg",
        highlight: false,
        hls_h264: "https://example.com/trailer.m3u8",
      },
      {
        id: "mp4-video",
        name: "",
        thumbnail: "https://example.com/hero.jpg",
        highlight: false,
        mp4: {
          max: "https://example.com/trailer.mp4",
          "480": "https://example.com/trailer.mp4",
        },
      },
      {
        id: "webm-video",
        name: "",
        thumbnail: "https://example.com/hero.jpg",
        highlight: false,
        webm: {
          max: "https://example.com/trailer.webm",
          "480": "https://example.com/trailer.webm",
        },
      },
    ]);
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
