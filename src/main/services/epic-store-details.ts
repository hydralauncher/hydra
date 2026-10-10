import type { ShopDetailsWithAssets } from "@types";
import { STORE_DETAILS_TIMEOUT_MS } from "./store-details-fallback.js";

interface EpicOffer {
  id: string;
  namespace?: string;
  title?: string;
  description?: string;
  longDescription?: string;
  developerDisplayName?: string;
  publisherDisplayName?: string;
  releaseDate?: string;
  pcReleaseDate?: string;
  items?: { id: string; namespace: string }[];
  tags?: { id: string; name: string }[];
  keyImages?: { type: string; url: string }[];
}
interface EpicConfig {
  shortDescription?: string;
  supportedText?: string[];
  supportedAudio?: string[];
  technicalRequirements?: {
    windows?: { title?: string; minimum?: string; recommended?: string }[];
  };
}
interface EpicPayload {
  Catalog?: {
    catalogOffers?: { elements?: EpicOffer[] };
    searchStore?: { elements?: EpicOffer[] };
  };
  Product?: {
    sandbox?: {
      configuration?: { configs?: EpicConfig | EpicConfig[] }[];
    } | null;
  };
}

const ENDPOINT = "https://launcher.store.epicgames.com/graphql";
const BASE_OFFER_LIMIT = 50;
const GENRE_IDS = new Set([
  "1216",
  "1210",
  "1218",
  "1336",
  "1367",
  "1393",
  "1212",
]);
const PT_GENRES: Record<string, string> = {
  Action: "Ação",
  Adventure: "Aventura",
  "Action-Adventure": "Ação e aventura",
  Shooter: "Tiro",
  Horror: "Terror",
  RPG: "RPG",
  Simulation: "Simulação",
  Racing: "Corrida",
  Strategy: "Estratégia",
  Sports: "Esportes",
  Puzzle: "Quebra-cabeça",
};
const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!
  );

export const getEpicLocale = (language: string) => {
  const regional: Record<string, string> = {
    en: "en-US",
    pt: "pt-BR",
    es: "es-ES",
    zh: "zh-CN",
  };
  return regional[language] ?? language;
};

export const getEpicStoreDetails = async (
  objectId: string,
  language: string,
  fetchImpl: typeof fetch = fetch
): Promise<ShopDetailsWithAssets | null> => {
  const [namespace, itemId, extra] = objectId.split(":");
  if (!namespace || !itemId || extra !== undefined) return null;
  const locale = getEpicLocale(language);
  const signal = AbortSignal.timeout(STORE_DETAILS_TIMEOUT_MS);
  const request = async (query: string, variables: Record<string, unknown>) => {
    const response = await fetchImpl(ENDPOINT, {
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
    });
    if (!response.ok) throw new Error(`Epic HTTP ${response.status}`);
    const body = (await response.json()) as {
      errors?: unknown;
      data?: EpicPayload;
    };
    if (body.errors || !body.data) throw new Error("Epic GraphQL failed");
    return body.data;
  };
  const result = await request(
    `query($namespace:String!,$locale:String!,$country:String!){ Catalog { catalogOffers(namespace:$namespace,locale:$locale,params:{category:"games/edition/base",count:${BASE_OFFER_LIMIT},country:$country,sortBy:"releaseDate",sortDir:"DESC"}) { elements { id title description longDescription developerDisplayName publisherDisplayName releaseDate pcReleaseDate items { id namespace } } } } Product { sandbox(sandboxId:$namespace) { configuration(locale:$locale) { ... on StoreConfiguration { configs { shortDescription supportedAudio supportedText technicalRequirements { windows { title minimum recommended } } } } } } } }`,
    { namespace, locale, country: "US" }
  );
  const matches = (result.Catalog?.catalogOffers?.elements ?? []).filter(
    (offer: { items?: { id: string; namespace: string }[] }) =>
      offer.items?.some(
        (item) => item.id === itemId && item.namespace === namespace
      )
  );
  if (matches.length !== 1) return null;
  const offer = matches[0];
  const longDescription = text(offer.longDescription);
  if (!longDescription) return null;
  const search = await request(
    `query($keywords:String!,$country:String!,$locale:String!){ Catalog { searchStore(country:$country,locale:$locale,count:50,start:0,keywords:$keywords,comingSoon:false) { elements { id namespace tags { id name } keyImages { type url } items { id namespace } } } } }`,
    { keywords: text(offer.title), country: "US", locale }
  );
  const searchOffer = (search.Catalog?.searchStore?.elements ?? []).find(
    (row) =>
      row.id === offer.id &&
      row.namespace === namespace &&
      row.items?.some(
        (item) => item.id === itemId && item.namespace === namespace
      )
  );
  const configurations = result.Product?.sandbox?.configuration ?? [];
  const configs = configurations.flatMap(
    (entry: { configs?: EpicConfig | EpicConfig[] }) =>
      Array.isArray(entry.configs)
        ? entry.configs
        : entry.configs
          ? [entry.configs]
          : []
  );
  const requirements =
    configs.find((row) => row.technicalRequirements?.windows?.length)
      ?.technicalRequirements?.windows ?? [];
  const formatRequirements = (key: "minimum" | "recommended") =>
    requirements
      .filter((row) => text(row[key]))
      .map((row) =>
        escapeHtml([text(row.title), text(row[key])].filter(Boolean).join(": "))
      )
      .join("<br>");
  const languageConfig = configs.find(
    (row) => row.supportedText?.length || row.supportedAudio?.length
  );
  const audio = new Set<string>(
    (languageConfig?.supportedAudio ?? []).filter(
      (value: unknown) => typeof value === "string"
    )
  );
  const supported = [
    ...new Set<string>(
      [...(languageConfig?.supportedText ?? []), ...audio].filter(
        (value: unknown) => typeof value === "string"
      )
    ),
  ];
  const developer = text(offer.developerDisplayName);
  const publisher = text(offer.publisherDisplayName);
  return {
    objectId,
    name: text(offer.title),
    steam_appid: 0,
    detailed_description: longDescription,
    about_the_game: longDescription,
    short_description:
      text(
        configs.find((row) => text(row.shortDescription))?.shortDescription
      ) || text(offer.description),
    developers: developer || publisher ? [developer || publisher] : [],
    publishers: publisher ? [publisher] : [],
    genres: (searchOffer?.tags ?? [])
      .filter((tag) => GENRE_IDS.has(tag.id) || tag.name in PT_GENRES)
      .map((tag) => ({
        id: tag.id,
        name: locale.startsWith("pt")
          ? (PT_GENRES[tag.name] ?? tag.name)
          : tag.name,
      })),
    screenshots: (searchOffer?.keyImages ?? [])
      .filter(
        (image) =>
          ["GalleryImage", "featuredMedia"].includes(image.type) &&
          typeof image.url === "string"
      )
      .map((image, id: number) => ({
        id,
        path_full: image.url,
        path_thumbnail: image.url,
      })),
    supported_languages: supported
      .map(
        (name) =>
          escapeHtml(name) + (audio.has(name) ? "<strong>*</strong>" : "")
      )
      .join(", "),
    pc_requirements: {
      minimum: formatRequirements("minimum"),
      recommended: formatRequirements("recommended"),
    },
    mac_requirements: { minimum: "", recommended: "" },
    linux_requirements: { minimum: "", recommended: "" },
    release_date: {
      coming_soon: false,
      date: text(offer.pcReleaseDate) || text(offer.releaseDate),
    },
    content_descriptors: { ids: [] },
    descriptionLanguage: locale,
    assets: {
      objectId,
      shop: "epic",
      title: text(offer.title),
      iconUrl:
        searchOffer?.keyImages?.find((image) => image.type === "Thumbnail")
          ?.url ?? null,
      coverImageUrl:
        searchOffer?.keyImages?.find((image) => image.type === "OfferImageTall")
          ?.url ?? null,
      libraryImageUrl:
        searchOffer?.keyImages?.find((image) => image.type === "OfferImageWide")
          ?.url ?? null,
      libraryHeroImageUrl:
        searchOffer?.keyImages?.find((image) => image.type === "OfferImageWide")
          ?.url ?? null,
      logoImageUrl:
        searchOffer?.keyImages?.find((image) => image.type === "ProductLogo")
          ?.url ?? null,
      logoPosition: null,
      downloadSources: [],
    },
  };
};
