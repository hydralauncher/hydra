import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getStoreDetailsWithFallback,
  formatEpicDescription,
  mapEpicShopDetails,
  sanitizeEpicHtml,
  type EpicShopDetails,
} from "./store-shop-details.js";

const epic: EpicShopDetails = {
  title: "Game",
  description: "<p>Descrição longa</p>",
  shortDescription: "Short",
  developer: null,
  publisher: "Publisher",
  genres: ["Action"],
  releaseDate: "2023-10-27",
  screenshots: ["https://example.com/image.jpg"],
  requirements: { minimum: "Windows 10" },
  supportedLanguages: ["English", "Portuguese"],
  images: {
    cover: "https://example.com/cover.jpg",
    hero: "https://example.com/hero.jpg",
    logo: "https://example.com/logo.png",
  },
  videos: [
    {
      id: "hls",
      title: "Trailer",
      thumbnailUrl: null,
      url: "https://example.com/trailer.m3u8",
      contentType: "application/x-mpegURL",
    },
    {
      id: "webm",
      title: null,
      thumbnailUrl: null,
      url: "https://example.com/trailer.webm",
      contentType: "video/webm",
    },
    {
      id: "mp4",
      title: null,
      thumbnailUrl: null,
      url: "https://example.com/trailer.mp4",
      contentType: "video/mp4",
    },
  ],
};

describe("store-first details", () => {
  it("awaits the store even when cached content exists", async () => {
    let resolve!: (value: string) => void;
    let settled = false;
    let databaseCalled = false;
    const store = new Promise<string>((done) => {
      resolve = done;
    });
    const result = getStoreDetailsWithFallback(
      () => store,
      async () => {
        databaseCalled = true;
        return "database";
      },
      "cache"
    );
    void result.then(() => {
      settled = true;
    });
    await Promise.resolve();
    assert.equal(settled, false);
    resolve("fresh");
    assert.equal(await result, "fresh");
    assert.equal(databaseCalled, false);
  });

  it("uses database content before local cache when the store fails", async () => {
    const result = await getStoreDetailsWithFallback(
      async () => {
        throw new Error("store offline");
      },
      async () => "database",
      "cache"
    );
    assert.equal(result, "database");
  });

  it("uses cache when store and database are unavailable", async () => {
    assert.equal(
      await getStoreDetailsWithFallback(
        async () => null,
        async () => {
          throw new Error("database offline");
        },
        "cache"
      ),
      "cache"
    );
  });

  it("returns null when all sources are empty", async () => {
    assert.equal(
      await getStoreDetailsWithFallback(
        async () => null,
        async () => null,
        null
      ),
      null
    );
  });
});

describe("Epic details mapping", () => {
  it("renders Horizon Chase 2 Markdown from the live Epic store", () => {
    const description =
      "<!--textBlock-->\n<!--title-->\n# CORRIDA PARA TODOS\n\n<!--text-->\n**Horizon Chase 2** é uma corrida.\n\n*Fácil de jogar*, difícil de dominar.\n\n* Arcade\n* Multijogador";
    const result = mapEpicShopDetails("id", { ...epic, description }, "pt");
    assert.match(result.detailed_description, /<h1>CORRIDA PARA TODOS<\/h1>/);
    assert.match(
      result.detailed_description,
      /<strong>Horizon Chase 2<\/strong>/
    );
    assert.match(result.detailed_description, /<em>Fácil de jogar<\/em>/);
    assert.match(
      result.detailed_description,
      /<ul>\s*<li>Arcade<\/li>\s*<li>Multijogador<\/li>\s*<\/ul>/
    );
    assert.ok(!result.detailed_description.includes("**"));
    assert.ok(!result.detailed_description.includes("<!--"));
  });

  it("preserves formatted API fallback HTML without double encoding", async () => {
    const description =
      "<p><strong>Horizon Chase 2</strong> &amp; amigos</p>\n<ul>\n<li>Arcade</li>\n</ul>";
    const result = await getStoreDetailsWithFallback(
      async () => null,
      async () => mapEpicShopDetails("id", { ...epic, description }, "pt"),
      null
    );
    assert.equal(result?.detailed_description, description);
    assert.equal(formatEpicDescription(description), description);
  });

  it("renders BioShock bullets and sanitizes embedded HTML in Markdown", () => {
    const result = formatEpicDescription(
      'Também inclui:\n\n• Museu\n• Salas\n\n**Seguro** <img src="javascript:alert(1)" onerror="alert(2)"><script>alert(3)</script>'
    );
    assert.match(result, /<li>Museu<\/li>/);
    assert.match(result, /<li>Salas<\/li>/);
    assert.match(result, /<strong>Seguro<\/strong>/);
    assert.doesNotMatch(result, /javascript:|onerror|<script|alert\(/);
  });

  it("formats legacy cached Markdown and remains stable on repeated reads", () => {
    const cached =
      "CORRIDA PARA TODOS<br><br>**Horizon Chase 2** é uma corrida.";
    const formatted = formatEpicDescription(cached);
    assert.match(formatted, /<strong>Horizon Chase 2<\/strong>/);
    assert.doesNotMatch(formatted, /\*\*/);
    assert.equal(formatEpicDescription(formatted), formatted);
  });

  it("sanitizes mapped description fields without escaping entities again", () => {
    const mapped = mapEpicShopDetails(
      "namespace:item",
      {
        ...epic,
        description: "First & second",
        shortDescription: "Short & sweet",
      },
      "en"
    );
    for (const field of [
      "detailed_description",
      "about_the_game",
      "short_description",
    ] as const) {
      const cached = sanitizeEpicHtml(mapped[field]);
      assert.equal(cached, mapped[field]);
      assert.ok(!cached.includes("&amp;amp;"));
    }
    assert.equal(
      sanitizeEpicHtml(mapped.detailed_description),
      "<p>First &amp; second</p>"
    );
    assert.equal(
      sanitizeEpicHtml(
        '<a href="https://store.epicgames.com">Text &amp; image<img src="https://example.com/image.jpg"></a>'
      ),
      'Text &amp; image<img src="https://example.com/image.jpg">'
    );
  });
  it("keeps the actual content language when English is returned for another locale", () => {
    assert.equal(
      mapEpicShopDetails("id", { ...epic, descriptionLanguage: "en" }, "de")
        .descriptionLanguage,
      "en"
    );
  });
  it("removes executable HTML while preserving safe store media and text", () => {
    const data = {
      ...epic,
      description:
        '<p onclick="alert(1)">Text</p><script>alert(2)</script><img src="https://example.com/art.jpg" onerror="alert(3)"><a href="javascript:alert(4)">Link</a><svg onload="alert(5)"></svg><iframe src="https://example.com"></iframe>',
    };
    assert.equal(
      mapEpicShopDetails("id", data, "en").detailed_description,
      '<p>Text</p><img src="https://example.com/art.jpg">Link'
    );
  });

  it("sanitizes summary HTML even when the long description is safe", () => {
    const result = mapEpicShopDetails(
      "id",
      {
        ...epic,
        shortDescription:
          '<strong>Summary</strong><img src="https://example.com/art.jpg" onerror="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)">Link</a>',
      },
      "en"
    );
    assert.equal(result.detailed_description, epic.description);
    assert.equal(
      result.short_description,
      '<strong>Summary</strong><img src="https://example.com/art.jpg">Link'
    );
    assert.equal(
      mapEpicShopDetails("id", { ...epic, shortDescription: null }, "en")
        .short_description,
      ""
    );
  });
  it("renders both persisted and live plain requirements as escaped HTML lists", () => {
    const data = {
      ...epic,
      requirements: {
        minimum: "OS: Windows 10\nMemory: 8 GB & more",
        recommended: '<ul><li onmouseover="alert(1)">16 GB</li></ul>',
      },
    };
    const result = mapEpicShopDetails("id", data, "en");
    assert.equal(
      result.pc_requirements.minimum,
      "<ul><li>OS: Windows 10</li><li>Memory: 8 GB &amp; more</li></ul>"
    );
    assert.equal(result.pc_requirements.recommended, "<ul><li>16 GB</li></ul>");
  });
  it("preserves linked images and text without clickable store links", () => {
    const data = {
      ...epic,
      description:
        "[![Vbucks](https://cdn2.unrealengine.com/banner.png)](/discover/v-bucks)\n[Store](https://store.epicgames.com)",
    };
    assert.equal(
      mapEpicShopDetails("id", data, "pt").detailed_description,
      '<p><img src="https://cdn2.unrealengine.com/banner.png" alt="Vbucks">\nStore</p>'
    );
  });
  it("renders Markdown store images without allowing attribute injection", () => {
    const data = {
      ...epic,
      description:
        '![KeyArt "Image"](https://cdn1.epicgames.com/art.jpg)\nSeason text',
    };
    assert.equal(
      mapEpicShopDetails("id", data, "en").detailed_description,
      '<p><img src="https://cdn1.epicgames.com/art.jpg" alt="KeyArt &quot;Image&quot;">\nSeason text</p>'
    );
    const invalid = { ...epic, description: "![Image](javascript:alert)" };
    assert.equal(
      mapEpicShopDetails("id", invalid, "en").detailed_description,
      "<p>![Image](javascript:alert)</p>"
    );
  });
  it("formats ISO release dates in the requested locale without shifting the day", () => {
    const data = { ...epic, releaseDate: "2023-10-27T04:00:00.000Z" };
    assert.equal(
      mapEpicShopDetails("id", data, "pt").release_date.date,
      "27 de outubro de 2023"
    );
    assert.equal(
      mapEpicShopDetails("id", data, "en").release_date.date,
      "October 27, 2023"
    );
  });

  it("renders plain Epic text with paragraph breaks and escapes markup", () => {
    const data = {
      ...epic,
      description:
        "<!--textBlock-->\n<!--text-->\nFirst & second\n==== Heading\nText < 5",
    };
    assert.equal(
      mapEpicShopDetails("id", data, "en").detailed_description,
      "<p>First &amp; second</p>\n<p>Heading\nText &lt; 5</p>"
    );
  });

  it("preserves long HTML, locale, requirements and store-specific artwork", () => {
    const result = mapEpicShopDetails("namespace:item", epic, "pt-BR");
    assert.equal(result.detailed_description, epic.description);
    assert.equal(result.descriptionLanguage, "pt-BR");
    assert.deepEqual(result.developers, []);
    assert.deepEqual(result.publishers, ["Publisher"]);
    assert.equal(
      result.pc_requirements.minimum,
      "<ul><li>Windows 10</li></ul>"
    );
    assert.equal(result.assets?.shop, "epic");
    assert.equal(result.assets?.libraryHeroImageUrl, epic.images.hero);
    assert.equal(result.assets?.logoImageUrl, epic.images.logo);
    assert.equal(result.screenshots?.[0].path_full, epic.screenshots[0]);
  });

  it("uses the summary only when long description is absent", () => {
    assert.equal(
      mapEpicShopDetails("namespace:item", { ...epic, description: null }, "en")
        .detailed_description,
      "<p>Short</p>"
    );
  });

  it("maps HLS, WebM and MP4 into the existing gallery contract", () => {
    const result = mapEpicShopDetails("namespace:item", epic, "en");
    assert.equal(result.movies?.[0].hls_h264, epic.videos?.[0].url);
    assert.equal(result.movies?.[1].webm?.max, epic.videos?.[1].url);
    assert.equal(result.movies?.[2].mp4?.max, epic.videos?.[2].url);
    assert.equal(result.movies?.[0].thumbnail, epic.images.cover);
  });
});
