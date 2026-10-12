import type { ShopDetailsWithAssets } from "@types";

export const STORE_DETAILS_TIMEOUT_MS = 15_000;

export interface EpicShopDetails {
  title: string | null;
  description: string | null;
  shortDescription: string | null;
  developer: string | null;
  publisher: string | null;
  genres: string[];
  releaseDate: string | null;
  screenshots: string[];
  videos:
    | {
        id: string;
        title: string | null;
        thumbnailUrl: string | null;
        url: string;
        contentType: string;
      }[]
    | null;
  requirements: { minimum?: string; recommended?: string } | null;
  supportedLanguages: string[];
  images: {
    cover?: string | null;
    libraryImage?: string | null;
    hero?: string | null;
    icon?: string | null;
    logo?: string | null;
  };
}

export function mapEpicShopDetails(
  objectId: string,
  data: EpicShopDetails,
  language: string
): ShopDetailsWithAssets {
  const rawDescription =
    data.description?.trim() || data.shortDescription?.trim() || "";
  const description = formatEpicDescription(rawDescription);
  const releaseDate = data.releaseDate ? new Date(data.releaseDate) : null;
  return {
    objectId,
    name: data.title ?? "",
    descriptionLanguage: language,
    steam_appid: 0,
    detailed_description: description,
    about_the_game: description,
    short_description: data.shortDescription ?? "",
    developers: data.developer?.trim() ? [data.developer.trim()] : [],
    publishers: data.publisher?.trim() ? [data.publisher.trim()] : [],
    genres: data.genres.map((name, id) => ({ id: String(id), name })),
    screenshots: data.screenshots.map((url, id) => ({
      id,
      path_thumbnail: url,
      path_full: url,
    })),
    movies: data.videos?.map((video, id) => ({
      id,
      name: video.title ?? "",
      thumbnail: video.thumbnailUrl ?? data.images.cover ?? "",
      highlight: id === 0,
      ...(video.contentType.toLowerCase().includes("mpegurl")
        ? { hls_h264: video.url }
        : video.contentType.includes("webm")
          ? { webm: { max: video.url, "480": video.url } }
          : { mp4: { max: video.url, "480": video.url } }),
    })),
    supported_languages: data.supportedLanguages.join(", "),
    pc_requirements: {
      minimum: data.requirements?.minimum ?? "",
      recommended: data.requirements?.recommended ?? "",
    },
    mac_requirements: { minimum: "", recommended: "" },
    linux_requirements: { minimum: "", recommended: "" },
    release_date: {
      coming_soon: false,
      date:
        releaseDate && !Number.isNaN(releaseDate.getTime())
          ? releaseDate.toLocaleDateString(
              language === "pt" ? "pt-BR" : language,
              {
                day: "numeric",
                month: "long",
                year: "numeric",
                timeZone: "UTC",
              }
            )
          : (data.releaseDate ?? ""),
    },
    content_descriptors: { ids: [] },
    assets: {
      objectId,
      shop: "epic",
      title: data.title ?? "",
      iconUrl: data.images.icon ?? null,
      coverImageUrl: data.images.cover ?? null,
      libraryImageUrl: data.images.libraryImage ?? data.images.cover ?? null,
      libraryHeroImageUrl: data.images.hero ?? null,
      logoImageUrl: data.images.logo ?? null,
      logoPosition: null,
      downloadSources: [],
    },
  };
}

function formatEpicDescription(description: string): string {
  const content = description.replace(/<!--[\s\S]*?-->/g, "").trim();
  if (/<\/?[a-z][^>]*>/i.test(content)) {
    return content.replace(/={3,}/g, "<br><br>");
  }

  return content
    .replace(/={3,}/g, "\n\n")
    .replace(/\r\n/g, "\n")
    .replace(/\n[\t ]*\n(?:[\t ]*\n)+/g, "\n\n")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(
      /!\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)\)/g,
      '<img alt="$1" src="$2">'
    )
    .replace(
      /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|\/(?!\/)[^\s)]*)\)/g,
      (_, label: string, destination: string) => {
        const href = destination.startsWith("/")
          ? `https://store.epicgames.com${destination}`
          : destination;
        return `<a href="${href}">${label}</a>`;
      }
    )
    .replace(/\r?\n/g, "<br>");
}

export async function getStoreDetailsWithFallback<T>(
  fetchStore: () => Promise<T | null>,
  fetchDatabase: () => Promise<T | null>,
  cached: T | null
): Promise<T | null> {
  let details: T | null = null;
  try {
    details = await fetchStore();
  } catch {
    details = null;
  }
  if (details) return details;
  try {
    return (await fetchDatabase()) ?? cached;
  } catch {
    return cached;
  }
}
