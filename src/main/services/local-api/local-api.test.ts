import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Game } from "@types";

import {
  buildLocalApiGamesResponse,
  generateLocalApiToken,
  isAuthorizedLocalApiRequest,
  LOCAL_API_DEFAULT_PORT,
  LOCAL_API_VERSION,
} from "./local-api-library.js";

const makeGame = (overrides: Partial<Game>): Game =>
  ({
    shop: "steam",
    objectId: "123",
    title: "Test Game",
    playTimeInMilliseconds: 1000,
    lastTimePlayed: null,
    isDeleted: false,
    ...overrides,
  }) as Game;

describe("buildLocalApiGamesResponse", () => {
  it("serializes library games", () => {
    const response = buildLocalApiGamesResponse([
      makeGame({
        playTimeInMilliseconds: 60_000,
        steamPlayTimeInMilliseconds: 30_000,
        lastTimePlayed: new Date("2026-01-02T03:04:05.000Z"),
        addedToLibraryAt: "2025-12-01T00:00:00.000Z" as unknown as Date,
        favorite: true,
      }),
    ]);

    assert.deepEqual(response.games, [
      {
        shop: "steam",
        objectId: "123",
        title: "Test Game",
        playTimeInMilliseconds: 60_000,
        steamPlayTimeInMilliseconds: 30_000,
        epicPlayTimeInMilliseconds: 0,
        lastTimePlayed: "2026-01-02T03:04:05.000Z",
        addedToLibraryAt: "2025-12-01T00:00:00.000Z",
        favorite: true,
      },
    ]);
  });

  it("skips deleted games and entries without objectId", () => {
    const response = buildLocalApiGamesResponse([
      makeGame({ isDeleted: true }),
      makeGame({ objectId: "" }),
      makeGame({ objectId: "456" }),
    ]);

    assert.equal(response.games.length, 1);
    assert.equal(response.games[0].objectId, "456");
  });

  it("handles dates stored as strings and missing fields", () => {
    const response = buildLocalApiGamesResponse([
      makeGame({
        lastTimePlayed: "2026-03-01T10:00:00.000Z" as unknown as Date,
      }),
    ]);

    assert.equal(response.games[0].lastTimePlayed, "2026-03-01T10:00:00.000Z");
    assert.equal(response.games[0].addedToLibraryAt, null);
    assert.equal(response.games[0].favorite, false);
  });
});

describe("isAuthorizedLocalApiRequest", () => {
  const token = generateLocalApiToken();

  it("accepts a matching bearer token", () => {
    assert.equal(isAuthorizedLocalApiRequest(`Bearer ${token}`, token), true);
  });

  it("rejects missing, malformed and wrong tokens", () => {
    assert.equal(isAuthorizedLocalApiRequest(undefined, token), false);
    assert.equal(isAuthorizedLocalApiRequest("Bearer wrong", token), false);
    assert.equal(isAuthorizedLocalApiRequest(`Basic ${token}`, token), false);
    assert.equal(
      isAuthorizedLocalApiRequest([`Bearer ${token}`], token),
      false
    );
    assert.equal(isAuthorizedLocalApiRequest(`Bearer ${token}`, ""), false);
  });
});

describe("local api defaults", () => {
  it("pins the public contract constants", () => {
    assert.equal(LOCAL_API_DEFAULT_PORT, 17577);
    assert.equal(LOCAL_API_VERSION, 1);
  });
});
