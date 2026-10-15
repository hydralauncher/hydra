import type { ShopDetailsWithAssets } from "@types";
import { JSDOM } from "jsdom";
import MarkdownIt from "markdown-it";

const epicMarkdown = new MarkdownIt({ html: true });

export const STORE_DETAILS_TIMEOUT_MS = 15_000;

export interface EpicShopDetails {
  descriptionLanguage?: string;
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
    descriptionLanguage: data.descriptionLanguage ?? language,
    steam_appid: 0,
    detailed_description: description,
    about_the_game: description,
    short_description: sanitizeEpicHtml(data.shortDescription ?? ""),
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
      minimum: formatEpicRequirements(data.requirements?.minimum ?? ""),
      recommended: formatEpicRequirements(data.requirements?.recommended ?? ""),
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

export function formatEpicDescription(description: string): string {
  const content = description
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/={3,}/g, "\n\n")
    .replace(/^(\s*)•[\t ]+/gm, "$1- ")
    .trim();
  // Both the live store and API fallback pass through this boundary. Parse
  // Markdown once and sanitize embedded HTML before returning it to the renderer.
  return sanitizeEpicHtml(epicMarkdown.render(content)).trim();
}

function formatEpicRequirements(requirements: string): string {
  if (!requirements.trim()) return "";
  if (/<\/?[a-z][^>]*>/i.test(requirements))
    return sanitizeEpicHtml(requirements);
  const items = requirements
    .split(/\r?\n/)
    .filter((row) => row.trim())
    .map(
      (row) =>
        `<li>${row.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</li>`
    );
  return `<ul>${items.join("")}</ul>`;
}

export function sanitizeEpicHtml(html: string): string {
  const fragment = JSDOM.fragment(html);
  for (const element of fragment.querySelectorAll(
    "script, style, iframe, object, embed, svg, math, form, input, button, textarea, select, template"
  )) {
    element.remove();
  }
  const allowedTags = new Set([
    "P",
    "BR",
    "STRONG",
    "EM",
    "B",
    "I",
    "U",
    "S",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "UL",
    "OL",
    "LI",
    "DIV",
    "SPAN",
    "BLOCKQUOTE",
    "HR",
    "IMG",
    "TABLE",
    "THEAD",
    "TBODY",
    "TR",
    "TH",
    "TD",
  ]);
  for (const element of fragment.querySelectorAll("*")) {
    if (!allowedTags.has(element.tagName)) {
      element.replaceWith(...element.childNodes);
      continue;
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name === "alt" || name === "title") continue;
      if (
        (element.tagName === "IMG" && name === "src") ||
        (element.tagName === "A" && name === "href")
      ) {
        try {
          const url = new URL(attribute.value, "https://store.epicgames.com");
          if (url.protocol === "https:" || url.protocol === "http:") {
            element.setAttribute(name, url.href);
            continue;
          }
        } catch {
          element.removeAttribute(attribute.name);
          continue;
        }
      }
      element.removeAttribute(attribute.name);
    }
  }
  const container = fragment.ownerDocument.createElement("div");
  container.append(fragment);
  return container.innerHTML;
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
