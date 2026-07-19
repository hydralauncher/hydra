import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addSteamGridDbCacheControl,
  isSteamGridDbArtworkRequest,
  STEAM_GRID_DB_CACHE_CONTROL,
} from "./steam-grid-db-cache.js";

describe("SteamGridDB disk cache", () => {
  it("matches GET image and media requests from SteamGridDB", () => {
    assert.equal(
      isSteamGridDbArtworkRequest({
        method: "GET",
        resourceType: "image",
        url: "https://cdn2.steamgriddb.com/hero/example.webp",
      }),
      true
    );
    assert.equal(
      isSteamGridDbArtworkRequest({
        method: "GET",
        resourceType: "media",
        url: "https://steamgriddb.com/hero/example.webm",
      }),
      true
    );
  });

  it("rejects unrelated hosts, methods and resource types", () => {
    assert.equal(
      isSteamGridDbArtworkRequest({
        method: "GET",
        resourceType: "image",
        url: "https://steamgriddb.com.example.com/hero/example.webp",
      }),
      false
    );
    assert.equal(
      isSteamGridDbArtworkRequest({
        method: "POST",
        resourceType: "image",
        url: "https://cdn2.steamgriddb.com/hero/example.webp",
      }),
      false
    );
    assert.equal(
      isSteamGridDbArtworkRequest({
        method: "GET",
        resourceType: "script",
        url: "https://cdn2.steamgriddb.com/app.js",
      }),
      false
    );
  });

  it("replaces existing cache headers with a one-week TTL", () => {
    assert.deepEqual(
      addSteamGridDbCacheControl({
        "Content-Type": ["image/webp"],
        "cache-control": ["no-cache"],
      }),
      {
        "Content-Type": ["image/webp"],
        "Cache-Control": [STEAM_GRID_DB_CACHE_CONTROL],
      }
    );
  });
});
