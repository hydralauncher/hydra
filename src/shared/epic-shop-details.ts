import type { GameShop, ShopDetailsWithAssets, SteamMovie } from "../types";
import MarkdownIt from "markdown-it";

interface EpicGameReference {
  shop: GameShop;
  objectId: string;
}

export interface EpicShopDetailsResponse {
  game: Record<string, unknown>;
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const epicDescriptionMarkdown = new MarkdownIt({
  breaks: true,
  html: false,
  linkify: true,
});

const removeHtmlComments = (value: string) => {
  let result = "";
  let position = 0;

  while (position < value.length) {
    const start = value.indexOf("<!--", position);
    if (start === -1) return result + value.slice(position);

    const end = value.indexOf("-->", start + 4);
    if (end === -1) return result + value.slice(position);

    result += value.slice(position, start) + "\n\n";
    position = end + 3;
  }

  return result;
};

const normalizeBulletPoints = (value: string) => {
  let result = "";
  let position = 0;
  let searchFrom = 0;

  while (searchFrom < value.length) {
    const bullet = value.indexOf("•", searchFrom);
    if (bullet === -1) break;

    if (
      bullet <= position ||
      bullet === value.length - 1 ||
      value[bullet - 1].trim() !== "" ||
      value[bullet + 1].trim() !== ""
    ) {
      searchFrom = bullet + 1;
      continue;
    }

    let before = bullet - 1;
    while (before > position && value[before - 1].trim() === "") before--;
    let after = bullet + 1;
    while (after < value.length && value[after].trim() === "") after++;

    result += value.slice(position, before) + "\n- ";
    position = after;
    searchFrom = after;
  }

  return result + value.slice(position);
};

epicDescriptionMarkdown.renderer.rules.heading_open = (
  tokens,
  index,
  options,
  _environment,
  renderer
) => {
  tokens[index].attrJoin("class", "epic-description-heading");

  return renderer.renderToken(tokens, index, options);
};

const renderEpicDescription = (value: unknown) => {
  const markdown = normalizeBulletPoints(
    removeHtmlComments(text(value))
  ).trim();

  return markdown ? epicDescriptionMarkdown.render(markdown) : "";
};

const renderEpicRequirements = (value: unknown) => {
  const rows = text(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separatorIndex = line.indexOf(":");

      if (separatorIndex <= 0) {
        return `<li><span>${escapeHtml(line)}</span></li>`;
      }

      const label = line.slice(0, separatorIndex).trim();
      const requirement = line.slice(separatorIndex + 1).trim();

      if (!label || !requirement) return null;

      return `<li><strong>${escapeHtml(label)}</strong><span>${escapeHtml(requirement)}</span></li>`;
    })
    .filter((row): row is string => Boolean(row));

  return rows.length ? `<ul>${rows.join("")}</ul>` : "";
};

const names = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }

  return typeof value === "string" && value ? [value] : [];
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const mapVideos = (
  value: unknown,
  fallbackThumbnail: string
): SteamMovie[] | undefined => {
  if (!Array.isArray(value)) return undefined;

  const videos: SteamMovie[] = [];

  for (const entry of value) {
    const video = record(entry);
    const id = text(video.id);
    const url = text(video.url);
    const contentType = text(video.contentType)
      .split(";", 1)[0]
      .trim()
      .toLowerCase();

    if (!id || !url) continue;

    const mapped = {
      id,
      thumbnail: text(video.thumbnailUrl) || fallbackThumbnail,
      name: text(video.title),
      highlight: false,
    };

    if (
      contentType === "application/x-mpegurl" ||
      contentType === "application/vnd.apple.mpegurl"
    ) {
      videos.push({ ...mapped, hls_h264: url });
      continue;
    }

    const source = { max: url, "480": url };
    if (contentType === "video/mp4") {
      videos.push({ ...mapped, mp4: source });
      continue;
    }
    if (contentType === "video/webm") {
      videos.push({ ...mapped, webm: source });
    }
  }

  return videos.length ? videos : undefined;
};

const mapAssets = (
  reference: EpicGameReference,
  game: Record<string, unknown>,
  title: string
) => {
  const assets = record(game.assets);
  const assetText = (key: string) => text(assets[key]) || text(game[key]);

  return {
    ...reference,
    title: text(assets.title) || title,
    iconUrl: assetText("iconUrl") || null,
    libraryHeroImageUrl: assetText("libraryHeroImageUrl") || null,
    libraryImageUrl: assetText("libraryImageUrl") || null,
    logoImageUrl: assetText("logoImageUrl") || null,
    logoPosition: assetText("logoPosition") || null,
    coverImageUrl: assetText("coverImageUrl") || null,
    downloadSources: [],
  };
};

export function mapEpicShopDetails(
  response: EpicShopDetailsResponse,
  language: string,
  reference: EpicGameReference
): ShopDetailsWithAssets {
  const { game } = response;
  const requirements = record(game.requirements);
  const epicRequirements = {
    minimum: renderEpicRequirements(requirements.minimum),
    recommended: renderEpicRequirements(requirements.recommended),
  };
  const description = renderEpicDescription(game.description);
  const supportedLanguages = names(game.supportedLanguages);
  const title = text(game.title);
  const screenshots = names(game.screenshots).map((url, id) => ({
    id,
    path_thumbnail: url,
    path_full: url,
  }));
  const assets = mapAssets(reference, game, title);
  const fallbackThumbnail =
    assets.libraryHeroImageUrl ??
    screenshots[0]?.path_thumbnail ??
    assets.coverImageUrl ??
    "";

  return {
    objectId: reference.objectId,
    descriptionLanguage: language,
    name: title,
    detailed_description: description,
    about_the_game: description,
    short_description: text(game.shortDescription),
    developers: names(game.developers ?? game.developer),
    publishers: names(game.publishers ?? game.publisher),
    genres: names(game.genres).map((name) => ({ id: name, name })),
    supported_languages: supportedLanguages.join(", "),
    supportedLanguages,
    movies: mapVideos(game.videos, fallbackThumbnail),
    screenshots,
    pc_requirements: epicRequirements,
    mac_requirements: { minimum: "", recommended: "" },
    linux_requirements: { minimum: "", recommended: "" },
    release_date: {
      coming_soon: game.comingSoon === true,
      date: text(game.releaseDate),
    },
    content_descriptors: { ids: [] },
    assets,
  };
}
