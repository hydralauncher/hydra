import type { GameShop, ShopDetailsWithAssets } from "../types";

interface EpicGameReference {
  shop: GameShop;
  objectId: string;
}

export interface EpicShopDetailsResponse {
  game: Record<string, unknown>;
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

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
  const rules = (os: string) => ({
    minimum: text(record(requirements[os]).minimum),
    recommended: text(record(requirements[os]).recommended),
  });
  const description = text(game.description);
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
    supported_languages: names(game.supportedLanguages).join(", "),
    screenshots: names(game.screenshots).map((url, id) => ({
      id,
      path_thumbnail: url,
      path_full: url,
    })),
    pc_requirements: rules("windows"),
    mac_requirements: rules("mac"),
    linux_requirements: rules("linux"),
    release_date: {
      coming_soon: game.comingSoon === true,
      date: text(game.releaseDate),
    },
    content_descriptors: { ids: [] },
    assets: mapAssets(reference, game, title),
  };
}
