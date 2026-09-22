import type { GameShop, ShopDetailsWithAssets } from "../types";
import MarkdownIt from "markdown-it";

interface EpicGameReference {
  shop: GameShop;
  objectId: string;
}

export interface EpicShopDetailsResponse {
  game: Record<string, unknown>;
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

const epicDescriptionMarkdown = new MarkdownIt({
  breaks: true,
  html: false,
  linkify: true,
});

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
  const markdown = text(value)
    .replace(/<!--[\s\S]*?-->/g, "\n\n")
    .replace(/\s+•\s+/g, "\n- ")
    .trim();

  return markdown ? epicDescriptionMarkdown.render(markdown) : "";
};

const names = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : typeof value === "string" && value
      ? [value]
      : [];

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

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
    minimum: text(requirements.minimum),
    recommended: text(requirements.recommended),
  };
  const description = renderEpicDescription(game.description);
  const supportedLanguages = names(game.supportedLanguages);
  const title = text(game.title);

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
    screenshots: names(game.screenshots).map((url, id) => ({
      id,
      path_thumbnail: url,
      path_full: url,
    })),
    pc_requirements: epicRequirements,
    mac_requirements: { minimum: "", recommended: "" },
    linux_requirements: { minimum: "", recommended: "" },
    release_date: {
      coming_soon: game.comingSoon === true,
      date: text(game.releaseDate),
    },
    content_descriptors: { ids: [] },
    assets: mapAssets(reference, game, title),
  };
}
