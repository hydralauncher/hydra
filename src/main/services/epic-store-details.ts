import type { EpicShopDetails } from "./store-shop-details.js";
import { STORE_DETAILS_TIMEOUT_MS } from "./store-shop-details.js";

type Image = { type: string; url: string | null };
interface Offer {
  id: string;
  namespace: string;
  title: string;
  description?: string | null;
  longDescription?: string | null;
  developerDisplayName?: string | null;
  publisherDisplayName?: string | null;
  releaseDate?: string | null;
  pcReleaseDate?: string | null;
  items: { id: string; namespace: string }[];
  keyImages?: Image[] | null;
  tags?: { id: string; name: string }[];
}
interface ProductConfig {
  shortDescription?: string;
  keyImages?: Image[];
  supportedText?: string[];
  supportedAudio?: string[];
  technicalRequirements?: {
    windows?: { title?: string; minimum?: string; recommended?: string }[];
  };
}
interface StoreResponse {
  Catalog: { catalogOffers: { elements: Offer[] } };
  Product?: {
    sandbox?: {
      configuration?: { configs?: ProductConfig | ProductConfig[] }[];
    } | null;
  };
}
const OFFER_PAGE_SIZE = 50;
const SCREENSHOT_LIMIT = 10;
const LOCALES: Record<string, string> = {
  en: "en-US",
  pt: "pt-BR",
  ru: "ru-RU",
  es: "es-ES",
  fr: "fr-FR",
  it: "it-IT",
};
const GENRES: Record<string, string[]> = {
  "1336": ["Action", "Adventure"],
  "1210": ["Action"],
  "1367": ["RPG"],
  "1393": ["Simulation"],
  "1212": ["Racing"],
};
const DETAILS_QUERY = `query($namespace: String!, $locale: String!, $country: String!) {
  Catalog { catalogOffers(namespace: $namespace, locale: $locale, params: { count: ${OFFER_PAGE_SIZE}, country: $country }) {
    elements { id namespace title description longDescription developerDisplayName publisherDisplayName releaseDate pcReleaseDate
      items { id namespace } keyImages { type url } tags { id name } }
  } }
  Product { sandbox(sandboxId: $namespace) { configuration(locale: $locale) { ... on StoreConfiguration {
    configs { shortDescription keyImages { type url } supportedAudio supportedText technicalRequirements { windows { title minimum recommended } } }
  } } } }
}`;

export async function getEpicStoreDetails(
  objectId: string,
  language: string,
  fetchImpl: typeof fetch = fetch
): Promise<EpicShopDetails | null> {
  const [namespace, itemId, extra] = objectId.split(":");
  if (!namespace || !itemId || extra !== undefined) return null;
  const locale =
    LOCALES[language.replaceAll("_", "-").toLowerCase().split("-")[0]] ??
    LOCALES.en;
  const signal = AbortSignal.timeout(STORE_DETAILS_TIMEOUT_MS);
  async function request<T>(
    query: string,
    variables: Record<string, string>
  ): Promise<T> {
    const response = await fetchImpl(
      "https://launcher.store.epicgames.com/graphql",
      {
        method: "POST",
        signal,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "EpicGamesLauncher/15.0.0",
          Origin: "https://store.epicgames.com",
          Referer: "https://store.epicgames.com/",
        },
        body: JSON.stringify({ query, variables }),
      }
    );
    if (!response.ok)
      throw new Error(`Epic storefront HTTP ${response.status}`);
    const body = (await response.json()) as { data?: T; errors?: unknown };
    if (body.errors || !body.data)
      throw new Error("Epic storefront returned invalid data");
    return body.data;
  }
  const data = await request<StoreResponse>(DETAILS_QUERY, {
    namespace,
    locale,
    country: "US",
  });
  const offers = data.Catalog.catalogOffers.elements.filter(
    (offer) =>
      offer.namespace === namespace &&
      offer.items.some(
        (item) => item.namespace === namespace && item.id === itemId
      )
  );
  if (offers.length !== 1) return null;
  const offer = offers[0];
  const configs =
    data.Product?.sandbox?.configuration?.flatMap((row) =>
      Array.isArray(row.configs)
        ? row.configs
        : row.configs
          ? [row.configs]
          : []
    ) ?? [];
  const summary =
    offer.description?.trim() ||
    configs
      .find((row) => row.shortDescription?.trim())
      ?.shortDescription?.trim() ||
    null;
  const description = offer.longDescription?.trim() || summary;
  if (!description) return null;
  const images = [
    ...(offer.keyImages ?? []),
    ...configs.flatMap((row) => row.keyImages ?? []),
  ];
  const image = (...types: string[]) =>
    types
      .map((type) => images.find((entry) => entry.type === type)?.url)
      .find(Boolean) ?? null;
  const videos = await Promise.allSettled(
    (offer.keyImages ?? [])
      .filter((entry) => entry.type === "heroCarouselVideo" && entry.url)
      .map(async (entry) => {
        const reference = /^com\.epicgames\.video:\/\/([^?]+)(?:\?(.*))?$/.exec(
          entry.url!
        );
        if (!reference) return null;
        const recipes = await request<{
          Video: {
            fetchVideoByLocale: { recipe: string; mediaRefId: string }[];
          };
        }>(
          `query($videoId: String!, $locale: String!) { Video { fetchVideoByLocale(videoId: $videoId, locale: $locale) { recipe mediaRefId } } }`,
          { videoId: reference[1], locale }
        );
        for (const name of ["video-hls", "video-fmp4", "video-webm"]) {
          const recipe = recipes.Video.fetchVideoByLocale.find(
            (row) => row.recipe === name
          );
          if (!recipe) continue;
          const media = await request<{
            Media: {
              getMediaRef: {
                outputs: { key: string; url: string; contentType: string }[];
              } | null;
            };
          }>(
            `query($mediaRefId: String!) { Media { getMediaRef(mediaRefId: $mediaRefId) { outputs { url key contentType } } } }`,
            { mediaRefId: recipe.mediaRefId }
          );
          const outputs = media.Media.getMediaRef?.outputs ?? [];
          const output = ["manifest", "high", "medium", "low"]
            .map((key) => outputs.find((row) => row.key === key))
            .find(Boolean);
          if (output)
            return {
              id: reference[1],
              title: null,
              thumbnailUrl:
                new URLSearchParams(reference[2] ?? "").get("cover") ??
                outputs.find((row) => row.key === "thumbnail")?.url ??
                null,
              url: output.url,
              contentType: output.contentType,
            };
        }
        return null;
      })
  );
  const requirements =
    configs.find((row) => row.technicalRequirements?.windows?.length)
      ?.technicalRequirements?.windows ?? [];
  const requirement = (key: "minimum" | "recommended") =>
    requirements
      .filter((row) => row[key]?.trim())
      .map((row) => [row.title, row[key]].filter(Boolean).join(": "))
      .join("\n");
  const languages = configs.find(
    (row) => row.supportedText?.length || row.supportedAudio?.length
  );
  const audioLanguages = new Set(
    (languages?.supportedAudio ?? []).map((name) =>
      name.trim().toLocaleLowerCase("en-US")
    )
  );
  const supportedLanguages = [
    ...new Set(
      [
        ...(languages?.supportedText ?? []),
        ...(languages?.supportedAudio ?? []),
      ]
        .map((name) => name.trim())
        .filter(Boolean)
    ),
  ].map((name) => {
    const escapedName = name
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
    return audioLanguages.has(name.toLocaleLowerCase("en-US"))
      ? escapedName + "<strong>*</strong>"
      : escapedName;
  });
  return {
    descriptionLanguage: locale === "pt-BR" ? "pt-BR" : locale.split("-")[0],
    title: offer.title,
    description,
    shortDescription: summary,
    developer: offer.developerDisplayName?.trim() || null,
    publisher: offer.publisherDisplayName?.trim() || null,
    genres: [
      ...new Set(
        (offer.tags ?? []).flatMap(
          (tag) =>
            GENRES[tag.id] ??
            ([
              "Action",
              "Adventure",
              "RPG",
              "Strategy",
              "Simulation",
              "Racing",
              "Sports",
            ].includes(tag.name)
              ? [tag.name]
              : [])
        )
      ),
    ],
    releaseDate: offer.pcReleaseDate ?? offer.releaseDate ?? null,
    screenshots: (offer.keyImages ?? [])
      .filter(
        (entry) =>
          entry.url &&
          ["GalleryImage", "OfferImageWide", "featuredMedia"].includes(
            entry.type
          )
      )
      .map((entry) => entry.url!)
      .slice(0, SCREENSHOT_LIMIT),
    videos: videos.flatMap((result) =>
      result.status === "fulfilled" && result.value ? [result.value] : []
    ),
    requirements: {
      minimum: requirement("minimum"),
      recommended: requirement("recommended"),
    },
    supportedLanguages,
    images: {
      cover: image("OfferImageTall", "DieselStoreFrontTall", "Thumbnail"),
      libraryImage: image("OfferImageWide", "DieselStoreFrontWide"),
      hero: image("OfferImageWide", "DieselStoreFrontWide"),
      icon: image("Thumbnail", "OfferImageTall"),
      logo: image("ProductLogo", "DieselGameBoxLogo"),
    },
  };
}
