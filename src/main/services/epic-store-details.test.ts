import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getEpicStoreDetails } from "./epic-store-details.js";
import {
  mapEpicShopDetails,
  getStoreDetailsWithFallback,
} from "./store-shop-details.js";

const offer = {
  id: "offer",
  namespace: "sandbox",
  title: "Game Special Edition",
  longDescription: "<p>Long description</p>",
  description: "Short",
  items: [{ namespace: "sandbox", id: "item" }],
  developerDisplayName: "Developer",
  publisherDisplayName: "Publisher",
  tags: [{ id: "1336", name: "Action-Adventure" }],
  keyImages: [
    { type: "OfferImageTall", url: "https://example.com/cover.jpg" },
    { type: "GalleryImage", url: "https://example.com/image.jpg" },
    {
      type: "heroCarouselVideo",
      url: "com.epicgames.video://video?cover=https%3A%2F%2Fexample.com%2Fthumb.jpg",
    },
  ],
};
function storefront(
  offers = [offer],
  supportedText = ["English"],
  supportedAudio: string[] = []
) {
  const calls: { url: string; locale?: string }[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const { query, variables } = JSON.parse(String(init?.body));
    calls.push({ url: String(url), locale: variables.locale });
    let data: unknown;
    if (query.includes("fetchVideoByLocale"))
      data = {
        Video: {
          fetchVideoByLocale: [{ recipe: "video-hls", mediaRefId: "media" }],
        },
      };
    else if (query.includes("getMediaRef"))
      data = {
        Media: {
          getMediaRef: {
            outputs: [
              {
                key: "manifest",
                url: "https://example.com/video.m3u8",
                contentType: "application/x-mpegURL",
              },
            ],
          },
        },
      };
    else
      data = {
        Catalog: { catalogOffers: { elements: offers } },
        Product: {
          sandbox: {
            configuration: [
              {
                configs: {
                  supportedText,
                  supportedAudio,
                  technicalRequirements: {
                    windows: [{ title: "OS", minimum: "Windows 10" }],
                  },
                },
              },
            ],
          },
        },
      };
    return Response.json({ data });
  };
  return { calls, fetchImpl };
}

describe("direct Epic store details", () => {
  it("identifies English content when the requested locale is outside this delivery", async () => {
    const { calls, fetchImpl } = storefront();
    const result = await getEpicStoreDetails("sandbox:item", "de", fetchImpl);
    assert.equal(calls[0].locale, "en-US");
    assert.equal(result?.descriptionLanguage, "en");
  });
  it("keeps game details and successful trailers when another trailer fails", async () => {
    const broken = {
      ...offer,
      keyImages: [
        ...offer.keyImages,
        { type: "heroCarouselVideo", url: "com.epicgames.video://broken" },
      ],
    };
    const { fetchImpl: normalFetch } = storefront([broken]);
    const fetchImpl: typeof fetch = async (url, init) => {
      const { variables } = JSON.parse(String(init?.body));
      if (variables.videoId === "broken")
        throw new Error("Unavailable trailer");
      return normalFetch(url, init);
    };
    const result = await getEpicStoreDetails("sandbox:item", "en", fetchImpl);
    assert.equal(result?.description, offer.longDescription);
    assert.equal(result?.videos?.length, 1);
    assert.equal(result?.videos?.[0].url, "https://example.com/video.m3u8");
    assert.deepEqual(result?.screenshots, ["https://example.com/image.jpg"]);
  });
  it("requests Epic directly in the user's language and resolves media", async () => {
    const { calls, fetchImpl } = storefront();
    const result = await getEpicStoreDetails(
      "sandbox:item",
      "pt-BR",
      fetchImpl
    );
    assert.equal(result?.description, "<p>Long description</p>");
    assert.equal(result?.title, "Game Special Edition");
    assert.deepEqual(result?.genres, ["Action", "Adventure"]);
    assert.equal(result?.videos?.[0].url, "https://example.com/video.m3u8");
    assert.equal(result?.requirements?.minimum, "OS: Windows 10");
    assert.ok(
      calls.every(
        (call) => call.url === "https://launcher.store.epicgames.com/graphql"
      )
    );
    assert.equal(calls[0].locale, "pt-BR");
  });

  it("preserves audio markers through the existing shop-details contract", async () => {
    const { fetchImpl } = storefront(
      undefined,
      ["English", "French", " Unsafe <language> & text "],
      ["english", " Spanish ", " "]
    );
    const result = await getEpicStoreDetails("sandbox:item", "en", fetchImpl);
    assert.ok(result);
    assert.deepEqual(result.supportedLanguages, [
      "English<strong>*</strong>",
      "French",
      "Unsafe &lt;language&gt; &amp; text",
      "english<strong>*</strong>",
      "Spanish<strong>*</strong>",
    ]);
    const mapped = mapEpicShopDetails("sandbox:item", result, "en");
    const languages = mapped.supported_languages.split(", ");
    assert.equal(
      languages.find((name) => name.startsWith("English"))?.includes("*"),
      true
    );
    assert.equal(
      languages.find((name) => name.startsWith("French"))?.includes("*"),
      false
    );
    assert.equal(
      languages.find((name) => name.startsWith("Spanish"))?.includes("*"),
      true
    );
  });
  it("uses the store summary when long content is missing", async () => {
    const { fetchImpl } = storefront([{ ...offer, longDescription: "" }]);
    assert.equal(
      (await getEpicStoreDetails("sandbox:item", "en", fetchImpl))?.description,
      "Short"
    );
  });

  it("does not choose arbitrarily between offers sharing the same item", async () => {
    const { fetchImpl } = storefront([offer, { ...offer, id: "other" }]);
    assert.equal(
      await getEpicStoreDetails("sandbox:item", "en", fetchImpl),
      null
    );
  });

  it("rejects the wrong item identity", async () => {
    assert.equal(
      await getEpicStoreDetails("sandbox:wrong", "en", storefront().fetchImpl),
      null
    );
  });

  it("uses the backend only when the Epic request fails", async () => {
    const failed: typeof fetch = async () =>
      new Response(null, { status: 503 });
    let backendCalls = 0;
    const result = await getStoreDetailsWithFallback(
      () => getEpicStoreDetails("sandbox:item", "en", failed),
      async () => {
        backendCalls++;
        const fallback = await getEpicStoreDetails(
          "sandbox:item",
          "en",
          storefront().fetchImpl
        );
        assert.ok(fallback);
        return { ...fallback, title: "Backend fallback" };
      },
      null
    );
    assert.equal(result?.title, "Backend fallback");
    assert.equal(backendCalls, 1);
  });

  it("does not consult the backend after a successful Epic request", async () => {
    let backendCalls = 0;
    const result = await getStoreDetailsWithFallback(
      () => getEpicStoreDetails("sandbox:item", "en", storefront().fetchImpl),
      async () => {
        backendCalls++;
        return null;
      },
      null
    );
    assert.equal(result?.title, offer.title);
    assert.equal(backendCalls, 0);
  });
});
