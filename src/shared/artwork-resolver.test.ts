import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ArtworkItem,
  ShopAssets,
  GameArtworkSelection,
} from "../types/index.js";
import {
  composeAssetsWithArtwork,
  composeEpicDefaultArtwork,
  composeEpicDefaultArtworkPages,
  preserveEpicDefaultArtwork,
} from "./artwork-resolver.js";

const assets: ShopAssets = {
  objectId: "namespace:item",
  shop: "epic",
  title: "Game",
  iconUrl: "https://epic.example/cover.jpg",
  coverImageUrl: "https://epic.example/cover.jpg",
  libraryImageUrl: null,
  libraryHeroImageUrl: null,
  logoImageUrl: null,
  logoPosition: null,
  downloadSources: [],
};
const item = (overrides: Partial<ArtworkItem> = {}): ArtworkItem => ({
  id: 1,
  score: 10,
  url: "https://cdn2.steamgriddb.com/icon/small.png",
  thumb: "",
  width: 64,
  height: 64,
  ...overrides,
});

describe("Epic default artwork", () => {
  it("retains a successful icon when either grid request fails", () => {
    const resolved = composeEpicDefaultArtworkPages(
      preserveEpicDefaultArtwork(assets),
      { icon: [item()] },
      1000
    );
    assert.equal(resolved.iconUrl, item().url);
    assert.deepEqual(resolved.epicArtworkUpdatedAtByType, { icon: 1000 });
    const retried = composeEpicDefaultArtworkPages(
      preserveEpicDefaultArtwork(assets, resolved),
      { portrait: [] },
      2000
    );
    assert.equal(retried.iconUrl, item().url);
    assert.deepEqual(retried.epicArtworkUpdatedAtByType, {
      icon: 1000,
      portrait: 2000,
    });
  });

  it("preserves resolved defaults across remote sync asset replacement", () => {
    const resolved = composeEpicDefaultArtworkPages(
      assets,
      {
        icon: [item()],
        portrait: [
          item({
            url: "https://sgdb.example/portrait.png",
            width: 600,
            height: 900,
            style: "no_logo",
          }),
        ],
        landscape: [
          item({
            url: "https://sgdb.example/landscape.png",
            width: 920,
            height: 430,
            style: "no_logo",
          }),
        ],
      },
      1000
    );
    const synced = preserveEpicDefaultArtwork(
      {
        ...resolved,
        ...assets,
        libraryHeroImageUrl: "https://epic.example/hero.jpg",
      },
      resolved
    );
    assert.equal(synced.iconUrl, resolved.iconUrl);
    assert.equal(synced.coverImageUrl, resolved.coverImageUrl);
    assert.equal(synced.libraryImageUrl, resolved.libraryImageUrl);
    assert.equal(synced.libraryHeroImageUrl, resolved.libraryHeroImageUrl);
    assert.deepEqual(
      synced.epicArtworkUpdatedAtByType,
      resolved.epicArtworkUpdatedAtByType
    );
    assert.equal(
      composeAssetsWithArtwork(synced, {
        selected: { icon: { url: "https://user.example/icon.png" } },
      } as GameArtworkSelection).iconUrl,
      "https://user.example/icon.png"
    );
  });

  it("caches a confirmed missing icon without reusing the Epic cover", () => {
    const resolved = composeEpicDefaultArtworkPages(assets, { icon: [] }, 1000);
    assert.equal(preserveEpicDefaultArtwork(assets, resolved).iconUrl, null);
    assert.equal(resolved.epicArtworkUpdatedAtByType?.icon, 1000);
  });

  it("uses the bounded SGDB PNG preview for ICO responses with zero dimensions", () => {
    const ico = item({
      width: 0,
      height: 0,
      url: "https://cdn2.steamgriddb.com/icon/game.ico",
      thumb: "https://cdn2.steamgriddb.com/icon/game/32/128x128.png",
    });
    assert.equal(
      composeEpicDefaultArtwork(assets, [ico], []).iconUrl,
      ico.thumb
    );
    assert.equal(
      composeEpicDefaultArtwork(
        assets,
        [
          {
            ...ico,
            thumb: "https://cdn2.steamgriddb.com/icon/game/32/512x512.png",
          },
        ],
        []
      ).iconUrl,
      null
    );
    assert.equal(
      composeEpicDefaultArtwork(
        assets,
        [
          {
            ...ico,
            thumb: "https://untrusted.example/icon/game/32/128x128.png",
          },
        ],
        []
      ).iconUrl,
      null
    );
  });
  it("selects a small icon and no-logo grid while rejecting oversized and flagged assets", () => {
    const result = composeEpicDefaultArtwork(
      assets,
      [
        item({ width: 1200, height: 1600, score: 100 }),
        item({ nsfw: true, score: 90 }),
        item(),
      ],
      [
        item({ style: "alternate", score: 100 }),
        item({
          style: "no_logo",
          width: 600,
          height: 900,
          url: "https://cdn2.steamgriddb.com/grid/clean.png",
        }),
      ]
    );
    assert.equal(result.iconUrl, item().url);
    assert.equal(
      result.coverImageUrl,
      "https://cdn2.steamgriddb.com/grid/clean.png"
    );
    assert.equal(assets.iconUrl, "https://epic.example/cover.jpg");
  });
  it("uses a landscape no-logo grid for the background and a portrait grid for the cover", () => {
    const portrait = item({
      style: "no_logo",
      width: 600,
      height: 900,
      url: "https://cdn2.steamgriddb.com/grid/portrait.png",
    });
    const landscape = item({
      style: "no_logo",
      width: 920,
      height: 430,
      url: "https://cdn2.steamgriddb.com/grid/landscape.png",
    });
    const result = composeEpicDefaultArtwork(
      assets,
      [],
      [portrait, landscape],
      [portrait, landscape]
    );
    assert.equal(result.coverImageUrl, portrait.url);
    assert.equal(result.libraryImageUrl, portrait.url);
    assert.equal(result.libraryHeroImageUrl, landscape.url);
    assert.equal(
      composeEpicDefaultArtwork(assets, [], [], [portrait]).libraryHeroImageUrl,
      assets.libraryHeroImageUrl
    );
  });
  it("uses a placeholder icon and keeps the Epic cover when SGDB has no suitable assets", () => {
    const result = composeEpicDefaultArtwork(
      assets,
      [item({ url: "http://unsafe.example/icon.png" })],
      [item({ style: "alternate" })]
    );
    assert.equal(result.iconUrl, null);
    assert.equal(result.coverImageUrl, assets.coverImageUrl);
  });
  it("preserves explicit user artwork selections over defaults", () => {
    const result = composeAssetsWithArtwork(
      composeEpicDefaultArtwork(assets, [item()], []),
      {
        shop: "epic",
        objectId: assets.objectId,
        updatedAt: 1,
        selected: {
          icon: { url: "https://custom.example/icon.png", artworkId: 4 },
          grid: { url: "https://custom.example/grid.png", artworkId: 5 },
        },
      }
    );
    assert.equal(result.iconUrl, "https://custom.example/icon.png");
    assert.equal(result.coverImageUrl, "https://custom.example/grid.png");
  });
  it("leaves Steam assets unchanged", () => {
    const steam = { ...assets, shop: "steam" as const };
    assert.equal(
      composeEpicDefaultArtwork(steam, [item()], [item({ style: "no_logo" })]),
      steam
    );
  });
});
